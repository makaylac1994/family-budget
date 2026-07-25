const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const { Configuration, PlaidApi, PlaidEnvironments } = require('plaid');

admin.initializeApp();
const db = admin.firestore();
db.settings({ ignoreUndefinedProperties: true });

// Switch to 'production' once you've tested end-to-end in Sandbox and are
// ready to connect real accounts. Plaid's free Trial plan runs on the
// 'production' environment with real (but limited) accounts — Sandbox is
// purely fake test banks for safe development.
const PLAID_ENV = 'production';

const PLAID_CLIENT_ID = defineSecret('PLAID_CLIENT_ID');
const PLAID_SECRET = defineSecret('PLAID_SECRET');

function plaidClient() {
  const clientId = PLAID_CLIENT_ID.value().trim();
  const secret = PLAID_SECRET.value().trim();

  const configuration = new Configuration({
    basePath: PlaidEnvironments[PLAID_ENV],
    baseOptions: {
      headers: {
        'PLAID-CLIENT-ID': clientId,
        'PLAID-SECRET': secret,
      },
    },
  });
  return new PlaidApi(configuration);
}

async function getHouseholdIdForUser(uid) {
  const userSnap = await db.collection('users').doc(uid).get();
  const householdId = userSnap.exists ? userSnap.data().householdId : null;
  if (!householdId) throw new HttpsError('failed-precondition', 'No household found for this account.');
  return householdId;
}

async function assertMember(householdId, uid) {
  const snap = await db.collection('households').doc(householdId).get();
  if (!snap.exists || !(snap.data().members || []).includes(uid)) {
    throw new HttpsError('permission-denied', 'Not a member of this household.');
  }
}

// Wraps a handler so any underlying error (e.g. from Plaid) is logged in full
// server-side AND reported back to the client with a real, readable message,
// instead of the generic "internal" error Firebase shows by default.
function withErrorReporting(handler) {
  return async (request) => {
    try {
      return await handler(request);
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      console.error('Function failed:', err.response?.data || err);
      const plaidMessage = err.response?.data?.error_message;
      throw new HttpsError('internal', plaidMessage || err.message || 'Something went wrong.');
    }
  };
}

const CATEGORY_MAP = {
  FOOD_AND_DRINK: 'Dining Out',
  GROCERIES: 'Groceries',
  RENT_AND_UTILITIES: 'Utilities',
  TRANSPORTATION: 'Transportation',
  ENTERTAINMENT: 'Entertainment',
  MEDICAL: 'Health',
  GENERAL_MERCHANDISE: 'Shopping',
  HOME_IMPROVEMENT: 'Housing',
  TRANSFER_IN: 'Income',
  INCOME: 'Income',
  LOAN_PAYMENTS: 'Other',
  TRANSFER_OUT: 'Other',
  GENERAL_SERVICES: 'Other',
  BANK_FEES: 'Other',
};

function primaryCategory(plaidTx) {
  return plaidTx.personal_finance_category?.primary || (plaidTx.category && plaidTx.category[0]) || '';
}

// Internal money movements (savings <-> checking, credit card payments) should
// default to excluded from income/expense totals, since they're not new
// earnings or new spending — just money moving between your own accounts.
// The user can still flip this back off by hand in the ledger if needed.
function isTransferCategory(primary) {
  return primary === 'TRANSFER_IN' || primary === 'TRANSFER_OUT' || primary === 'LOAN_PAYMENTS';
}


function normalizeDescription(desc) {
  return String(desc || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\d+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function txSignature(t) {
  return `${t.date}|${Math.round(t.amount * 100)}|${t.type}|${normalizeDescription(t.description)}`;
}

async function syncHouseholdInternal(householdId) {
  const client = plaidClient();
  const itemsSnap = await db.collection('plaid_items').where('householdId', '==', householdId).get();
  if (itemsSnap.empty) return;

  const householdRef = db.collection('households').doc(householdId);
  const allAccounts = [];
  const txUpdates = new Map(); // plaidTransactionId -> transaction object, or { _removed: true }
  let addedCount = 0;
  let modifiedCount = 0;
  let removedCount = 0;

  for (const itemDoc of itemsSnap.docs) {
    const { accessToken, institutionName } = itemDoc.data();
    let cursor = itemDoc.data().cursor || null;

    const accountsResp = await client.accountsGet({ access_token: accessToken });
    accountsResp.data.accounts.forEach((a) => {
      allAccounts.push({
        id: a.account_id,
        itemId: itemDoc.id,
        name: a.name,
        mask: a.mask,
        type: a.type,
        subtype: a.subtype,
        balance: a.balances.current,
        available: a.balances.available,
        institutionName: institutionName || 'Bank',
      });
    });

    let hasMore = true;
    while (hasMore) {
      const resp = await client.transactionsSync({
        access_token: accessToken,
        cursor: cursor || undefined,
      });

      resp.data.added.forEach((tx) => {
        addedCount++;
        const primary = primaryCategory(tx);
        txUpdates.set(tx.transaction_id, {
          id: `plaid:${tx.transaction_id}`,
          plaidTransactionId: tx.transaction_id,
          plaidAccountId: tx.account_id,
          date: tx.date,
          description: tx.merchant_name || tx.name || 'Transaction',
          category: CATEGORY_MAP[primary] || 'Other',
          amount: Math.abs(tx.amount),
          // Plaid convention: positive amount = money leaving the account (expense),
          // negative = money coming in (income/refund).
          type: tx.amount > 0 ? 'expense' : 'income',
          source: 'plaid',
          excludeFromTotals: isTransferCategory(primary) ? true : undefined,
          addedAt: Date.now(),
        });
      });
      resp.data.modified.forEach((tx) => {
        modifiedCount++;
        const primary = primaryCategory(tx);
        txUpdates.set(tx.transaction_id, {
          id: `plaid:${tx.transaction_id}`,
          plaidTransactionId: tx.transaction_id,
          plaidAccountId: tx.account_id,
          date: tx.date,
          description: tx.merchant_name || tx.name || 'Transaction',
          category: CATEGORY_MAP[primary] || 'Other',
          amount: Math.abs(tx.amount),
          type: tx.amount > 0 ? 'expense' : 'income',
          source: 'plaid',
          excludeFromTotals: isTransferCategory(primary) ? true : undefined,
        });
      });
      resp.data.removed.forEach((tx) => {
        removedCount++;
        txUpdates.set(tx.transaction_id, { _removed: true });
      });

      cursor = resp.data.next_cursor;
      hasMore = resp.data.has_more;
    }

    await itemDoc.ref.update({ cursor });
  }

  let dedupedCount = 0;

  await db.runTransaction(async (t) => {
    const snap = await t.get(householdRef);
    const data = snap.data() || {};
    const existing = data.transactions || [];
    const byPlaidId = new Map(existing.filter((tx) => tx.plaidTransactionId).map((tx) => [tx.plaidTransactionId, tx]));

    for (const [plaidId, val] of txUpdates) {
      if (val._removed) {
        // The bank says this transaction is gone (e.g. a pending charge that
        // never posted). Don't delete it — flag it so the person can review
        // and decide, same as a duplicate.
        const existingTx = byPlaidId.get(plaidId);
        if (existingTx && !existingTx.pendingRemoval) {
          byPlaidId.set(plaidId, { ...existingTx, pendingRemoval: true, pendingRemovalReason: 'removed_by_bank' });
        }
        continue;
      }
      const existingTx = byPlaidId.get(plaidId);
      if (existingTx) {
        // Already known locally: refresh only what Plaid actually owns (date,
        // description, amount, type, account). Anything the user edited by
        // hand in the app — category, splits, payment source, the transfer
        // flag, savings allocations, or a review decision — is preserved as-is.
        byPlaidId.set(plaidId, {
          ...val,
          category: existingTx.category,
          splits: existingTx.splits,
          paymentSource: existingTx.paymentSource,
          excludeFromTotals: existingTx.excludeFromTotals,
          savingsAllocations: existingTx.savingsAllocations,
          savingsDirection: existingTx.savingsDirection,
          savingsTransferConfirmed: existingTx.savingsTransferConfirmed,
          pendingRemoval: existingTx.pendingRemoval,
          pendingRemovalReason: existingTx.pendingRemovalReason,
          duplicateOfId: existingTx.duplicateOfId,
          addedAt: existingTx.addedAt,
        });
      } else {
        // Brand new transaction: use Plaid's auto-categorization/transfer guess as-is.
        byPlaidId.set(plaidId, val);
      }
    }

    // Cross-connection duplicate guard: if a bank was disconnected and
    // reconnected, Plaid issues brand-new transaction_ids for the same
    // real-world transactions it re-pulls, which the ID-based merge above
    // can't catch. Catch those here by matching date+amount+type+description
    // among Plaid-sourced transactions. Nothing is dropped — the likely
    // duplicate is flagged for review, keeping whichever copy is tied to a
    // currently-connected account as the presumed "real" one.
    const connectedAccountIds = new Set(allAccounts.map((a) => a.id));
    const bySignature = new Map();
    for (const tx of byPlaidId.values()) {
      const sig = txSignature(tx);
      if (!bySignature.has(sig)) bySignature.set(sig, []);
      bySignature.get(sig).push(tx);
    }
    for (const group of bySignature.values()) {
      if (group.length < 2) continue;
      const keeper = group.find((tx) => connectedAccountIds.has(tx.plaidAccountId)) || group[0];
      for (const tx of group) {
        if (tx === keeper || tx.pendingRemoval) continue;
        dedupedCount++;
        byPlaidId.set(tx.plaidTransactionId, {
          ...tx,
          pendingRemoval: true,
          pendingRemovalReason: 'duplicate',
          duplicateOfId: keeper.id,
        });
      }
    }

    const nonPlaid = existing.filter((tx) => !tx.plaidTransactionId);
    const merged = [...nonPlaid, ...Array.from(byPlaidId.values())];

    t.set(householdRef, { transactions: merged, accounts: allAccounts }, { merge: true });
  });

  return { added: addedCount, modified: modifiedCount, removed: removedCount, deduped: dedupedCount };
}

exports.createLinkToken = onCall({ secrets: [PLAID_CLIENT_ID, PLAID_SECRET] }, withErrorReporting(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
  const householdId = await getHouseholdIdForUser(request.auth.uid);
  await assertMember(householdId, request.auth.uid);

  const client = plaidClient();
  const resp = await client.linkTokenCreate({
    user: { client_user_id: householdId },
    client_name: 'Family Budget',
    products: ['transactions'],
    country_codes: ['US'],
    language: 'en',
  });
  return { linkToken: resp.data.link_token };
}));

exports.exchangePublicToken = onCall({ secrets: [PLAID_CLIENT_ID, PLAID_SECRET] }, withErrorReporting(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
  const { publicToken, institutionName } = request.data || {};
  if (!publicToken) throw new HttpsError('invalid-argument', 'Missing publicToken.');

  const householdId = await getHouseholdIdForUser(request.auth.uid);
  await assertMember(householdId, request.auth.uid);

  const client = plaidClient();
  const exchange = await client.itemPublicTokenExchange({ public_token: publicToken });

  await db.collection('plaid_items').doc(exchange.data.item_id).set({
    householdId,
    accessToken: exchange.data.access_token,
    institutionName: institutionName || 'Bank',
    cursor: null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  const summary = await syncHouseholdInternal(householdId);
  return { ok: true, ...summary };
}));

exports.syncHousehold = onCall({ secrets: [PLAID_CLIENT_ID, PLAID_SECRET] }, withErrorReporting(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
  const householdId = await getHouseholdIdForUser(request.auth.uid);
  await assertMember(householdId, request.auth.uid);
  const summary = await syncHouseholdInternal(householdId);
  return { ok: true, ...summary };
}));

exports.disconnectBank = onCall({ secrets: [PLAID_CLIENT_ID, PLAID_SECRET] }, withErrorReporting(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
  const { itemId } = request.data || {};
  if (!itemId) throw new HttpsError('invalid-argument', 'Missing itemId.');

  const householdId = await getHouseholdIdForUser(request.auth.uid);
  await assertMember(householdId, request.auth.uid);

  const itemRef = db.collection('plaid_items').doc(itemId);
  const itemSnap = await itemRef.get();
  if (!itemSnap.exists || itemSnap.data().householdId !== householdId) {
    throw new HttpsError('permission-denied', "That connection wasn't found for this household.");
  }

  const client = plaidClient();
  try {
    await client.itemRemove({ access_token: itemSnap.data().accessToken });
  } catch (e) {
    // Even if Plaid's side fails (e.g. already revoked by the bank), still
    // remove our local record so it doesn't stay stuck in the UI.
    console.error('Plaid itemRemove failed, continuing with local cleanup:', e.response?.data || e);
  }

  await itemRef.delete();

  const householdRef = db.collection('households').doc(householdId);
  await db.runTransaction(async (t) => {
    const snap = await t.get(householdRef);
    const data = snap.data() || {};
    const remainingAccounts = (data.accounts || []).filter((a) => a.itemId !== itemId);
    t.set(householdRef, { accounts: remainingAccounts }, { merge: true });
  });

  return { ok: true };
}));

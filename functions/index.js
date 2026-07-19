const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const { Configuration, PlaidApi, PlaidEnvironments } = require('plaid');

admin.initializeApp();
const db = admin.firestore();

// Switch to 'production' once you've tested end-to-end in Sandbox and are
// ready to connect real accounts. Plaid's free Trial plan runs on the
// 'production' environment with real (but limited) accounts — Sandbox is
// purely fake test banks for safe development.
const PLAID_ENV = 'sandbox';

const PLAID_CLIENT_ID = defineSecret('PLAID_CLIENT_ID');
const PLAID_SECRET = defineSecret('PLAID_SECRET');

function plaidClient() {
  const configuration = new Configuration({
    basePath: PlaidEnvironments[PLAID_ENV],
    baseOptions: {
      headers: {
        'PLAID-CLIENT-ID': PLAID_CLIENT_ID.value(),
        'PLAID-SECRET': PLAID_SECRET.value(),
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

function mapCategory(plaidTx) {
  const primary = plaidTx.personal_finance_category?.primary || (plaidTx.category && plaidTx.category[0]) || '';
  return CATEGORY_MAP[primary] || 'Other';
}

async function syncHouseholdInternal(householdId) {
  const client = plaidClient();
  const itemsSnap = await db.collection('plaid_items').where('householdId', '==', householdId).get();
  if (itemsSnap.empty) return;

  const householdRef = db.collection('households').doc(householdId);
  const allAccounts = [];
  const txUpdates = new Map(); // plaidTransactionId -> transaction object, or { _removed: true }

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

      [...resp.data.added, ...resp.data.modified].forEach((tx) => {
        txUpdates.set(tx.transaction_id, {
          id: `plaid:${tx.transaction_id}`,
          plaidTransactionId: tx.transaction_id,
          plaidAccountId: tx.account_id,
          date: tx.date,
          description: tx.merchant_name || tx.name || 'Transaction',
          category: mapCategory(tx),
          amount: Math.abs(tx.amount),
          // Plaid convention: positive amount = money leaving the account (expense),
          // negative = money coming in (income/refund).
          type: tx.amount > 0 ? 'expense' : 'income',
          source: 'plaid',
        });
      });
      resp.data.removed.forEach((tx) => {
        txUpdates.set(tx.transaction_id, { _removed: true });
      });

      cursor = resp.data.next_cursor;
      hasMore = resp.data.has_more;
    }

    await itemDoc.ref.update({ cursor });
  }

  await db.runTransaction(async (t) => {
    const snap = await t.get(householdRef);
    const data = snap.data() || {};
    const existing = data.transactions || [];
    const byPlaidId = new Map(existing.filter((tx) => tx.plaidTransactionId).map((tx) => [tx.plaidTransactionId, tx]));

    for (const [plaidId, val] of txUpdates) {
      if (val._removed) byPlaidId.delete(plaidId);
      else byPlaidId.set(plaidId, val);
    }

    const nonPlaid = existing.filter((tx) => !tx.plaidTransactionId);
    const merged = [...nonPlaid, ...Array.from(byPlaidId.values())];

    t.set(householdRef, { transactions: merged, accounts: allAccounts }, { merge: true });
  });
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

  await syncHouseholdInternal(householdId);
  return { ok: true };
}));

exports.syncHousehold = onCall({ secrets: [PLAID_CLIENT_ID, PLAID_SECRET] }, withErrorReporting(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
  const householdId = await getHouseholdIdForUser(request.auth.uid);
  await assertMember(householdId, request.auth.uid);
  await syncHouseholdInternal(householdId);
  return { ok: true };
}));

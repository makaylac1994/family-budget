import React, { useState, useEffect, useRef } from 'react';
import { db, auth } from './firebase';
import { doc, onSnapshot, setDoc, getDoc, getDocs, updateDoc, arrayUnion, collection, writeBatch, deleteField } from 'firebase/firestore';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { Wallet, Receipt, PiggyBank, CalendarClock, Coins, Settings2, Landmark, Loader2, Gift, Calculator } from 'lucide-react';
import { COLORS } from './lib/constants';
import { CategoryColorContext } from './lib/categoryColor';
import { AccountNicknameContext } from './lib/accountNicknames';
import { generateInviteCode, currentMonthStr, groupTransactionsByMonth, uid, todayStr } from './lib/helpers';
import { AuthGate } from './auth/AuthGate';
import { HouseholdSetup } from './auth/HouseholdSetup';
import { DashboardView } from './views/DashboardView';
import { LedgerView } from './views/LedgerView';
import { AccountsView } from './views/AccountsView';
import { BudgetsView } from './views/BudgetsView';
import { SavingsView } from './views/SavingsView';
import { AnnualView } from './views/AnnualView';
import { SettingsView } from './views/SettingsView';
import { GiftsView } from './views/GiftsView';
import { PlannerView } from './views/PlannerView';

/* ---------------------------------- App ---------------------------------- */

const TABS = [
  { id: 'dashboard', label: 'Dashboard', icon: Wallet },
  { id: 'ledger', label: 'Ledger', icon: Receipt },
  { id: 'accounts', label: 'Accounts', icon: Landmark },
  { id: 'budgets', label: 'Budgets', icon: PiggyBank },
  { id: 'savings', label: 'Savings', icon: Coins },
  { id: 'annual', label: 'Annual', icon: CalendarClock },
  { id: 'gifts', label: 'Gifts', icon: Gift },
  { id: 'planner', label: 'Planner', icon: Calculator },
  { id: 'settings', label: 'Settings', icon: Settings2 },
];

export default function App() {
  const [authLoading, setAuthLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [householdId, setHouseholdId] = useState(null);
  const [householdLookupDone, setHouseholdLookupDone] = useState(false);
  const [inviteCode, setInviteCode] = useState('');

  const [householdDocReady, setHouseholdDocReady] = useState(false);
  const [txMonthsReady, setTxMonthsReady] = useState(false);
  const loading = !householdDocReady || !txMonthsReady;
  // Last-known-in-Firestore content per txMonths/{monthKey} doc, so
  // updateTransactions can diff against it and only write changed months.
  const txMonthsRef = useRef(new Map());
  const [tab, setTab] = useState('dashboard');
  const [month, setMonth] = useState(currentMonthStr());
  const [ledgerCatFilter, setLedgerCatFilter] = useState('All');
  const [ledgerSourceFilter, setLedgerSourceFilter] = useState('All');
  const [ledgerTypeFilter, setLedgerTypeFilter] = useState('All');
  const [ledgerBucketFilter, setLedgerBucketFilter] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [budgets, setBudgets] = useState({});
  const [goals, setGoals] = useState([]);
  const [bills, setBills] = useState([]);
  const [transferPlans, setTransferPlans] = useState([]);
  const [upcomingCharges, setUpcomingCharges] = useState([]);
  const [categoryColors, setCategoryColors] = useState({});
  const [accountNicknames, setAccountNicknames] = useState({});
  const [hiddenCategories, setHiddenCategories] = useState([]);
  const [categoryMemory, setCategoryMemory] = useState({ exact: {}, merchant: {} });
  const [accounts, setAccounts] = useState([]);
  const [lastSyncAt, setLastSyncAt] = useState(null);
  const [notes, setNotes] = useState([]);
  const [giftOccasions, setGiftOccasions] = useState([]);
  const [annualAccountId, setAnnualAccountId] = useState(null);

  // Track sign-in state.
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthLoading(false);
      setHouseholdId(null);
      setHouseholdLookupDone(false);
    });
    return unsub;
  }, []);

  // Once signed in, look up which household this account belongs to.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'users', user.uid));
        if (!cancelled) {
          setHouseholdId(snap.exists() ? snap.data().householdId || null : null);
          setHouseholdLookupDone(true);
        }
      } catch (e) {
        console.error('Household lookup failed', e);
        if (!cancelled) setHouseholdLookupDone(true);
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  // Once a household is known, subscribe to it live — everything except
  // transactions, which live in the txMonths subcollection (below).
  useEffect(() => {
    if (!householdId) return;
    setHouseholdDocReady(false);
    const ref = doc(db, 'households', householdId);
    const unsub = onSnapshot(ref, (snap) => {
      const d = snap.data();
      setBudgets(d?.budgets || {});
      setGoals(d?.goals || []);
      setBills(d?.bills || []);
      setTransferPlans(d?.transferPlans || []);
      setUpcomingCharges(d?.upcomingCharges || []);
      setCategoryColors(d?.categoryColors || {});
      setAccountNicknames(d?.accountNicknames || {});
      setHiddenCategories(d?.hiddenCategories || []);
      setCategoryMemory(d?.categoryMemory || { exact: {}, merchant: {} });
      setAccounts(d?.accounts || []);
      setLastSyncAt(d?.lastSyncAt || null);
      setNotes(Array.isArray(d?.notes)
        ? d.notes
        : (d?.notes ? [{ id: uid(), text: d.notes, createdAt: Date.now() }] : []));
      setGiftOccasions(d?.giftOccasions || []);
      setAnnualAccountId(d?.annualAccountId || null);
      setInviteCode(d?.inviteCode || '');
      setHouseholdDocReady(true);
    }, (err) => {
      console.error('Sync failed', err);
      setHouseholdDocReady(true);
    });
    return unsub;
  }, [householdId]);

  // Transactions live in households/{id}/txMonths/{YYYY-MM} docs (bucketed by
  // month) instead of one giant array on the household doc, so a single edit
  // only ever has to rewrite the month(s) it actually touched.
  useEffect(() => {
    if (!householdId) return;
    setTxMonthsReady(false);
    const colRef = collection(db, 'households', householdId, 'txMonths');
    const unsub = onSnapshot(colRef, (snap) => {
      const grouped = new Map();
      snap.forEach((docSnap) => grouped.set(docSnap.id, docSnap.data().transactions || []));
      txMonthsRef.current = grouped;
      setTransactions(Array.from(grouped.values()).flat());
      setTxMonthsReady(true);
    }, (err) => {
      console.error('Transaction sync failed', err);
      setTxMonthsReady(true);
    });
    return unsub;
  }, [householdId]);

  function syncField(field, value) {
    if (!householdId) return;
    setDoc(doc(db, 'households', householdId), { [field]: value }, { merge: true })
      .catch((e) => {
        console.error('Save failed', e);
        window.alert(`Couldn't save your change — it may not persist. (${e.message})`);
      });
  }

  async function createHousehold() {
    const householdRef = doc(collection(db, 'households'));
    const code = generateInviteCode();
    await setDoc(householdRef, {
      members: [user.uid],
      inviteCode: code,
      budgets: {}, goals: [], bills: [], transferPlans: [],
      categoryColors: {}, hiddenCategories: [], categoryMemory: { exact: {}, merchant: {} },
    });
    await setDoc(doc(db, 'invites', code), { householdId: householdRef.id });
    await setDoc(doc(db, 'users', user.uid), { householdId: householdRef.id }, { merge: true });
    setHouseholdId(householdRef.id);
  }

  async function joinHousehold(code) {
    const inviteSnap = await getDoc(doc(db, 'invites', code.toUpperCase()));
    if (!inviteSnap.exists()) throw new Error("That invite code wasn't found. Double check it with whoever sent it.");
    const { householdId: joinedId } = inviteSnap.data();
    await updateDoc(doc(db, 'households', joinedId), { members: arrayUnion(user.uid) });
    await setDoc(doc(db, 'users', user.uid), { householdId: joinedId }, { merge: true });
    setHouseholdId(joinedId);
  }

  function updateTransactions(next) {
    setTransactions(next);
    if (!householdId) return;

    const nextGrouped = groupTransactionsByMonth(next);
    const prevGrouped = txMonthsRef.current;
    const allMonths = new Set([...prevGrouped.keys(), ...nextGrouped.keys()]);

    const batch = writeBatch(db);
    let hasChanges = false;

    for (const month of allMonths) {
      const nextArr = nextGrouped.get(month) || [];
      const prevArr = prevGrouped.get(month) || [];
      // Content comparison, not reference equality — most call sites rebuild
      // the whole array via .map()/.filter() every time even when a given
      // month's actual contents didn't change.
      if (JSON.stringify(nextArr) === JSON.stringify(prevArr)) continue;
      hasChanges = true;
      const monthRef = doc(db, 'households', householdId, 'txMonths', month);
      if (nextArr.length === 0) {
        batch.delete(monthRef);
      } else {
        batch.set(monthRef, { transactions: nextArr });
      }
    }

    if (!hasChanges) return;

    // Optimistic local baseline so a rapid second edit (before the listener
    // echoes this write back) diffs against what we just sent, not stale data.
    txMonthsRef.current = nextGrouped;

    batch.commit().catch((e) => {
      console.error('Save failed', e);
      window.alert(`Couldn't save your change — it may not persist. (${e.message})`);
    });
  }
  // One-time cleanup for households created before transactions moved into
  // txMonths: copies the old transactions array off the household doc into
  // month-bucket docs, verifies the count, then removes the old field. Only
  // ever does the full copy when txMonths is confirmed empty, so it can never
  // stomp real edits made through the new storage after a first, interrupted
  // attempt — see the guard below.
  async function migrateLegacyTransactions() {
    if (!householdId) return;
    const householdRef = doc(db, 'households', householdId);
    const snap = await getDoc(householdRef);
    const legacy = snap.data()?.transactions;

    if (!Array.isArray(legacy) || legacy.length === 0) {
      window.alert('No old-format transactions to migrate — you may already be on the new storage.');
      return;
    }

    const monthsSnap = await getDocs(collection(db, 'households', householdId, 'txMonths'));

    if (!monthsSnap.empty) {
      let liveCount = 0;
      monthsSnap.forEach((d) => { liveCount += (d.data().transactions || []).length; });
      if (liveCount === legacy.length) {
        // Counts match: an earlier attempt wrote everything correctly, it just
        // never got to remove the old field. Safe to finish that step only.
        await setDoc(householdRef, { transactions: deleteField() }, { merge: true });
        window.alert('Finished cleaning up old storage — nothing else to do.');
      } else {
        window.alert(
          `Storage looks partially migrated (old field has ${legacy.length} transactions, new storage has ${liveCount}) ` +
          `and the counts don't match. Stopping here rather than guessing — check the Firestore console before retrying.`
        );
      }
      return;
    }

    const grouped = groupTransactionsByMonth(legacy);
    const batch = writeBatch(db);
    for (const [month, txs] of grouped) {
      batch.set(doc(db, 'households', householdId, 'txMonths', month), { transactions: txs });
    }
    await batch.commit();

    const verifySnap = await getDocs(collection(db, 'households', householdId, 'txMonths'));
    let verifiedCount = 0;
    verifySnap.forEach((d) => { verifiedCount += (d.data().transactions || []).length; });

    if (verifiedCount !== legacy.length) {
      window.alert(
        `Migration verification failed: expected ${legacy.length}, found ${verifiedCount}. ` +
        `The old data was NOT removed — nothing is lost. Please check the Firestore console before retrying.`
      );
      return;
    }

    await setDoc(householdRef, { transactions: deleteField() }, { merge: true });
    window.alert(`Migration complete: ${legacy.length} transactions moved successfully.`);
  }

  function updateBudgets(next) { setBudgets(next); syncField('budgets', next); }
  function updateGoals(next) { setGoals(next); syncField('goals', next); }
  function updateBills(next) { setBills(next); syncField('bills', next); }
  function updateTransferPlans(next) { setTransferPlans(next); syncField('transferPlans', next); }
  function updateUpcomingCharges(next) { setUpcomingCharges(next); syncField('upcomingCharges', next); }

  // Marks a recurring transfer plan as done for the real current month: creates
  // the actual ledger transaction (so the bucket's saved total and the Savings
  // tab's real-balance reconciliation stay correct) and records which
  // transaction it created, so undoTransferPlan can find and reverse it.
  function completeTransferPlan(planId) {
    const plan = transferPlans.find((p) => p.id === planId);
    if (!plan) return;
    const bucket = goals.find((g) => g.id === plan.bucketId);
    if (!bucket) {
      window.alert("That bucket no longer exists — pick a different one for this transfer.");
      return;
    }
    const currentMonth = currentMonthStr();
    if (plan.completions?.[currentMonth]) return;

    const txId = uid();
    updateTransactions([{
      id: txId,
      date: todayStr(),
      description: plan.name,
      category: bucket.name,
      amount: plan.amount,
      type: 'expense',
      paymentSource: 'bank',
      excludeFromTotals: true,
      savingsAllocations: [{ id: uid(), bucketId: plan.bucketId, amount: plan.amount }],
      savingsDirection: 'deposit',
      savingsTransferConfirmed: true,
    }, ...transactions]);

    updateGoals(goals.map((g) => (g.id === plan.bucketId ? { ...g, saved: (g.saved || 0) + plan.amount } : g)));

    updateTransferPlans(transferPlans.map((p) => (
      p.id === planId ? { ...p, completions: { ...(p.completions || {}), [currentMonth]: txId } } : p
    )));
  }

  function undoTransferPlan(planId) {
    const plan = transferPlans.find((p) => p.id === planId);
    if (!plan) return;
    const currentMonth = currentMonthStr();
    const txId = plan.completions?.[currentMonth];
    if (!txId) return;
    if (!window.confirm("Undo this transfer? This deletes the transaction it created and reverses the bucket deposit.")) return;

    const tx = transactions.find((t) => t.id === txId);
    if (tx?.savingsAllocations?.length) {
      updateGoals(goals.map((g) => (
        g.id === plan.bucketId ? { ...g, saved: Math.max(0, (g.saved || 0) - tx.savingsAllocations[0].amount) } : g
      )));
    }
    updateTransactions(transactions.filter((t) => t.id !== txId));

    const nextCompletions = { ...(plan.completions || {}) };
    delete nextCompletions[currentMonth];
    updateTransferPlans(transferPlans.map((p) => (p.id === planId ? { ...p, completions: nextCompletions } : p)));
  }
  function updateCategoryColors(next) { setCategoryColors(next); syncField('categoryColors', next); }
  function updateAccountNicknames(next) { setAccountNicknames(next); syncField('accountNicknames', next); }
  function updateHiddenCategories(next) { setHiddenCategories(next); syncField('hiddenCategories', next); }
  function updateCategoryMemory(next) { setCategoryMemory(next); syncField('categoryMemory', next); }
  function updateNotes(next) { setNotes(next); syncField('notes', next); }
  function updateGiftOccasions(next) { setGiftOccasions(next); syncField('giftOccasions', next); }
  function updateAnnualAccountId(next) { setAnnualAccountId(next); syncField('annualAccountId', next); }

  function renameCategory(oldName, newName) {
    if (!newName || newName === oldName) return;

    const nextTransactions = transactions.map((t) => {
      let next = t;
      if (t.category === oldName) next = { ...next, category: newName };
      if (t.splits && t.splits.some((s) => s.category === oldName)) {
        next = { ...next, splits: t.splits.map((s) => (s.category === oldName ? { ...s, category: newName } : s)) };
      }
      return next;
    });
    updateTransactions(nextTransactions);

    if (Object.prototype.hasOwnProperty.call(budgets, oldName)) {
      const nextBudgets = { ...budgets };
      nextBudgets[newName] = nextBudgets[oldName];
      delete nextBudgets[oldName];
      updateBudgets(nextBudgets);
    }

    if (categoryColors[oldName]) {
      const nextColors = { ...categoryColors };
      nextColors[newName] = nextColors[oldName];
      delete nextColors[oldName];
      updateCategoryColors(nextColors);
    }

    if (hiddenCategories.includes(oldName)) {
      updateHiddenCategories(hiddenCategories.map((c) => (c === oldName ? newName : c)));
    }

    const nextExact = {};
    Object.entries(categoryMemory.exact || {}).forEach(([k, v]) => { nextExact[k] = v === oldName ? newName : v; });
    const nextMerchant = {};
    Object.entries(categoryMemory.merchant || {}).forEach(([k, v]) => { nextMerchant[k] = v === oldName ? newName : v; });
    updateCategoryMemory({ exact: nextExact, merchant: nextMerchant });

    if (bills.some((b) => b.category === oldName)) {
      updateBills(bills.map((b) => (b.category === oldName ? { ...b, category: newName } : b)));
    }
  }

  function goToLedger(type, source) {
    setLedgerTypeFilter(type || 'All');
    setLedgerSourceFilter(source || 'All');
    setLedgerCatFilter('All');
    setLedgerBucketFilter(null);
    setTab('ledger');
  }

  function goToLedgerBucket(bucketId) {
    setLedgerTypeFilter('All');
    setLedgerSourceFilter('All');
    setLedgerCatFilter('All');
    setLedgerBucketFilter(bucketId);
    setTab('ledger');
  }

  function goToLedgerCategory(cat) {
    setLedgerTypeFilter('All');
    setLedgerSourceFilter('All');
    setLedgerBucketFilter(null);
    setLedgerCatFilter(cat);
    setTab('ledger');
  }

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: COLORS.bg }}>
        <Loader2 size={26} className="animate-spin" style={{ color: COLORS.violet }} />
      </div>
    );
  }

  if (!user) {
    return <AuthGate />;
  }

  if (!householdLookupDone) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: COLORS.bg }}>
        <Loader2 size={26} className="animate-spin" style={{ color: COLORS.violet }} />
      </div>
    );
  }

  if (!householdId) {
    return <HouseholdSetup onCreate={createHousehold} onJoin={joinHousehold} />;
  }

  return (
    <CategoryColorContext.Provider value={categoryColors}>
    <AccountNicknameContext.Provider value={accountNicknames}>
    <div className="min-h-screen font-body" style={{ background: COLORS.bg }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fredoka:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap');
        .font-display { font-family: 'Fredoka', sans-serif; }
        .font-body { font-family: 'Inter', sans-serif; }
      `}</style>

      <header className="px-5 sm:px-8 pt-6 pb-4 flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span style={{ fontSize: 26 }}>🫙</span>
            <h1 className="font-display font-bold text-2xl" style={{ color: COLORS.ink }}>Family Budget</h1>
          </div>
          <p className="font-body text-sm mt-0.5" style={{ color: COLORS.inkSoft }}>Your shared money, in one place.</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {inviteCode && (
            <button
              onClick={() => { navigator.clipboard?.writeText(inviteCode); }}
              className="font-body text-xs font-semibold rounded-full px-3 py-1.5"
              style={{ color: COLORS.violet, background: COLORS.violetSoft }}
              title="Invite code — click to copy, share with family members"
            >
              Invite: {inviteCode}
            </button>
          )}
          <button
            onClick={() => signOut(auth)}
            className="font-body text-xs font-semibold rounded-full px-3 py-1.5"
            style={{ color: COLORS.inkSoft, background: COLORS.surface, border: `1px solid ${COLORS.border}` }}
          >
            Sign out
          </button>
        </div>
      </header>

      <nav className="px-5 sm:px-8">
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className="flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold font-body whitespace-nowrap transition-colors"
                style={active
                  ? { background: COLORS.violet, color: '#fff', boxShadow: '0 3px 10px rgba(124,92,252,0.35)' }
                  : { background: COLORS.surface, color: COLORS.inkSoft, border: `1px solid ${COLORS.border}` }}
              >
                <Icon size={15} /> {t.label}
              </button>
            );
          })}
        </div>
      </nav>

      <main className="px-5 sm:px-8 py-6 max-w-6xl mx-auto">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-24">
            <Loader2 size={26} className="animate-spin" style={{ color: COLORS.violet }} />
            <p className="font-body text-sm mt-3" style={{ color: COLORS.inkSoft }}>Loading your data...</p>
          </div>
        ) : (
          <>
            {tab === 'dashboard' && (
              <DashboardView transactions={transactions} updateTransactions={updateTransactions} budgets={budgets} bills={bills} updateBills={updateBills} goals={goals} month={month} setMonth={setMonth} setTab={setTab} accounts={accounts} goToLedger={goToLedger} transferPlans={transferPlans} completeTransferPlan={completeTransferPlan} upcomingCharges={upcomingCharges} updateUpcomingCharges={updateUpcomingCharges} />
            )}
            {tab === 'ledger' && (
              <LedgerView transactions={transactions} updateTransactions={updateTransactions} budgets={budgets} month={month} setMonth={setMonth} hiddenCategories={hiddenCategories} updateHiddenCategories={updateHiddenCategories} categoryMemory={categoryMemory} updateCategoryMemory={updateCategoryMemory} goals={goals} updateGoals={updateGoals} accounts={accounts} catFilter={ledgerCatFilter} setCatFilter={setLedgerCatFilter} sourceFilter={ledgerSourceFilter} setSourceFilter={setLedgerSourceFilter} typeFilter={ledgerTypeFilter} setTypeFilter={setLedgerTypeFilter} lastSyncAt={lastSyncAt} bucketFilter={ledgerBucketFilter} setBucketFilter={setLedgerBucketFilter} renameCategory={renameCategory} categoryColors={categoryColors} updateCategoryColors={updateCategoryColors} />
            )}
            {tab === 'accounts' && (
              <AccountsView accounts={accounts} transactions={transactions} updateTransactions={updateTransactions} />
            )}
            {tab === 'budgets' && (
              <BudgetsView budgets={budgets} updateBudgets={updateBudgets} transactions={transactions} month={month} setMonth={setMonth} categoryColors={categoryColors} updateCategoryColors={updateCategoryColors} goals={goals} goToLedgerCategory={goToLedgerCategory} />
            )}
            {tab === 'savings' && (
              <SavingsView goals={goals} updateGoals={updateGoals} transactions={transactions} accounts={accounts} annualAccountId={annualAccountId} goToLedgerBucket={goToLedgerBucket} />
            )}
            {tab === 'annual' && (
              <AnnualView accounts={accounts} goals={goals} updateGoals={updateGoals} setTab={setTab} goToLedgerBucket={goToLedgerBucket} annualAccountId={annualAccountId} transactions={transactions} />
            )}
            {tab === 'gifts' && (
              <GiftsView giftOccasions={giftOccasions} updateGiftOccasions={updateGiftOccasions} goals={goals} updateGoals={updateGoals} transactions={transactions} updateTransactions={updateTransactions} />
            )}
            {tab === 'planner' && (
              <PlannerView transactions={transactions} goals={goals} accounts={accounts} />
            )}
            {tab === 'settings' && (
              <SettingsView bills={bills} updateBills={updateBills} month={month} budgets={budgets} transactions={transactions} goals={goals} hiddenCategories={hiddenCategories} updateHiddenCategories={updateHiddenCategories} notes={notes} updateNotes={updateNotes} accounts={accounts} annualAccountId={annualAccountId} updateAnnualAccountId={updateAnnualAccountId} renameCategory={renameCategory} categoryColors={categoryColors} updateCategoryColors={updateCategoryColors} migrateLegacyTransactions={migrateLegacyTransactions} transferPlans={transferPlans} updateTransferPlans={updateTransferPlans} completeTransferPlan={completeTransferPlan} undoTransferPlan={undoTransferPlan} accountNicknames={accountNicknames} updateAccountNicknames={updateAccountNicknames} />
            )}
          </>
        )}
      </main>
    </div>
    </AccountNicknameContext.Provider>
    </CategoryColorContext.Provider>
  );
}

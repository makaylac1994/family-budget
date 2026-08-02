import React, { useState, useMemo } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend } from 'recharts';
import {
  Wallet, Receipt, PiggyBank, Target, CalendarClock, TrendingUp, TrendingDown, Check,
  Flame, Settings2, Coins, Landmark, CreditCard, ChevronDown, Repeat, Flag, Plus, X,
} from 'lucide-react';
import { COLORS } from '../lib/constants';
import { CategoryColorContext, categoryColor } from '../lib/categoryColor';
import { isSavingsAccount, isCheckingAccount, indexById, formatCurrency, nonBucketAmount, paymentSourceFor, currentMonthStr, toggleMonthEntry, isTransferPlanDone, uid, budgetAmountForMonth, monthlyNetSeries, shiftMonth, monthLabel } from '../lib/helpers';
import { Card, MonthNav, EmptyState, CategoryBadge, JarBar, TextInput, GhostButton } from '../components/ui';

/* ---------------------------------- Dashboard ---------------------------------- */

export function DashboardView({ transactions, updateTransactions, budgets, bills, updateBills, goals, month, setMonth, setTab, accounts, goToLedger, transferPlans, completeTransferPlan, upcomingCharges, updateUpcomingCharges }) {
  const categoryColors = React.useContext(CategoryColorContext);
  const [hiddenChartCats, setHiddenChartCats] = useState([]);
  const [showChartFilter, setShowChartFilter] = useState(false);
  const bucketNameSet = useMemo(() => new Set(goals.map((g) => g.name)), [goals]);
  const accountsById = useMemo(() => indexById(accounts), [accounts]);
  const monthTx = useMemo(() => transactions.filter((t) => t.date.startsWith(month)), [transactions, month]);
  const income = monthTx.filter((t) => t.type === 'income' && !t.excludeFromTotals).reduce((s, t) => s + t.amount, 0);
  const expenseTx = monthTx.filter((t) => t.type === 'expense' && !t.excludeFromTotals);
  const expense = expenseTx.reduce((s, t) => s + nonBucketAmount(t, bucketNameSet), 0);
  const billsExpense = expenseTx
    .filter((t) => paymentSourceFor(t, accountsById) === 'bank')
    .reduce((s, t) => s + nonBucketAmount(t, bucketNameSet), 0);
  const cardExpense = expenseTx
    .filter((t) => paymentSourceFor(t, accountsById) === 'card')
    .reduce((s, t) => s + nonBucketAmount(t, bucketNameSet), 0);
  const net = income - expense;
  const totalSaved = goals.reduce((s, g) => s + (g.saved || 0), 0);
  const realSavingsTotal = (accounts || [])
    .filter(isSavingsAccount)
    .reduce((s, a) => s + (Number(a.balance) || 0), 0);
  const plannedBudgetTotal = Object.values(budgets).reduce((s, v) => s + budgetAmountForMonth(v, month), 0);

  const trendMonths = useMemo(() => {
    const end = currentMonthStr();
    return Array.from({ length: 6 }, (_, i) => shiftMonth(end, i - 5));
  }, []);
  const netSeries = useMemo(
    () => monthlyNetSeries(transactions, bucketNameSet, trendMonths),
    [transactions, bucketNameSet, trendMonths]
  );

  const byCategory = {};
  expenseTx.forEach((t) => {
    if (t.splits && t.splits.length) {
      t.splits.forEach((s) => {
        if (bucketNameSet.has(s.category)) return;
        byCategory[s.category] = (byCategory[s.category] || 0) + s.amount;
      });
    } else if (!bucketNameSet.has(t.category)) {
      byCategory[t.category] = (byCategory[t.category] || 0) + t.amount;
    }
  });
  const pieData = Object.entries(byCategory).map(([name, value]) => ({ name, value }));
  const visiblePieData = pieData.filter((d) => !hiddenChartCats.includes(d.name));

  function toggleChartCat(cat) {
    setHiddenChartCats((prev) => (prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]));
  }

  const budgetRows = Object.entries(budgets).map(([cat, v]) => ({
    cat, limit: budgetAmountForMonth(v, month), spent: byCategory[cat] || 0,
  })).sort((a, b) => (b.spent / (b.limit || 1)) - (a.spent / (a.limit || 1)));

  // Both the cushion and the checklist below are scoped to the real current
  // month (not whatever month is being browsed above via MonthNav) — the
  // historical stats above stay tied to the browsed month, but "what's safe
  // to spend" and "what do I need to do" are inherently about right now.
  const currentMonth = currentMonthStr();
  const unpaidBillsNow = bills
    .filter((b) => !(b.paidMonths || []).includes(currentMonth))
    .sort((a, b) => a.dueDay - b.dueDay);
  const unpaidBillsNowTotal = unpaidBillsNow.reduce((s, b) => s + (Number(b.amount) || 0), 0);

  const checkingTotal = (accounts || []).filter(isCheckingAccount).reduce((s, a) => s + (Number(a.balance) || 0), 0);
  const creditCardTotal = (accounts || []).filter((a) => a.type === 'credit').reduce((s, a) => s + (Number(a.balance) || 0), 0);
  const duePlans = (transferPlans || []).filter((p) => !isTransferPlanDone(p, transactions));
  const remainingTransfersTotal = duePlans.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const cushion = checkingTotal - creditCardTotal - unpaidBillsNowTotal - remainingTransfersTotal;

  function toggleBillPaid(id) {
    updateBills(bills.map((b) => (b.id === id ? { ...b, paidMonths: toggleMonthEntry(b.paidMonths, currentMonth) } : b)));
  }

  const flaggedItems = useMemo(
    () => transactions.filter((t) => t.flaggedForReview).sort((a, b) => b.date.localeCompare(a.date)),
    [transactions]
  );

  function unflagTransaction(id) {
    updateTransactions(transactions.map((t) => (t.id === id ? { ...t, flaggedForReview: false } : t)));
  }

  // A transaction that's been allocated to a bucket but not yet confirmed
  // as actually transferred (see the "Transferred" checkbox in the Ledger)
  // -- real money still waiting to move, distinct from a plain note.
  const pendingTransferItems = useMemo(
    () => transactions
      .filter((t) => t.savingsAllocations && t.savingsAllocations.length && t.savingsTransferConfirmed === false)
      .sort((a, b) => b.date.localeCompare(a.date)),
    [transactions]
  );

  function bucketName(id) {
    const g = goals.find((x) => x.id === id);
    return g ? g.name : 'Deleted bucket';
  }

  const [showAddCharge, setShowAddCharge] = useState(false);
  const [chargeForm, setChargeForm] = useState({ description: '', amount: '', note: '' });

  function addUpcomingCharge() {
    if (!chargeForm.description.trim()) return;
    updateUpcomingCharges([...upcomingCharges, {
      id: uid(),
      description: chargeForm.description.trim(),
      amount: chargeForm.amount ? parseFloat(chargeForm.amount) || 0 : undefined,
      note: chargeForm.note.trim() || undefined,
      createdAt: Date.now(),
    }]);
    setChargeForm({ description: '', amount: '', note: '' });
    setShowAddCharge(false);
  }

  function removeUpcomingCharge(id) {
    updateUpcomingCharges(upcomingCharges.filter((c) => c.id !== id));
  }

  const checklistItems = [
    ...unpaidBillsNow.map((b) => ({
      key: `bill-${b.id}`, kind: 'bill', name: b.name, amount: b.amount, dueDay: b.dueDay,
      onToggle: () => toggleBillPaid(b.id),
    })),
    ...duePlans.map((p) => ({
      key: `transfer-${p.id}`, kind: 'transfer', name: p.name, amount: p.amount, dueDay: p.dueDay,
      onToggle: () => completeTransferPlan(p.id),
    })),
  ].sort((a, b) => a.dueDay - b.dueDay);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display font-bold text-2xl" style={{ color: COLORS.ink }}>How this month's looking</h2>
          <p className="font-body text-sm" style={{ color: COLORS.inkSoft }}>A snapshot of where things stand.</p>
        </div>
        <MonthNav month={month} setMonth={setMonth} />
      </div>

      {accounts.length > 0 && (
        <Card style={cushion < 0 ? { borderColor: COLORS.coral, background: '#FFF5F5' } : {}}>
          <div className="flex items-center gap-2 mb-1" style={{ color: cushion >= 0 ? COLORS.teal : COLORS.coral }}>
            <Wallet size={16} /><span className="font-body text-xs font-semibold uppercase tracking-wide">Safe to spend</span>
          </div>
          <p className="font-display font-bold text-2xl" style={{ color: COLORS.ink }}>{formatCurrency(cushion)}</p>
          <p className="font-body text-xs mt-1" style={{ color: COLORS.inkSoft }}>
            {formatCurrency(checkingTotal)} checking &minus; {formatCurrency(creditCardTotal)} card &minus; {formatCurrency(unpaidBillsNowTotal)} unpaid bills &minus; {formatCurrency(remainingTransfersTotal)} planned transfers
          </p>
        </Card>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <Card onClick={() => goToLedger('income', 'All')}>
          <div className="flex items-center gap-2 mb-1" style={{ color: COLORS.teal }}>
            <TrendingUp size={16} /><span className="font-body text-xs font-semibold uppercase tracking-wide">Income</span>
          </div>
          <p className="font-display font-bold text-xl" style={{ color: COLORS.ink }}>{formatCurrency(income)}</p>
        </Card>
        <Card onClick={() => goToLedger('expense', 'All')}>
          <div className="flex items-center gap-2 mb-1" style={{ color: COLORS.coral }}>
            <TrendingDown size={16} /><span className="font-body text-xs font-semibold uppercase tracking-wide">Expenses</span>
          </div>
          <p className="font-display font-bold text-xl" style={{ color: COLORS.ink }}>{formatCurrency(expense)}</p>
          <div className="flex items-center gap-3 mt-1.5 pt-1.5" style={{ borderTop: `1px solid ${COLORS.border}` }}>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); goToLedger('expense', 'bank'); }}
              className="flex items-center gap-1 hover:underline"
              style={{ color: COLORS.inkSoft }}
            >
              <Landmark size={11} />
              <span className="font-body text-xs">{formatCurrency(billsExpense)}</span>
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); goToLedger('expense', 'card'); }}
              className="flex items-center gap-1 hover:underline"
              style={{ color: COLORS.inkSoft }}
            >
              <CreditCard size={11} />
              <span className="font-body text-xs">{formatCurrency(cardExpense)}</span>
            </button>
          </div>
        </Card>
        <Card onClick={() => goToLedger('All', 'All')}>
          <div className="flex items-center gap-2 mb-1" style={{ color: net >= 0 ? COLORS.violet : COLORS.coral }}>
            <Wallet size={16} /><span className="font-body text-xs font-semibold uppercase tracking-wide">Net</span>
          </div>
          <p className="font-display font-bold text-xl" style={{ color: COLORS.ink }}>{formatCurrency(net)}</p>
        </Card>
        <Card onClick={() => setTab('savings')}>
          <div className="flex items-center gap-2 mb-1" style={{ color: COLORS.gold }}>
            <PiggyBank size={16} /><span className="font-body text-xs font-semibold uppercase tracking-wide">Total saved</span>
          </div>
          <p className="font-display font-bold text-xl" style={{ color: COLORS.ink }}>{formatCurrency(realSavingsTotal || totalSaved)}</p>
          {realSavingsTotal > 0 && (
            <div className="flex items-center gap-1.5 mt-1.5 pt-1.5" style={{ borderTop: `1px solid ${COLORS.border}` }}>
              <span className="font-body text-xs" style={{ color: COLORS.inkSoft }}>Buckets: {formatCurrency(totalSaved)}</span>
              {Math.round((realSavingsTotal - totalSaved) * 100) !== 0 && (
                <Flame size={11} style={{ color: COLORS.gold }} />
              )}
            </div>
          )}
        </Card>
        <Card onClick={() => setTab('budgets')}>
          <div className="flex items-center gap-2 mb-1" style={{ color: COLORS.violet }}>
            <Target size={16} /><span className="font-body text-xs font-semibold uppercase tracking-wide">Planned budget</span>
          </div>
          <p className="font-display font-bold text-xl" style={{ color: COLORS.ink }}>{formatCurrency(plannedBudgetTotal)}</p>
        </Card>
      </div>

      <Card>
        <h3 className="font-display font-semibold mb-3" style={{ color: COLORS.ink }}>Monthly net</h3>
        <div style={{ width: '100%', height: 200 }}>
          <ResponsiveContainer>
            <BarChart data={netSeries.map((r) => ({ ...r, label: monthLabel(r.month) }))} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: COLORS.inkSoft }} axisLine={false} tickLine={false} tickFormatter={(v) => v.split(' ')[0]} />
              <YAxis tick={{ fontSize: 11, fill: COLORS.inkSoft }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${v}`} width={55} />
              <Tooltip formatter={(v) => formatCurrency(v)} labelFormatter={(v) => v} />
              <Bar dataKey="net" name="Net" radius={[6, 6, 6, 6]} maxBarSize={40}>
                {netSeries.map((r, i) => <Cell key={i} fill={r.net >= 0 ? COLORS.teal : COLORS.coral} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="grid lg:grid-cols-5 gap-5">
        <Card className="lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-display font-semibold" style={{ color: COLORS.ink }}>Spending by category</h3>
            {pieData.length > 0 && (
              <div className="relative">
                <button
                  onClick={() => setShowChartFilter((v) => !v)}
                  className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold font-body"
                  style={{ background: hiddenChartCats.length > 0 ? COLORS.violetSoft : COLORS.bg, color: hiddenChartCats.length > 0 ? COLORS.violet : COLORS.inkSoft }}
                >
                  <Settings2 size={12} />
                  {hiddenChartCats.length > 0 ? `${pieData.length - hiddenChartCats.length}/${pieData.length}` : 'Filter'}
                  <ChevronDown size={12} />
                </button>
                {showChartFilter && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setShowChartFilter(false)} />
                    <div
                      className="absolute right-0 mt-1.5 rounded-xl p-1.5 z-20"
                      style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, boxShadow: '0 8px 24px rgba(33,31,61,0.15)', width: 190, maxHeight: 240, overflowY: 'auto' }}
                    >
                      {pieData.map((entry) => {
                        const hidden = hiddenChartCats.includes(entry.name);
                        const c = categoryColor(entry.name, categoryColors);
                        return (
                          <div
                            key={entry.name}
                            onClick={() => toggleChartCat(entry.name)}
                            className="flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer font-body text-xs select-none"
                            style={{ color: hidden ? COLORS.inkSoft : COLORS.ink }}
                          >
                            <span
                              className="flex items-center justify-center flex-shrink-0"
                              style={{
                                width: 14, height: 14, borderRadius: 4,
                                border: `1.5px solid ${hidden ? COLORS.border : c}`,
                                background: hidden ? 'transparent' : c,
                              }}
                            >
                              {!hidden && <Check size={10} style={{ color: '#fff' }} strokeWidth={3} />}
                            </span>
                            <span style={{ width: 7, height: 7, borderRadius: 999, background: hidden ? COLORS.inkSoft : c, display: 'inline-block', flexShrink: 0 }} />
                            <span className="truncate">{entry.name}</span>
                          </div>
                        );
                      })}
                      {hiddenChartCats.length > 0 && (
                        <button
                          onClick={() => setHiddenChartCats([])}
                          className="w-full text-left font-body text-xs font-semibold px-2 py-1.5 mt-0.5 rounded-lg"
                          style={{ color: COLORS.violet }}
                        >
                          Show all
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
          {pieData.length === 0 ? (
            <EmptyState icon={Receipt} title="Nothing logged yet" subtitle="Add a transaction to see the breakdown here." />
          ) : visiblePieData.length === 0 ? (
            <div style={{ width: '100%', height: 220 }} className="flex items-center justify-center">
              <p className="font-body text-xs text-center max-w-[160px]" style={{ color: COLORS.inkSoft }}>
                Every category is hidden &mdash; open the filter to show one again.
              </p>
            </div>
          ) : (
            <div style={{ width: '100%', height: 220 }}>
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={visiblePieData} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={3}>
                    {visiblePieData.map((entry, i) => <Cell key={i} fill={categoryColor(entry.name, categoryColors)} />)}
                  </Pie>
                  <Tooltip formatter={(v) => formatCurrency(v)} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card className="lg:col-span-3">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-display font-semibold" style={{ color: COLORS.ink }}>Budget check-in</h3>
            <button onClick={() => setTab('budgets')} className="font-body text-xs font-semibold" style={{ color: COLORS.violet }}>Manage &rarr;</button>
          </div>
          {budgetRows.length === 0 ? (
            <EmptyState icon={PiggyBank} title="No budgets set" subtitle="Set monthly limits per category to track progress." />
          ) : (
            <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
              {budgetRows.map((r) => (
                <div key={r.cat}>
                  <div className="flex justify-between text-sm font-body mb-1">
                    <CategoryBadge cat={r.cat} />
                    <span style={{ color: COLORS.inkSoft }}>{formatCurrency(r.spent)} / {formatCurrency(r.limit)}</span>
                  </div>
                  <JarBar pct={r.limit ? (r.spent / r.limit) * 100 : 0} />
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-display font-semibold" style={{ color: COLORS.ink }}>Savings buckets</h3>
          <button onClick={() => setTab('savings')} className="font-body text-xs font-semibold" style={{ color: COLORS.violet }}>Manage &rarr;</button>
        </div>
        {goals.length === 0 ? (
          <EmptyState icon={Coins} title="No savings buckets yet" subtitle="Create one on the Savings tab to see it charted here." />
        ) : (
          <div style={{ width: '100%', height: 240 }}>
            <ResponsiveContainer>
              <BarChart data={goals.map((g) => ({ name: g.name, saved: g.saved || 0, target: g.target || 0 }))} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: COLORS.inkSoft }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: COLORS.inkSoft }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${v}`} width={55} />
                <Tooltip formatter={(v) => formatCurrency(v)} />
                <Legend wrapperStyle={{ fontSize: 12, fontFamily: 'Inter, sans-serif' }} />
                <Bar dataKey="saved" name="Saved" fill={COLORS.violet} radius={[6, 6, 0, 0]} maxBarSize={40} />
                <Bar dataKey="target" name="Target" fill={COLORS.violetSoft} stroke={COLORS.violet} strokeWidth={1} radius={[6, 6, 0, 0]} maxBarSize={40} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      <Card>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-display font-semibold flex items-center gap-1.5" style={{ color: COLORS.ink }}>
            <Flag size={16} /> Flagged for review
          </h3>
          <button onClick={() => goToLedger('All', 'All')} className="font-body text-xs font-semibold" style={{ color: COLORS.violet }}>View in Ledger &rarr;</button>
        </div>
        {flaggedItems.length === 0 ? (
          <EmptyState icon={Flag} title="Nothing flagged" subtitle="Flag a transaction in the Ledger to bring it here for your partner to check." />
        ) : (
          <div className="space-y-2">
            {flaggedItems.map((t) => (
              <div key={t.id} className="flex items-center justify-between gap-3 rounded-xl px-3 py-2" style={{ background: COLORS.bg }}>
                <div className="min-w-0">
                  <p className="font-body font-semibold text-sm truncate" style={{ color: COLORS.ink }}>{t.description}</p>
                  <p className="font-body text-xs truncate" style={{ color: COLORS.inkSoft }}>
                    {t.date}{t.note ? ` · ${t.note}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="font-display font-semibold text-sm" style={{ color: t.type === 'income' ? COLORS.teal : COLORS.coral }}>
                    {t.type === 'income' ? '+' : '-'}{formatCurrency(t.amount)}
                  </span>
                  <button
                    onClick={() => unflagTransaction(t.id)}
                    className="font-body text-xs font-semibold rounded-full px-2 py-1"
                    style={{ background: COLORS.violetSoft, color: COLORS.violet }}
                  >
                    Resolved
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-display font-semibold flex items-center gap-1.5" style={{ color: COLORS.ink }}>
            <PiggyBank size={16} /> Pending allocations
          </h3>
          <button onClick={() => goToLedger('All', 'All')} className="font-body text-xs font-semibold" style={{ color: COLORS.violet }}>View in Ledger &rarr;</button>
        </div>

        {pendingTransferItems.length > 0 && (
          <div className="mb-4">
            <p className="font-body text-xs font-semibold mb-2" style={{ color: COLORS.inkSoft }}>Pending transfers</p>
            <div className="space-y-2">
              {pendingTransferItems.map((t) => {
                const dir = t.savingsDirection || (t.type === 'income' ? 'withdraw' : 'deposit');
                const label = t.savingsAllocations.length === 1
                  ? `${formatCurrency(t.savingsAllocations[0].amount)} ${dir === 'withdraw' ? '←' : '→'} ${bucketName(t.savingsAllocations[0].bucketId)}`
                  : `${formatCurrency(t.savingsAllocations.reduce((s, a) => s + a.amount, 0))} ${dir === 'withdraw' ? '←' : '→'} ${t.savingsAllocations.length} buckets`;
                return (
                  <div key={t.id} className="flex items-center justify-between gap-3 rounded-xl px-3 py-2" style={{ background: COLORS.bg }}>
                    <div className="min-w-0">
                      <p className="font-body font-semibold text-sm truncate" style={{ color: COLORS.ink }}>{t.description}</p>
                      <p className="font-body text-xs truncate" style={{ color: COLORS.gold }}>{t.date} &middot; {label}</p>
                    </div>
                    <span className="font-display font-semibold text-sm flex-shrink-0" style={{ color: t.type === 'income' ? COLORS.teal : COLORS.coral }}>
                      {t.type === 'income' ? '+' : '-'}{formatCurrency(t.amount)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between mb-2">
          <p className="font-body text-xs font-semibold" style={{ color: COLORS.inkSoft }}>Not in the app yet</p>
          <button onClick={() => setShowAddCharge((v) => !v)} className="font-body text-xs font-semibold inline-flex items-center gap-1" style={{ color: COLORS.violet }}>
            <Plus size={12} /> Add a reminder
          </button>
        </div>

        {showAddCharge && (
          <div className="mb-3 grid sm:grid-cols-3 gap-2 items-end rounded-xl p-3" style={{ background: COLORS.bg }}>
            <div>
              <label className="font-body text-xs font-semibold" style={{ color: COLORS.inkSoft }}>Description</label>
              <TextInput placeholder="e.g. Amazon order" value={chargeForm.description} onChange={(e) => setChargeForm({ ...chargeForm, description: e.target.value })} />
            </div>
            <div>
              <label className="font-body text-xs font-semibold" style={{ color: COLORS.inkSoft }}>Amount (optional)</label>
              <TextInput type="number" min="0" step="0.01" placeholder="0.00" value={chargeForm.amount} onChange={(e) => setChargeForm({ ...chargeForm, amount: e.target.value })} />
            </div>
            <div>
              <label className="font-body text-xs font-semibold" style={{ color: COLORS.inkSoft }}>Note</label>
              <TextInput placeholder="e.g. Allocate to MaKayla Fun" value={chargeForm.note} onChange={(e) => setChargeForm({ ...chargeForm, note: e.target.value })} />
            </div>
            <div className="sm:col-span-3">
              <GhostButton onClick={addUpcomingCharge}><Check size={14} /> Save reminder</GhostButton>
            </div>
          </div>
        )}

        {upcomingCharges.length === 0 && pendingTransferItems.length === 0 ? (
          <EmptyState icon={PiggyBank} title="Nothing pending" subtitle="Allocate a transaction to a bucket in the Ledger, or jot down a purchase that hasn't shown up here yet." />
        ) : (
          <div className="space-y-2">
            {upcomingCharges.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-3 rounded-xl px-3 py-2" style={{ background: COLORS.bg }}>
                <div className="min-w-0">
                  <p className="font-body font-semibold text-sm truncate" style={{ color: COLORS.ink }}>{c.description}</p>
                  {c.note && <p className="font-body text-xs truncate" style={{ color: COLORS.inkSoft }}>{c.note}</p>}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {c.amount != null && (
                    <span className="font-display font-semibold text-sm" style={{ color: COLORS.ink }}>{formatCurrency(c.amount)}</span>
                  )}
                  <button
                    onClick={() => removeUpcomingCharge(c.id)}
                    className="font-body text-xs font-semibold rounded-full px-2 py-1"
                    style={{ background: COLORS.violetSoft, color: COLORS.violet }}
                  >
                    Done
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-display font-semibold" style={{ color: COLORS.ink }}>This month's checklist</h3>
          <button onClick={() => setTab('settings')} className="font-body text-xs font-semibold" style={{ color: COLORS.violet }}>Manage &rarr;</button>
        </div>
        {checklistItems.length === 0 ? (
          <EmptyState icon={CalendarClock} title="All caught up" subtitle="No unpaid bills or pending transfers this month." />
        ) : (
          <div className="grid sm:grid-cols-2 gap-2">
            {checklistItems.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={item.onToggle}
                className="flex items-center justify-between rounded-xl px-3 py-2 text-left"
                style={{ background: COLORS.bg }}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <div className="rounded-full p-1.5 flex-shrink-0" style={{ background: COLORS.violetSoft }}>
                    {item.kind === 'bill' ? <Landmark size={13} style={{ color: COLORS.violet }} /> : <Repeat size={13} style={{ color: COLORS.violet }} />}
                  </div>
                  <div className="min-w-0">
                    <p className="font-body font-semibold text-sm truncate" style={{ color: COLORS.ink }}>{item.name}</p>
                    <p className="font-body text-xs" style={{ color: COLORS.inkSoft }}>Due day {item.dueDay}</p>
                  </div>
                </div>
                <span className="font-display font-semibold text-sm flex-shrink-0 ml-2" style={{ color: COLORS.ink }}>{formatCurrency(item.amount)}</span>
              </button>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

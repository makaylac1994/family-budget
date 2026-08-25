import React, { useState, useMemo } from 'react';
import { Calculator, Check, Flame, PiggyBank, Wallet, RotateCcw, X } from 'lucide-react';
import { COLORS } from '../lib/constants';
import {
  formatCurrency, nonBucketAmount, isSavingsAccount, currentMonthStr, shiftMonth,
  monthlyNetSeries, monthlySavingsNeeded, estimateLoanPayment, uid,
} from '../lib/helpers';
import { Card, TextInput } from '../components/ui';

/* ---------------------------------- Planner ---------------------------------- */

export function PlannerView({ transactions, goals, accounts }) {
  const [price, setPrice] = useState('');
  const [downPayment, setDownPayment] = useState('');
  const [ratePct, setRatePct] = useState('');
  const [termYears, setTermYears] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [categoryOverrides, setCategoryOverrides] = useState({});
  const [extraCosts, setExtraCosts] = useState([]);
  const [currentSpend, setCurrentSpend] = useState('');
  const [extraIncome, setExtraIncome] = useState([]);

  const bucketNameSet = useMemo(() => new Set(goals.map((g) => g.name)), [goals]);

  const trendMonths = useMemo(() => {
    const end = currentMonthStr();
    return Array.from({ length: 6 }, (_, i) => shiftMonth(end, i - 5));
  }, []);
  const netSeries = useMemo(
    () => monthlyNetSeries(transactions, bucketNameSet, trendMonths),
    [transactions, bucketNameSet, trendMonths]
  );
  const avgIncome = netSeries.reduce((s, m) => s + m.income, 0) / netSeries.length;
  const avgExpense = netSeries.reduce((s, m) => s + m.expense, 0) / netSeries.length;
  const avgNet = avgIncome - avgExpense;

  const realSavingsTotal = (accounts || [])
    .filter(isSavingsAccount)
    .reduce((s, a) => s + (Number(a.balance) || 0), 0);
  const totalBucketsSaved = goals.reduce((s, g) => s + (g.saved || 0), 0);

  // Trailing-6-month average spend per category, same shape as the
  // Dashboard's pie chart aggregation (DashboardView.jsx) but without its
  // hidden-category-filter state, which doesn't belong on this tab.
  const categoryAverages = useMemo(() => {
    const monthSet = new Set(trendMonths);
    const totals = {};
    transactions.forEach((t) => {
      if (t.type !== 'expense' || t.excludeFromTotals || !monthSet.has(t.date.slice(0, 7))) return;
      if (t.splits && t.splits.length) {
        t.splits.forEach((s) => {
          if (bucketNameSet.has(s.category)) return;
          totals[s.category] = (totals[s.category] || 0) + s.amount;
        });
      } else if (!bucketNameSet.has(t.category)) {
        totals[t.category] = (totals[t.category] || 0) + t.amount;
      }
    });
    return Object.entries(totals)
      .map(([category, total]) => ({ category, avgPerMonth: total / trendMonths.length }))
      .sort((a, b) => b.avgPerMonth - a.avgPerMonth);
  }, [transactions, trendMonths, bucketNameSet]);

  // Editable "what if I spent less here" amounts, scratch state only --
  // defaults to the real average until she types over it.
  function overrideAmount(c) {
    const raw = categoryOverrides[c.category];
    return raw !== undefined ? (parseFloat(raw) || 0) : c.avgPerMonth;
  }
  function updateCategoryOverride(category, value) {
    setCategoryOverrides((prev) => ({ ...prev, [category]: value }));
  }
  function resetCategoryOverride(category) {
    setCategoryOverrides((prev) => {
      const next = { ...prev };
      delete next[category];
      return next;
    });
  }
  function addExtraIncome() {
    setExtraIncome((rows) => [...rows, { id: uid(), label: '', amount: '' }]);
  }
  function updateExtraIncome(id, field, value) {
    setExtraIncome((rows) => rows.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  }
  function removeExtraIncome(id) {
    setExtraIncome((rows) => rows.filter((r) => r.id !== id));
  }
  function resetPlaygroundAdjustments() {
    setCategoryOverrides({});
    setExtraIncome([]);
  }

  const hasAdjustments = Object.keys(categoryOverrides).length > 0 || extraIncome.length > 0;
  const adjustedExpenseTotal = categoryAverages.reduce((s, c) => s + overrideAmount(c), 0);
  const extraIncomeTotal = extraIncome.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
  const adjustedIncome = avgIncome + extraIncomeTotal;
  const adjustedNet = adjustedIncome - adjustedExpenseTotal;
  const effectiveNet = hasAdjustments ? adjustedNet : avgNet;
  const netChange = adjustedNet - avgNet;

  const priceNum = parseFloat(price) || 0;
  const downPaymentNum = parseFloat(downPayment) || 0;
  const downPaymentPctOfPrice = priceNum > 0 && downPaymentNum > 0 ? (downPaymentNum / priceNum) * 100 : null;
  const monthlyForDownPayment = downPaymentNum > 0 && targetDate
    ? monthlySavingsNeeded({ target: downPaymentNum, saved: 0, targetDate })
    : 0;

  const loanPrincipal = Math.max(0, priceNum - downPaymentNum);
  const loanPayment = loanPrincipal > 0 && termYears
    ? estimateLoanPayment(loanPrincipal, parseFloat(ratePct) || 0, parseFloat(termYears) || 0)
    : 0;

  function addExtraCost() {
    setExtraCosts((rows) => [...rows, { id: uid(), label: '', amount: '' }]);
  }
  function updateExtraCost(id, field, value) {
    setExtraCosts((rows) => rows.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  }
  function removeExtraCost(id) {
    setExtraCosts((rows) => rows.filter((r) => r.id !== id));
  }
  const extraCostsTotal = extraCosts.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
  const totalMonthlyCost = loanPayment + extraCostsTotal;
  const currentSpendNum = parseFloat(currentSpend) || 0;
  const netNewCost = totalMonthlyCost - currentSpendNum;

  const afterPurchaseNet = effectiveNet - netNewCost;
  let status = null;
  if (totalMonthlyCost > 0) {
    if (afterPurchaseNet < 0) status = 'negative';
    else if (avgIncome > 0 && afterPurchaseNet < avgIncome * 0.05) status = 'tight';
    else status = 'comfortable';
  }
  const statusColor = { comfortable: COLORS.teal, tight: COLORS.gold, negative: COLORS.coral }[status];
  const statusLabel = {
    comfortable: 'Comfortable — still real room left over.',
    tight: 'Tight — it fits, but barely.',
    negative: "Doesn't fit your current average — see below for where to trim.",
  }[status];

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-display font-bold text-2xl flex items-center gap-2" style={{ color: COLORS.ink }}>
          <Calculator size={22} style={{ color: COLORS.violet }} /> Planner
        </h2>
        <p className="font-body text-sm" style={{ color: COLORS.inkSoft }}>
          Model a big purchase against your real numbers &mdash; nothing here is saved.
        </p>
      </div>

      <Card>
        <h3 className="font-display font-semibold mb-3" style={{ color: COLORS.ink }}>Your baseline</h3>
        <p className="font-body text-xs mb-3" style={{ color: COLORS.inkSoft }}>
          Averaged over the last 6 months of real activity.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div>
            <p className="font-body text-xs" style={{ color: COLORS.inkSoft }}>Avg income</p>
            <p className="font-display font-semibold" style={{ color: COLORS.teal }}>{formatCurrency(avgIncome)}/mo</p>
          </div>
          <div>
            <p className="font-body text-xs" style={{ color: COLORS.inkSoft }}>Avg expenses</p>
            <p className="font-display font-semibold" style={{ color: COLORS.coral }}>{formatCurrency(avgExpense)}/mo</p>
          </div>
          <div>
            <p className="font-body text-xs" style={{ color: COLORS.inkSoft }}>Avg net</p>
            <p className="font-display font-semibold" style={{ color: COLORS.ink }}>{formatCurrency(avgNet)}/mo</p>
          </div>
          <div>
            <p className="font-body text-xs" style={{ color: COLORS.inkSoft }}>Saved (real + buckets)</p>
            <p className="font-display font-semibold" style={{ color: COLORS.ink }}>{formatCurrency(realSavingsTotal || totalBucketsSaved)}</p>
          </div>
        </div>
      </Card>

      <Card>
        <h3 className="font-display font-semibold mb-3" style={{ color: COLORS.ink }}>Big purchase calculator</h3>
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="font-body text-xs font-semibold" style={{ color: COLORS.inkSoft }}>Purchase price</label>
            <TextInput type="number" min="0" placeholder="e.g. 350000" value={price} onChange={(e) => setPrice(e.target.value)} />
          </div>
          <div>
            <label className="font-body text-xs font-semibold" style={{ color: COLORS.inkSoft }}>Down payment ($)</label>
            <TextInput type="number" min="0" placeholder="e.g. 70000" value={downPayment} onChange={(e) => setDownPayment(e.target.value)} />
            {downPaymentPctOfPrice != null && (
              <p className="font-body text-xs mt-1" style={{ color: COLORS.inkSoft }}>&asymp; {downPaymentPctOfPrice.toFixed(1)}% of price</p>
            )}
          </div>
          <div>
            <label className="font-body text-xs font-semibold" style={{ color: COLORS.inkSoft }}>Interest rate (%)</label>
            <TextInput type="number" min="0" step="0.01" placeholder="e.g. 6.5" value={ratePct} onChange={(e) => setRatePct(e.target.value)} />
          </div>
          <div>
            <label className="font-body text-xs font-semibold" style={{ color: COLORS.inkSoft }}>Loan term (years)</label>
            <TextInput type="number" min="0" placeholder="30 for a house, 5-6 for a car" value={termYears} onChange={(e) => setTermYears(e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <label className="font-body text-xs font-semibold" style={{ color: COLORS.inkSoft }}>Have the down payment ready by</label>
            <TextInput type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
          </div>
        </div>

        <div className="mt-4">
          <label className="font-body text-xs font-semibold" style={{ color: COLORS.inkSoft }}>
            Extra monthly costs (optional)
          </label>
          <p className="font-body text-xs mb-2" style={{ color: COLORS.inkSoft }}>
            Property tax, homeowners insurance, PMI, HOA dues, registration &mdash; anything on top of the loan payment.
          </p>
          {extraCosts.length > 0 && (
            <div className="space-y-2 mb-2">
              {extraCosts.map((row) => (
                <div key={row.id} className="flex items-center gap-2">
                  <TextInput
                    placeholder="e.g. Property tax"
                    value={row.label}
                    onChange={(e) => updateExtraCost(row.id, 'label', e.target.value)}
                    style={{ flex: 1 }}
                  />
                  <TextInput
                    type="number" min="0" step="0.01" placeholder="0.00"
                    value={row.amount}
                    onChange={(e) => updateExtraCost(row.id, 'amount', e.target.value)}
                    style={{ width: 100 }}
                  />
                  <button onClick={() => removeExtraCost(row.id)} style={{ color: COLORS.inkSoft }} className="hover:text-red-500">
                    <X size={15} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <button onClick={addExtraCost} className="font-body text-xs font-semibold" style={{ color: COLORS.violet }}>
            + Add another cost
          </button>
        </div>

        <div className="mt-4">
          <label className="font-body text-xs font-semibold" style={{ color: COLORS.inkSoft }}>
            Currently spending on this ($, optional)
          </label>
          <p className="font-body text-xs mb-2" style={{ color: COLORS.inkSoft }}>
            What you already pay for what this replaces &mdash; rent, an existing car payment. Leave blank if this is new spending, not a replacement.
          </p>
          <TextInput
            type="number" min="0" placeholder="e.g. 1200"
            value={currentSpend} onChange={(e) => setCurrentSpend(e.target.value)}
            style={{ maxWidth: 160 }}
          />
        </div>

        {(monthlyForDownPayment > 0 || totalMonthlyCost > 0) && (
          <div className="mt-5 space-y-3">
            {monthlyForDownPayment > 0 && (
              <div className="rounded-xl px-4 py-3" style={{ background: COLORS.violetSoft }}>
                <div className="flex items-center gap-2 mb-0.5">
                  <PiggyBank size={15} style={{ color: COLORS.violet }} />
                  <span className="font-body text-xs font-semibold uppercase tracking-wide" style={{ color: COLORS.violet }}>While you save</span>
                </div>
                <p className="font-display font-bold text-lg" style={{ color: COLORS.ink }}>{formatCurrency(monthlyForDownPayment)}/mo</p>
                <p className="font-body text-xs" style={{ color: COLORS.inkSoft }}>
                  to have {formatCurrency(downPaymentNum)} saved by {targetDate}.
                </p>
              </div>
            )}
            {totalMonthlyCost > 0 && (
              <div className="rounded-xl px-4 py-3" style={{ background: `${statusColor}18` }}>
                <div className="flex items-center gap-2 mb-0.5">
                  <Wallet size={15} style={{ color: statusColor }} />
                  <span className="font-body text-xs font-semibold uppercase tracking-wide" style={{ color: statusColor }}>After you buy</span>
                </div>
                <p className="font-display font-bold text-lg" style={{ color: COLORS.ink }}>{formatCurrency(totalMonthlyCost)}/mo total</p>
                {extraCostsTotal > 0 && (
                  <p className="font-body text-xs" style={{ color: COLORS.inkSoft }}>
                    {formatCurrency(loanPayment)}/mo loan payment + {formatCurrency(extraCostsTotal)}/mo extra costs
                  </p>
                )}
                {currentSpendNum > 0 && (
                  <p className="font-body text-xs" style={{ color: COLORS.inkSoft }}>
                    &minus; {formatCurrency(currentSpendNum)}/mo already spent on this = <strong style={{ color: COLORS.ink }}>{formatCurrency(netNewCost)}/mo net new cost</strong>
                  </p>
                )}
                <p className="font-body text-xs flex items-center gap-1 mt-1" style={{ color: COLORS.inkSoft }}>
                  Leaves {formatCurrency(afterPurchaseNet)}/mo of your {hasAdjustments ? 'adjusted' : 'average'} {formatCurrency(effectiveNet)}/mo net.
                  {hasAdjustments && ` (real average: ${formatCurrency(avgNet)}/mo)`}
                </p>
                <p className="font-body text-xs font-semibold mt-1 flex items-center gap-1" style={{ color: statusColor }}>
                  {status === 'comfortable' ? <Check size={13} /> : <Flame size={13} />} {statusLabel}
                </p>
                {status !== 'comfortable' && !hasAdjustments && (
                  <p className="font-body text-xs mt-1" style={{ color: COLORS.inkSoft }}>
                    Try trimming spending or adding income below to see if it fits.
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </Card>

      <Card>
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-display font-semibold" style={{ color: COLORS.ink }}>Where the room is</h3>
          {hasAdjustments && (
            <button
              onClick={resetPlaygroundAdjustments}
              className="font-body text-xs font-semibold flex items-center gap-1"
              style={{ color: COLORS.violet }}
            >
              <RotateCcw size={12} /> Reset all
            </button>
          )}
        </div>
        <p className="font-body text-xs mb-3" style={{ color: COLORS.inkSoft }}>
          Add income or trim spending &mdash; last 6 months of real activity &mdash; to see the effect above.
        </p>

        {hasAdjustments && (
          <div className="rounded-xl px-3 py-2 mb-4" style={{ background: `${netChange >= 0 ? COLORS.teal : COLORS.coral}18` }}>
            <p className="font-body text-xs font-semibold" style={{ color: netChange >= 0 ? COLORS.teal : COLORS.coral }}>
              {netChange >= 0 ? `${formatCurrency(netChange)}/mo more room` : `${formatCurrency(-netChange)}/mo less room`}
            </p>
            <p className="font-body text-xs" style={{ color: COLORS.inkSoft }}>
              Adjusted net {formatCurrency(adjustedNet)}/mo vs. real {formatCurrency(avgNet)}/mo.
            </p>
          </div>
        )}

        <h4 className="font-body text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: COLORS.inkSoft }}>Income</h4>
        <div className="space-y-1.5 mb-2">
          <div className="flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5" style={{ background: COLORS.bg }}>
            <span className="font-body text-sm" style={{ color: COLORS.ink }}>Average income</span>
            <span className="font-body text-sm font-semibold" style={{ color: COLORS.teal }}>{formatCurrency(avgIncome)}/mo</span>
          </div>
          {extraIncome.map((row) => (
            <div key={row.id} className="flex items-center gap-2">
              <TextInput
                placeholder="e.g. New job"
                value={row.label}
                onChange={(e) => updateExtraIncome(row.id, 'label', e.target.value)}
                style={{ flex: 1 }}
              />
              <TextInput
                type="number" min="0" step="0.01" placeholder="0.00"
                value={row.amount}
                onChange={(e) => updateExtraIncome(row.id, 'amount', e.target.value)}
                style={{ width: 100 }}
              />
              <button onClick={() => removeExtraIncome(row.id)} style={{ color: COLORS.inkSoft }} className="hover:text-red-500">
                <X size={15} />
              </button>
            </div>
          ))}
        </div>
        <button onClick={addExtraIncome} className="font-body text-xs font-semibold mb-4" style={{ color: COLORS.violet }}>
          + Add income source
        </button>

        {categoryAverages.length > 0 && (
          <>
            <h4 className="font-body text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: COLORS.inkSoft }}>Expenses</h4>
            <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
              {categoryAverages.map((c) => {
                const isOverridden = categoryOverrides[c.category] !== undefined;
                const delta = overrideAmount(c) - c.avgPerMonth;
                return (
                  <div key={c.category} className="flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5" style={{ background: COLORS.bg }}>
                    <div className="min-w-0">
                      <span className="font-body text-sm" style={{ color: COLORS.ink }}>{c.category}</span>
                      {isOverridden && Math.abs(delta) > 0.005 && (
                        <span className="font-body text-xs ml-1.5" style={{ color: delta < 0 ? COLORS.teal : COLORS.coral }}>
                          ({delta < 0 ? '-' : '+'}{formatCurrency(Math.abs(delta))})
                        </span>
                      )}
                      <p className="font-body text-xs" style={{ color: COLORS.inkSoft }}>real {formatCurrency(c.avgPerMonth)}/mo</p>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <TextInput
                        type="number" min="0" step="0.01"
                        value={categoryOverrides[c.category] ?? String(Math.round(c.avgPerMonth * 100) / 100)}
                        onChange={(e) => updateCategoryOverride(c.category, e.target.value)}
                        style={{ width: 90, textAlign: 'right' }}
                      />
                      {isOverridden && (
                        <button onClick={() => resetCategoryOverride(c.category)} title="Reset to real average" style={{ color: COLORS.inkSoft }} className="hover:text-violet-600">
                          <RotateCcw size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

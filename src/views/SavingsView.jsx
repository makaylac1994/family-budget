import React, { useState, useMemo } from 'react';
import { Plus, Flame, Check, Target, ChevronDown, ChevronRight } from 'lucide-react';
import { COLORS } from '../lib/constants';
import { isSavingsAccount, monthlySavingsNeeded, formatCurrency } from '../lib/helpers';
import { Card, PrimaryButton, TextInput, EmptyState } from '../components/ui';
import { BucketCard, useBucketActions } from './SavingsAnnualShared';
import { TransferPlanSection } from './TransferPlanSection';

export function SavingsView({ goals, updateGoals, transactions, accounts, annualAccountId, goToLedgerBucket, transferPlans, updateTransferPlans, completeTransferPlan, undoTransferPlan }) {
  const [collapsedAccounts, setCollapsedAccounts] = useState(() => new Set());
  const {
    showAdd, setShowAdd, name, setName, target, setTarget,
    deposits, setDeposit,
    addBucket, addFunds, updateTarget, updateTargetDate, updateSavedAmount,
    updateBucketName, removeBucket, updateGoalAccount,
  } = useBucketActions(goals, updateGoals);

  function toggleAccountCollapsed(accountId) {
    setCollapsedAccounts((prev) => {
      const next = new Set(prev);
      if (next.has(accountId)) next.delete(accountId); else next.add(accountId);
      return next;
    });
  }

  const savingsAccounts = useMemo(
    () => (accounts || []).filter((a) => isSavingsAccount(a) && a.id !== annualAccountId),
    [accounts, annualAccountId]
  );
  const savingsAccountIds = useMemo(() => new Set(savingsAccounts.map((a) => a.id)), [savingsAccounts]);
  // Buckets linked to the Annual account live entirely in the Annual tab instead.
  const visibleGoals = useMemo(
    () => goals.filter((g) => !annualAccountId || g.accountId !== annualAccountId),
    [goals, annualAccountId]
  );

  const perAccountReconcile = useMemo(() => savingsAccounts.map((a) => {
    const linkedGoals = visibleGoals.filter((g) => g.accountId === a.id);
    const allocated = linkedGoals.reduce((s, g) => s + (g.saved || 0), 0);
    const diff = Math.round(((Number(a.balance) || 0) - allocated) * 100) / 100;
    const monthlyNeeded = linkedGoals.reduce((s, g) => s + monthlySavingsNeeded(g), 0);
    return { account: a, allocated, diff, linkedGoals, monthlyNeeded };
  }), [savingsAccounts, visibleGoals]);

  const unlinkedGoals = useMemo(
    () => visibleGoals.filter((g) => !g.accountId || !savingsAccountIds.has(g.accountId)),
    [visibleGoals, savingsAccountIds]
  );
  const unlinkedTotal = unlinkedGoals.reduce((s, g) => s + (g.saved || 0), 0);

  const pendingByBucket = useMemo(() => {
    const map = {};
    transactions.forEach((t) => {
      if (!t.savingsAllocations || !t.savingsAllocations.length || t.savingsTransferConfirmed !== false) return;
      const dir = t.savingsDirection || (t.type === 'income' ? 'withdraw' : 'deposit');
      const sign = dir === 'withdraw' ? -1 : 1;
      t.savingsAllocations.forEach((a) => {
        map[a.bucketId] = (map[a.bucketId] || 0) + sign * a.amount;
      });
    });
    return map;
  }, [transactions]);

  const hasPending = visibleGoals.some((g) => pendingByBucket[g.id]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-display font-bold text-2xl" style={{ color: COLORS.ink }}>Savings</h2>
          <p className="font-body text-sm" style={{ color: COLORS.inkSoft }}>Name your buckets, then allocate money into them &mdash; from here or right from the ledger.</p>
        </div>
        <PrimaryButton onClick={() => setShowAdd((v) => !v)}><Plus size={15} /> New bucket</PrimaryButton>
      </div>

      <TransferPlanSection
        transferPlans={transferPlans}
        updateTransferPlans={updateTransferPlans}
        goals={goals}
        transactions={transactions}
        completeTransferPlan={completeTransferPlan}
        undoTransferPlan={undoTransferPlan}
      />

      {hasPending && (
        <Card style={{ borderColor: COLORS.gold, background: '#FFFBF0' }}>
          <div className="flex items-center gap-2 mb-2">
            <Flame size={15} style={{ color: COLORS.gold }} />
            <h3 className="font-display font-semibold" style={{ color: COLORS.ink }}>Pending transfers</h3>
          </div>
          <p className="font-body text-xs mb-3" style={{ color: COLORS.inkSoft }}>
            Tagged in the ledger but not yet confirmed with the "Transferred" checkbox.
          </p>
          <div className="grid sm:grid-cols-2 gap-2">
            {visibleGoals.filter((g) => pendingByBucket[g.id]).map((g) => {
              const amt = pendingByBucket[g.id];
              return (
                <div key={g.id} className="flex items-center justify-between rounded-xl px-3 py-2" style={{ background: '#fff' }}>
                  <span className="font-body font-semibold text-sm" style={{ color: COLORS.ink }}>{g.name}</span>
                  <span className="font-display font-semibold text-sm" style={{ color: amt >= 0 ? COLORS.gold : COLORS.coral }}>
                    {amt >= 0 ? '+' : '-'}{formatCurrency(Math.abs(amt))}
                  </span>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {showAdd && (
        <Card>
          <div className="flex flex-wrap gap-2 items-end">
            <div className="flex-1 min-w-[160px]">
              <label className="font-body text-xs font-semibold" style={{ color: COLORS.inkSoft }}>Bucket name</label>
              <TextInput placeholder="e.g. Emergency Fund" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <label className="font-body text-xs font-semibold" style={{ color: COLORS.inkSoft }}>Target (optional)</label>
              <TextInput type="number" min="0" placeholder="No target" value={target} onChange={(e) => setTarget(e.target.value)} style={{ width: 140 }} />
            </div>
            <PrimaryButton onClick={addBucket}><Check size={15} /> Create</PrimaryButton>
          </div>
        </Card>
      )}

      {visibleGoals.length === 0 ? (
        <Card><EmptyState icon={Target} title="No savings buckets yet" subtitle="Create one for anything you're setting money aside for &mdash; an emergency fund, a trip, a house." /></Card>
      ) : (
        <div className="space-y-5">
          {perAccountReconcile.map(({ account, allocated, diff, linkedGoals, monthlyNeeded }) => {
            const expanded = !collapsedAccounts.has(account.id);
            return (
              <div key={account.id}>
                <button
                  type="button"
                  onClick={() => toggleAccountCollapsed(account.id)}
                  className="w-full flex items-center justify-between px-5 py-4"
                  style={{
                    background: COLORS.surface, border: `1px solid ${COLORS.border}`,
                    borderRadius: expanded ? '16px 16px 0 0' : 16,
                  }}
                >
                  <div className="text-left">
                    <p className="font-display font-semibold" style={{ color: COLORS.ink }}>
                      {account.name}{account.mask ? ` ••${account.mask}` : ''}
                    </p>
                    <p className="font-body text-xs mt-0.5" style={{ color: COLORS.inkSoft }}>
                      Real balance {formatCurrency(account.balance)} &middot; linked {formatCurrency(allocated)}
                      {monthlyNeeded > 0 && <> &middot; <span style={{ color: COLORS.violet, fontWeight: 600 }}>{formatCurrency(monthlyNeeded)}/mo to hit targets</span></>}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {diff === 0 ? (
                      <span className="inline-flex items-center gap-1 font-body text-xs font-semibold rounded-full px-2.5 py-1" style={{ background: `${COLORS.teal}22`, color: COLORS.teal }}>
                        <Check size={11} /> Matches
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 font-body text-xs font-semibold rounded-full px-2.5 py-1" style={{ background: '#FFFBF0', color: COLORS.gold }}>
                        <Flame size={11} /> {formatCurrency(Math.abs(diff))} {diff > 0 ? 'unassigned' : 'over-allocated'}
                      </span>
                    )}
                    {expanded ? <ChevronDown size={16} style={{ color: COLORS.inkSoft }} /> : <ChevronRight size={16} style={{ color: COLORS.inkSoft }} />}
                  </div>
                </button>
                {expanded && (
                  <div
                    className="p-4"
                    style={{ background: COLORS.bg, border: `1px solid ${COLORS.border}`, borderTop: 'none', borderRadius: '0 0 16px 16px' }}
                  >
                    {linkedGoals.length === 0 ? (
                      <p className="font-body text-xs px-1" style={{ color: COLORS.inkSoft }}>No buckets linked to this account yet.</p>
                    ) : (
                      <div className="grid sm:grid-cols-2 gap-4">
                        {linkedGoals.map((g) => (
                          <BucketCard
                            key={g.id}
                            g={g}
                            savingsAccounts={savingsAccounts}
                            perAccountReconcile={perAccountReconcile}
                            deposit={deposits[g.id]}
                            onDepositChange={(v) => setDeposit(g.id, v)}
                            onAddFunds={() => addFunds(g.id)}
                            updateGoalAccount={updateGoalAccount}
                            updateTarget={updateTarget}
                            updateTargetDate={updateTargetDate}
                            updateSavedAmount={updateSavedAmount}
                            updateBucketName={updateBucketName}
                            removeBucket={removeBucket}
                            onViewTransfers={() => goToLedgerBucket(g.id)}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {unlinkedGoals.length > 0 && (
            <div>
              <p className="font-body text-xs font-semibold mb-2 px-1" style={{ color: COLORS.inkSoft }}>Not linked to an account</p>
              <div className="grid sm:grid-cols-2 gap-4">
                {unlinkedGoals.map((g) => (
                  <BucketCard
                    key={g.id}
                    g={g}
                    savingsAccounts={savingsAccounts}
                    perAccountReconcile={perAccountReconcile}
                    deposit={deposits[g.id]}
                    onDepositChange={(v) => setDeposit(g.id, v)}
                    onAddFunds={() => addFunds(g.id)}
                    updateGoalAccount={updateGoalAccount}
                    updateTarget={updateTarget}
                            updateTargetDate={updateTargetDate}
                    updateSavedAmount={updateSavedAmount}
                    updateBucketName={updateBucketName}
                    removeBucket={removeBucket}
                    onViewTransfers={() => goToLedgerBucket(g.id)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

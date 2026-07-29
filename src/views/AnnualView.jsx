import React, { useMemo } from 'react';
import { CalendarClock, Plus, Check, Flame, Target } from 'lucide-react';
import { COLORS } from '../lib/constants';
import { monthlySavingsNeeded, formatCurrency } from '../lib/helpers';
import { Card, PrimaryButton, TextInput, EmptyState, GhostButton, JarBar } from '../components/ui';
import { BucketCard, useBucketActions } from './SavingsAnnualShared';

/* ---------------------------------- Annual ---------------------------------- */

export function AnnualView({ accounts, goals, updateGoals, setTab, goToLedgerBucket, annualAccountId, transactions }) {
  const {
    showAdd, setShowAdd, name, setName, target, setTarget,
    deposits, setDeposit,
    addBucket, addFunds, updateTarget, updateTargetDate, updateSavedAmount,
    updateBucketName, removeBucket, updateGoalAccount,
  } = useBucketActions(goals, updateGoals, { defaultAccountId: annualAccountId });

  const account = (accounts || []).find((a) => a.id === annualAccountId);
  const bucketGoals = useMemo(() => goals.filter((g) => g.accountId === annualAccountId), [goals, annualAccountId]);
  const allocated = bucketGoals.reduce((s, g) => s + (g.saved || 0), 0);
  const diff = account ? Math.round(((Number(account.balance) || 0) - allocated) * 100) / 100 : 0;
  const monthlyNeededTotal = bucketGoals.reduce((s, g) => s + monthlySavingsNeeded(g), 0);
  const perAccountReconcile = account ? [{ account, allocated, diff, linkedGoals: bucketGoals }] : [];
  const savingsAccountsList = account ? [account] : [];

  // Only buckets with a target set have a defined yearly commitment to
  // measure "spent" and "saved" against.
  const targetedGoals = bucketGoals.filter((g) => g.target > 0);
  const totalTarget = targetedGoals.reduce((s, g) => s + g.target, 0);
  const totalSaved = targetedGoals.reduce((s, g) => s + (g.saved || 0), 0);

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - 365);
  const cutoff = `${cutoffDate.getFullYear()}-${String(cutoffDate.getMonth() + 1).padStart(2, '0')}-${String(cutoffDate.getDate()).padStart(2, '0')}`;
  const targetedBucketIds = new Set(targetedGoals.map((g) => g.id));
  // Confirmed withdrawals only (savingsTransferConfirmed !== false), same rule
  // LedgerView's isAllocationApplied/allocationDirection use elsewhere — just
  // scoped to the trailing 365 days instead of "ever".
  const spentTrailingYear = (transactions || []).reduce((sum, t) => {
    if (!t.savingsAllocations?.length || t.savingsTransferConfirmed === false || t.date < cutoff) return sum;
    const dir = t.savingsDirection || (t.type === 'income' ? 'withdraw' : 'deposit');
    if (dir !== 'withdraw') return sum;
    return sum + t.savingsAllocations.filter((a) => targetedBucketIds.has(a.bucketId)).reduce((s, a) => s + a.amount, 0);
  }, 0);

  const spentPct = totalTarget > 0 ? (spentTrailingYear / totalTarget) * 100 : 0;
  const savedPct = totalTarget > 0 ? (totalSaved / totalTarget) * 100 : 0;

  if (!annualAccountId) {
    return (
      <div className="space-y-5">
        <div>
          <h2 className="font-display font-bold text-2xl" style={{ color: COLORS.ink }}>Annual</h2>
          <p className="font-body text-sm" style={{ color: COLORS.inkSoft }}>Track an account where money actively flows in and out, separate from long-term savings.</p>
        </div>
        <Card>
          <EmptyState
            icon={CalendarClock}
            title="No account chosen yet"
            subtitle="Head to Settings and pick which connected account this should track."
          />
          <div className="flex justify-center mt-2">
            <GhostButton onClick={() => setTab('settings')}>Go to Settings</GhostButton>
          </div>
        </Card>
      </div>
    );
  }

  if (!account) {
    return (
      <div className="space-y-5">
        <div>
          <h2 className="font-display font-bold text-2xl" style={{ color: COLORS.ink }}>Annual</h2>
        </div>
        <Card>
          <EmptyState
            icon={CalendarClock}
            title="Account not found"
            subtitle="The account chosen in Settings isn't connected anymore &mdash; pick a different one."
          />
          <div className="flex justify-center mt-2">
            <GhostButton onClick={() => setTab('settings')}>Go to Settings</GhostButton>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-display font-bold text-2xl" style={{ color: COLORS.ink }}>Annual</h2>
          <p className="font-body text-sm" style={{ color: COLORS.inkSoft }}>
            {account.name}{account.mask ? ` ••${account.mask}` : ''} &mdash; money flows in and out here, tracked separately from long-term savings.
          </p>
        </div>
        <PrimaryButton onClick={() => setShowAdd((v) => !v)}><Plus size={15} /> New bucket</PrimaryButton>
      </div>

      {/* Level 1: account + a lighter-weight reality check than the full Savings tab version. */}
      <div className="flex items-center justify-between rounded-2xl px-5 py-3" style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}` }}>
        <div className="flex items-center gap-4">
          <div>
            <p className="font-body text-xs" style={{ color: COLORS.inkSoft }}>Real balance</p>
            <p className="font-display font-semibold" style={{ color: COLORS.ink }}>{formatCurrency(account.balance)}</p>
          </div>
          <div>
            <p className="font-body text-xs" style={{ color: COLORS.inkSoft }}>Allocated to buckets</p>
            <p className="font-display font-semibold" style={{ color: COLORS.ink }}>{formatCurrency(allocated)}</p>
          </div>
          {monthlyNeededTotal > 0 && (
            <div>
              <p className="font-body text-xs" style={{ color: COLORS.inkSoft }}>To hit targets</p>
              <p className="font-display font-semibold" style={{ color: COLORS.violet }}>{formatCurrency(monthlyNeededTotal)}/mo</p>
            </div>
          )}
        </div>
        {diff === 0 ? (
          <span className="inline-flex items-center gap-1 font-body text-xs font-semibold rounded-full px-2.5 py-1" style={{ background: `${COLORS.teal}22`, color: COLORS.teal }}>
            <Check size={11} /> Matches
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 font-body text-xs font-semibold rounded-full px-2.5 py-1" style={{ background: '#FFFBF0', color: COLORS.gold }}>
            <Flame size={11} /> {formatCurrency(Math.abs(diff))} {diff > 0 ? 'unassigned' : 'over-allocated'}
          </span>
        )}
      </div>

      {totalTarget > 0 && (
        <Card>
          <p className="font-body text-xs mb-3" style={{ color: COLORS.inkSoft }}>
            Against this year's total budget of {formatCurrency(totalTarget)} across your targeted buckets.
          </p>
          <div className="space-y-4">
            <div>
              <div className="flex justify-between text-sm font-body mb-1">
                <span style={{ color: COLORS.ink }}>Spent (trailing 12 months)</span>
                <span style={{ color: COLORS.inkSoft }}>{formatCurrency(spentTrailingYear)} of {formatCurrency(totalTarget)}</span>
              </div>
              <JarBar pct={spentPct} />
            </div>
            <div>
              <div className="flex justify-between text-sm font-body mb-1">
                <span style={{ color: COLORS.ink }}>Currently saved</span>
                <span style={{ color: COLORS.inkSoft }}>{formatCurrency(totalSaved)} of {formatCurrency(totalTarget)}</span>
              </div>
              <JarBar pct={savedPct} />
            </div>
          </div>
        </Card>
      )}

      {showAdd && (
        <Card>
          <div className="flex flex-wrap gap-2 items-end">
            <div className="flex-1 min-w-[160px]">
              <label className="font-body text-xs font-semibold" style={{ color: COLORS.inkSoft }}>Bucket name</label>
              <TextInput placeholder="e.g. Amazon" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <label className="font-body text-xs font-semibold" style={{ color: COLORS.inkSoft }}>Target (optional)</label>
              <TextInput type="number" min="0" placeholder="No target" value={target} onChange={(e) => setTarget(e.target.value)} style={{ width: 140 }} />
            </div>
            <PrimaryButton onClick={addBucket}><Check size={15} /> Create</PrimaryButton>
          </div>
        </Card>
      )}

      {/* Level 2: buckets for this account. */}
      {bucketGoals.length === 0 ? (
        <Card><EmptyState icon={Target} title="No buckets yet" subtitle="Create one above for each thing this account covers &mdash; Amazon, insurance, Costco, whatever you're tracking." /></Card>
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          {bucketGoals.map((g) => (
            <BucketCard
              key={g.id}
              g={g}
              savingsAccounts={savingsAccountsList}
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
              onGoToGifts={g.name.trim().toLowerCase() === 'gifts' ? () => setTab('gifts') : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}

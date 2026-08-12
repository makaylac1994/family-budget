import React, { useState, useMemo } from 'react';
import { PiggyBank, Sparkles, Trash2, Check, Flame, Plus, Gift, ChevronDown, ChevronRight } from 'lucide-react';
import { COLORS } from '../lib/constants';
import { formatCurrency, monthlySavingsNeeded, uid, todayStr, bucketActivity } from '../lib/helpers';
import { AccountNicknameContext, applyAccountNicknames } from '../lib/accountNicknames';
import { Card, JarBar, TextInput, GhostButton } from '../components/ui';

/* ---------------------------------- Goals ---------------------------------- */

export function BucketCard({ g, savingsAccounts, perAccountReconcile, deposit, onDepositChange, onAddFunds, updateGoalAccount, updateTarget, updateTargetDate, updateSavedAmount, updateBucketName, removeBucket, onViewTransfers, onGoToGifts, transactions }) {
  const accountNicknames = React.useContext(AccountNicknameContext);
  const hasTarget = g.target != null && g.target > 0;
  const pct = hasTarget ? (g.saved / g.target) * 100 : 0;
  const done = hasTarget && pct >= 100;
  const monthlyNeeded = monthlySavingsNeeded(g);
  const [showActivity, setShowActivity] = useState(false);
  const activity = useMemo(() => bucketActivity(g, transactions), [g, transactions]);

  return (
    <Card>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="rounded-full p-1.5 flex-shrink-0" style={{ background: COLORS.violetSoft }}>
            {done ? <Sparkles size={15} style={{ color: COLORS.violet }} /> : <PiggyBank size={15} style={{ color: COLORS.violet }} />}
          </div>
          <input
            key={`name-${g.id}`}
            defaultValue={g.name}
            onBlur={(e) => {
              e.target.style.borderColor = 'transparent';
              e.target.style.background = 'transparent';
              updateBucketName(g.id, e.target.value);
            }}
            onFocus={(e) => { e.target.style.borderColor = COLORS.violet; e.target.style.background = '#fff'; }}
            onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
            className="font-display font-semibold rounded-lg px-1.5 py-0.5 outline-none min-w-0 flex-1"
            style={{ color: COLORS.ink, border: `1.5px solid transparent`, background: 'transparent' }}
          />
        </div>
        <button onClick={() => removeBucket(g.id)} style={{ color: COLORS.inkSoft }} className="hover:text-red-500 flex-shrink-0"><Trash2 size={14} /></button>
      </div>

      {savingsAccounts.length > 0 && (
        <div className="mb-3 flex items-center gap-1.5">
          <select
            value={g.accountId || ''}
            onChange={(e) => updateGoalAccount(g.id, e.target.value)}
            className="rounded-full pl-2.5 pr-6 py-0.5 text-xs font-semibold font-body outline-none cursor-pointer appearance-none"
            style={g.accountId
              ? { background: `${COLORS.teal}22`, color: COLORS.teal, border: 'none' }
              : { background: COLORS.bg, color: COLORS.inkSoft, border: `1px solid ${COLORS.border}` }}
          >
            <option value="">Not linked to an account</option>
            {savingsAccounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}{a.mask ? ` ••${a.mask}` : ''}</option>
            ))}
          </select>
          {g.accountId && (() => {
            const match = perAccountReconcile.find((r) => r.account.id === g.accountId);
            if (!match) return null;
            const inSync = match.diff === 0;
            return (
              <span title={inSync ? `${match.account.name} matches its linked buckets` : `${match.account.name} is ${formatCurrency(Math.abs(match.diff))} ${match.diff > 0 ? 'unassigned' : 'over-allocated'}`}>
                {inSync
                  ? <Check size={13} style={{ color: COLORS.teal }} />
                  : <Flame size={13} style={{ color: COLORS.gold }} />}
              </span>
            );
          })()}
        </div>
      )}

      {/* Total: the headline number for this bucket. */}
      <div className="flex items-center gap-1">
        <span className="font-display font-bold text-2xl" style={{ color: COLORS.ink }}>$</span>
        <input
          key={`saved-${g.id}-${g.saved}`}
          type="number" min="0" step="0.01"
          defaultValue={g.saved}
          onBlur={(e) => {
            e.target.style.borderColor = 'transparent';
            e.target.style.background = 'transparent';
            updateSavedAmount(g.id, e.target.value);
          }}
          onFocus={(e) => { e.target.style.borderColor = COLORS.violet; e.target.style.background = '#fff'; }}
          onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
          className="font-display font-bold text-2xl rounded-lg px-1.5 py-0.5 outline-none"
          style={{ color: COLORS.ink, border: `1.5px solid transparent`, background: 'transparent', width: 140 }}
        />
      </div>

      {/* Target: secondary context, sits below the total. */}
      {hasTarget ? (
        <div className="mt-1">
          <p className="font-body text-xs" style={{ color: COLORS.inkSoft }}>
            of {formatCurrency(g.target)} target &middot; <span className="font-semibold" style={{ color: done ? COLORS.teal : COLORS.violet }}>{Math.min(pct, 100).toFixed(0)}%</span>
          </p>
          <div className="mt-1.5">
            <JarBar pct={pct} height={10} />
          </div>
          {!done && (
            <div className="flex items-center gap-2 mt-2">
              <TextInput
                type="date"
                value={g.targetDate || ''}
                onChange={(e) => updateTargetDate(g.id, e.target.value)}
                style={{ fontSize: 11, padding: '4px 8px', flex: 1 }}
              />
              {g.targetDate && (
                <span
                  className="font-body text-xs font-semibold whitespace-nowrap"
                  style={{ color: monthlyNeeded > 0 ? COLORS.violet : COLORS.teal }}
                >
                  {formatCurrency(monthlyNeeded)}/mo
                </span>
              )}
            </div>
          )}
          {!g.targetDate && !done && (
            <p className="font-body text-xs mt-1" style={{ color: COLORS.inkSoft }}>Set a target date to see how much to save monthly.</p>
          )}
        </div>
      ) : (
        <p className="font-body text-xs mt-1" style={{ color: COLORS.inkSoft }}>No target set</p>
      )}

      <div className="flex gap-2 mt-3">
        <TextInput
          type="number" min="0" placeholder="Add funds"
          value={deposit || ''}
          onChange={(e) => onDepositChange(e.target.value)}
        />
        <GhostButton onClick={onAddFunds}><Plus size={14} /> Add</GhostButton>
      </div>
      {onGoToGifts ? (
        <p className="font-body text-xs mt-2" style={{ color: COLORS.inkSoft }}>Target follows your total budgeted in the Gifts tab.</p>
      ) : (
        <div className="mt-2">
          <TextInput
            type="number" min="0" placeholder="Set a target (optional)"
            defaultValue={g.target || ''}
            onBlur={(e) => updateTarget(g.id, e.target.value)}
            style={{ fontSize: 12 }}
          />
        </div>
      )}
      <button
        onClick={() => setShowActivity((v) => !v)}
        className="w-full font-body text-xs font-semibold mt-3 flex items-center justify-center gap-1"
        style={{ color: COLORS.violet }}
      >
        {showActivity ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        Activity ({activity.length})
      </button>
      {showActivity && (
        <div className="mt-2 space-y-1.5 max-h-64 overflow-y-auto pr-1">
          {activity.length === 0 ? (
            <p className="font-body text-xs text-center py-3" style={{ color: COLORS.inkSoft }}>No activity recorded yet.</p>
          ) : activity.map((e) => (
            <div key={e.id} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5" style={{ background: COLORS.bg }}>
              <div className="min-w-0">
                <p className="font-body text-xs truncate" style={{ color: COLORS.ink }}>{applyAccountNicknames(e.description, accountNicknames)}</p>
                <p className="font-body text-xs" style={{ color: COLORS.inkSoft }}>
                  {e.date}{!e.confirmed && ' · Pending'}
                </p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="font-body text-xs font-semibold" style={{ color: e.amount >= 0 ? COLORS.teal : COLORS.coral }}>
                  {e.amount >= 0 ? '+' : '-'}{formatCurrency(Math.abs(e.amount))}
                </p>
                {e.balanceAfter != null && (
                  <p className="font-body" style={{ color: COLORS.inkSoft, fontSize: 10 }}>{formatCurrency(e.balanceAfter)}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {onViewTransfers && (
        <button
          onClick={onViewTransfers}
          className="w-full font-body text-xs font-semibold mt-2 text-center"
          style={{ color: COLORS.violet }}
        >
          View transfers &rarr;
        </button>
      )}
      {onGoToGifts && (
        <button
          onClick={onGoToGifts}
          className="w-full font-body text-xs font-semibold mt-2 text-center inline-flex items-center justify-center gap-1"
          style={{ color: COLORS.violet }}
        >
          <Gift size={12} /> Go to Gifts tab &rarr;
        </button>
      )}
    </Card>
  );
}

// Shared bucket CRUD + "add funds" form state used by both the Savings tab
// (many linked accounts) and the Annual tab (one account, buckets default to it).
export function useBucketActions(goals, updateGoals, { defaultAccountId } = {}) {
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [deposits, setDeposits] = useState({});

  function setDeposit(id, val) {
    setDeposits((d) => ({ ...d, [id]: val }));
  }

  function addBucket() {
    if (!name.trim()) return;
    const t = parseFloat(target);
    updateGoals([...goals, {
      id: uid(), name: name.trim(), target: t > 0 ? t : null, saved: 0,
      ...(defaultAccountId ? { accountId: defaultAccountId } : {}),
    }]);
    setName(''); setTarget(''); setShowAdd(false);
  }

  function addFunds(id) {
    const amt = parseFloat(deposits[id]);
    if (!amt) return;
    updateGoals(goals.map((g) => (g.id === id
      ? { ...g, saved: g.saved + amt, savedHistory: [...(g.savedHistory || []), { id: uid(), date: todayStr(), delta: amt, type: 'manual' }] }
      : g)));
    setDeposit(id, '');
  }

  function updateTarget(id, val) {
    const t = parseFloat(val);
    updateGoals(goals.map((g) => (g.id === id ? { ...g, target: t > 0 ? t : null } : g)));
  }

  function updateTargetDate(id, val) {
    updateGoals(goals.map((g) => (g.id === id ? { ...g, targetDate: val || undefined } : g)));
  }

  function updateSavedAmount(id, val) {
    const v = Math.max(0, parseFloat(val) || 0);
    updateGoals(goals.map((g) => {
      if (g.id !== id) return g;
      const delta = v - g.saved;
      if (delta === 0) return g;
      return { ...g, saved: v, savedHistory: [...(g.savedHistory || []), { id: uid(), date: todayStr(), delta, type: 'manual' }] };
    }));
  }

  function updateBucketName(id, val) {
    const v = val.trim();
    updateGoals(goals.map((g) => (g.id === id ? { ...g, name: v || g.name } : g)));
  }

  function removeBucket(id) {
    updateGoals(goals.filter((g) => g.id !== id));
  }

  function updateGoalAccount(id, accountId) {
    updateGoals(goals.map((g) => (g.id === id ? { ...g, accountId: accountId || undefined } : g)));
  }

  return {
    showAdd, setShowAdd, name, setName, target, setTarget,
    deposits, setDeposit,
    addBucket, addFunds, updateTarget, updateTargetDate, updateSavedAmount,
    updateBucketName, removeBucket, updateGoalAccount,
  };
}

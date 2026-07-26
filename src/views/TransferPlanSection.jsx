import React, { useState } from 'react';
import { Repeat, Plus, Check, Trash2 } from 'lucide-react';
import { COLORS } from '../lib/constants';
import { uid, formatCurrency, isTransferPlanDone } from '../lib/helpers';
import { Card, PrimaryButton, TextInput, Select, EmptyState } from '../components/ui';

/* ------------------------------ Recurring transfers ------------------------------ */

export function TransferPlanSection({ transferPlans, updateTransferPlans, goals, transactions, completeTransferPlan, undoTransferPlan }) {
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', amount: '', dueDay: '1', bucketId: goals[0]?.id || '' });

  const sortedGoals = [...goals].sort((a, b) => a.name.localeCompare(b.name));

  function bucketName(id) {
    const g = goals.find((x) => x.id === id);
    return g ? g.name : 'Deleted bucket';
  }

  function addPlan() {
    if (!form.name.trim() || !form.amount || !form.bucketId) return;
    updateTransferPlans([...transferPlans, {
      id: uid(), name: form.name.trim(), amount: parseFloat(form.amount) || 0,
      dueDay: parseInt(form.dueDay) || 1, bucketId: form.bucketId, completions: {},
    }]);
    setForm({ name: '', amount: '', dueDay: '1', bucketId: goals[0]?.id || '' });
    setShowAdd(false);
  }

  function updatePlanField(id, field, value) {
    updateTransferPlans(transferPlans.map((p) => (p.id === id ? { ...p, [field]: value } : p)));
  }

  function removePlan(id) {
    updateTransferPlans(transferPlans.filter((p) => p.id !== id));
  }

  const sorted = [...transferPlans].sort((a, b) => a.dueDay - b.dueDay);

  return (
    <Card>
      <div className="flex items-center justify-between gap-3 mb-1">
        <div>
          <h3 className="font-display font-semibold flex items-center gap-1.5" style={{ color: COLORS.ink }}>
            <Repeat size={16} /> Recurring transfers
          </h3>
          <p className="font-body text-xs" style={{ color: COLORS.inkSoft }}>
            Plan out regular transfers from checking into a bucket, then check them off as you make them.
          </p>
        </div>
        {goals.length > 0 && (
          <PrimaryButton onClick={() => setShowAdd((v) => !v)}><Plus size={15} /> New transfer</PrimaryButton>
        )}
      </div>

      {goals.length === 0 ? (
        <div className="mt-3">
          <EmptyState icon={Repeat} title="No buckets yet" subtitle="Create a savings bucket first, then come back to plan recurring transfers into it." />
        </div>
      ) : (
        <>
          {showAdd && (
            <div className="mt-3 grid sm:grid-cols-4 gap-3 items-end rounded-xl p-3" style={{ background: COLORS.bg }}>
              <div>
                <label className="font-body text-xs font-semibold" style={{ color: COLORS.inkSoft }}>Name</label>
                <TextInput placeholder="e.g. Emergency fund" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div>
                <label className="font-body text-xs font-semibold" style={{ color: COLORS.inkSoft }}>Amount</label>
                <TextInput type="number" min="0" step="0.01" placeholder="0.00" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
              </div>
              <div>
                <label className="font-body text-xs font-semibold" style={{ color: COLORS.inkSoft }}>Bucket</label>
                <Select value={form.bucketId} onChange={(e) => setForm({ ...form, bucketId: e.target.value })}>
                  {sortedGoals.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </Select>
              </div>
              <div>
                <label className="font-body text-xs font-semibold" style={{ color: COLORS.inkSoft }}>Day (reference)</label>
                <TextInput type="number" min="1" max="31" value={form.dueDay} onChange={(e) => setForm({ ...form, dueDay: e.target.value })} />
              </div>
              <div className="sm:col-span-4">
                <PrimaryButton onClick={addPlan}><Check size={15} /> Save transfer plan</PrimaryButton>
              </div>
            </div>
          )}

          {sorted.length === 0 ? (
            <p className="font-body text-xs mt-3" style={{ color: COLORS.inkSoft }}>No recurring transfers planned yet.</p>
          ) : (
            <div className="divide-y mt-3" style={{ borderColor: COLORS.border }}>
              {sorted.map((p) => {
                const doneTxId = isTransferPlanDone(p, transactions);
                return (
                  <div key={p.id} className="flex items-center justify-between py-3 gap-3">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <button
                        onClick={() => (doneTxId ? undoTransferPlan(p.id) : completeTransferPlan(p.id))}
                        className="rounded-full w-6 h-6 flex items-center justify-center flex-shrink-0"
                        style={{ background: doneTxId ? COLORS.teal : '#EEEBFA', color: doneTxId ? '#fff' : COLORS.inkSoft }}
                        title={doneTxId ? 'Undo this transfer' : 'Mark as transferred this month'}
                      >
                        {doneTxId && <Check size={14} />}
                      </button>
                      <div className="flex-1 min-w-0">
                        <input
                          key={`name-${p.id}`}
                          defaultValue={p.name}
                          onBlur={(e) => updatePlanField(p.id, 'name', e.target.value.trim() || p.name)}
                          onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                          className="font-body font-semibold text-sm rounded-lg px-1.5 py-0.5 outline-none w-full"
                          style={{ color: COLORS.ink, border: `1.5px solid transparent`, background: 'transparent' }}
                          onFocus={(e) => { e.target.style.borderColor = COLORS.violet; e.target.style.background = '#fff'; }}
                        />
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          <Select
                            value={p.bucketId}
                            onChange={(e) => updatePlanField(p.id, 'bucketId', e.target.value)}
                            style={{ width: 'auto', padding: '2px 24px 2px 8px', fontSize: 12 }}
                          >
                            {sortedGoals.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                            {!goals.some((g) => g.id === p.bucketId) && <option value={p.bucketId}>{bucketName(p.bucketId)}</option>}
                          </Select>
                          <span className="font-body text-xs" style={{ color: COLORS.inkSoft }}>
                            {doneTxId ? `Done this month` : `Not yet transferred this month`}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <div className="flex items-center gap-0.5">
                        <span className="font-display font-semibold text-sm" style={{ color: COLORS.ink }}>$</span>
                        <input
                          key={`amt-${p.id}`}
                          type="number" min="0" step="0.01"
                          defaultValue={p.amount}
                          onBlur={(e) => updatePlanField(p.id, 'amount', Math.abs(parseFloat(e.target.value)) || 0)}
                          onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                          className="font-display font-semibold text-sm rounded-lg px-1.5 py-0.5 outline-none text-right"
                          style={{ width: 70, color: COLORS.ink, border: `1.5px solid ${COLORS.border}` }}
                        />
                      </div>
                      <button onClick={() => removePlan(p.id)} style={{ color: COLORS.inkSoft }} className="hover:text-red-500"><Trash2 size={15} /></button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </Card>
  );
}

import React, { useState } from 'react';
import { Gift, Plus, Check, Trash2, ChevronDown, ChevronRight, Copy, Link2, Unlink, Archive, ArchiveRestore } from 'lucide-react';
import { COLORS } from '../lib/constants';
import { uid, formatCurrency } from '../lib/helpers';
import { Card, PrimaryButton, GhostButton, TextInput, EmptyState, JarBar, Select } from '../components/ui';

/* ---------------------------------- Gifts ---------------------------------- */

export function GiftsView({ giftOccasions, updateGiftOccasions, goals, updateGoals, transactions, updateTransactions }) {
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', date: '' });
  const [expanded, setExpanded] = useState({});
  const [addRecipientFor, setAddRecipientFor] = useState(null);
  const [recipientForm, setRecipientForm] = useState({ name: '', budget: '' });
  const [assignPicks, setAssignPicks] = useState({});
  const [showArchived, setShowArchived] = useState(false);

  const giftsBucket = goals.find((g) => g.name.trim().toLowerCase() === 'gifts');

  // Gifts-bucket withdrawals from the Ledger that haven't been tied to a
  // specific recipient yet. Looked up per allocation entry (not per
  // transaction) since one transaction can be split across recipients.
  const unassignedPurchases = giftsBucket ? transactions
    .flatMap((t) => (t.savingsAllocations || [])
      .filter((a) => a.bucketId === giftsBucket.id && t.savingsDirection === 'withdraw' && !a.giftRecipientId)
      .map((a) => ({ txId: t.id, allocationId: a.id, description: t.description, date: t.date, amount: a.amount })))
    .sort((a, b) => b.date.localeCompare(a.date))
    : [];

  // Every gift purchase (Gifts-bucket withdrawal) split into what's been
  // confirmed as actually transferred out of the bucket vs. still pending
  // that confirmation -- same "Transferred" checkbox as the Ledger, just
  // totaled up here for a real-time view of gift spending.
  const giftSpendStats = giftsBucket ? transactions.reduce((acc, t) => {
    if (t.savingsDirection !== 'withdraw') return acc;
    const entries = (t.savingsAllocations || []).filter((a) => a.bucketId === giftsBucket.id);
    if (entries.length === 0) return acc;
    const amount = entries.reduce((s, a) => s + a.amount, 0);
    const confirmed = t.savingsTransferConfirmed !== false;
    return {
      total: acc.total + amount,
      confirmed: acc.confirmed + (confirmed ? amount : 0),
      pending: acc.pending + (confirmed ? 0 : amount),
    };
  }, { total: 0, confirmed: 0, pending: 0 }) : { total: 0, confirmed: 0, pending: 0 };

  function linkedPurchasesFor(occasionId, recipientId) {
    return transactions.flatMap((t) => (t.savingsAllocations || [])
      .filter((a) => a.giftOccasionId === occasionId && a.giftRecipientId === recipientId)
      .map((a) => ({ txId: t.id, allocationId: a.id, description: t.description, date: t.date, amount: a.amount })));
  }

  function assignPurchase(txId, allocationId, occasionId, recipientId) {
    if (!occasionId || !recipientId) return;
    updateTransactions(transactions.map((t) => (t.id === txId
      ? { ...t, savingsAllocations: t.savingsAllocations.map((a) => (a.id === allocationId ? { ...a, giftOccasionId: occasionId, giftRecipientId: recipientId } : a)) }
      : t)));
    updateGiftOccasions(giftOccasions.map((o) => (o.id === occasionId
      ? { ...o, recipients: o.recipients.map((r) => (r.id === recipientId ? { ...r, purchased: true } : r)) }
      : o)));
    setAssignPicks((p) => { const next = { ...p }; delete next[`${txId}:${allocationId}`]; return next; });
  }

  function unlinkPurchase(txId, allocationId) {
    updateTransactions(transactions.map((t) => (t.id === txId
      ? { ...t, savingsAllocations: t.savingsAllocations.map((a) => (a.id === allocationId ? { ...a, giftOccasionId: undefined, giftRecipientId: undefined } : a)) }
      : t)));
  }

  function addOccasion() {
    if (!form.name.trim()) return;
    const id = uid();
    updateGiftOccasions([...giftOccasions, { id, name: form.name.trim(), date: form.date || undefined, recipients: [] }]);
    setForm({ name: '', date: '' });
    setShowAdd(false);
    setExpanded((p) => ({ ...p, [id]: true }));
  }

  function removeOccasion(id) {
    updateGiftOccasions(giftOccasions.filter((o) => o.id !== id));
  }

  function toggleArchived(id) {
    updateGiftOccasions(giftOccasions.map((o) => (o.id === id ? { ...o, archived: !o.archived } : o)));
  }

  // Increments the last 4-digit year found in the name (e.g. "Christmas
  // 2026" -> "Christmas 2027"); leaves names without a year untouched, so
  // the user can rename by hand ("Mom's Birthday").
  function duplicateOccasion(o) {
    const nextName = o.name.replace(/(\d{4})(?!.*\d)/, (m) => String(parseInt(m, 10) + 1));
    const newId = uid();
    updateGiftOccasions([...giftOccasions, {
      id: newId,
      name: nextName,
      date: undefined,
      recipients: o.recipients.map((r) => ({ id: uid(), name: r.name, budget: r.budget, purchased: false, actualCost: undefined, note: undefined })),
    }]);
    setExpanded((p) => ({ ...p, [newId]: true }));
  }

  function addRecipient(occasionId) {
    if (!recipientForm.name.trim()) return;
    updateGiftOccasions(giftOccasions.map((o) => (o.id === occasionId
      ? { ...o, recipients: [...o.recipients, { id: uid(), name: recipientForm.name.trim(), budget: parseFloat(recipientForm.budget) || 0, purchased: false, actualCost: undefined, note: undefined }] }
      : o)));
    setRecipientForm({ name: '', budget: '' });
    setAddRecipientFor(null);
  }

  function updateRecipient(occasionId, recipientId, patch) {
    updateGiftOccasions(giftOccasions.map((o) => (o.id === occasionId
      ? { ...o, recipients: o.recipients.map((r) => (r.id === recipientId ? { ...r, ...patch } : r)) }
      : o)));
  }

  function removeRecipient(occasionId, recipientId) {
    updateGiftOccasions(giftOccasions.map((o) => (o.id === occasionId
      ? { ...o, recipients: o.recipients.filter((r) => r.id !== recipientId) }
      : o)));
  }

  // Prefer the real linked total once purchases are tied to this
  // recipient; the manual "Actual $" figure stays as a fallback for
  // anyone not using the linking feature (e.g. cash purchases).
  function recipientActualCost(o, r) {
    const linked = linkedPurchasesFor(o.id, r.id);
    if (linked.length > 0) return linked.reduce((s, p) => s + p.amount, 0);
    return Number(r.actualCost) || 0;
  }

  function sortByDate(list) {
    return [...list].sort((a, b) => {
      if (a.date && b.date) return a.date.localeCompare(b.date);
      if (a.date) return -1;
      if (b.date) return 1;
      return 0;
    });
  }
  const activeOccasions = sortByDate(giftOccasions.filter((o) => !o.archived));
  const archivedOccasions = sortByDate(giftOccasions.filter((o) => o.archived));

  const budgetedTotal = activeOccasions.reduce((sum, o) => sum + o.recipients.reduce((s, r) => s + (Number(r.budget) || 0), 0), 0);
  const spentTotal = activeOccasions.reduce((sum, o) => sum + o.recipients.reduce((s, r) => s + (r.purchased ? recipientActualCost(o, r) : 0), 0), 0);
  const needed = Math.max(0, budgetedTotal - spentTotal);
  const remainingCount = activeOccasions.reduce((s, o) => s + o.recipients.filter((r) => !r.purchased).length, 0);

  // Keep the Gifts bucket's target in lockstep with what's actually
  // budgeted across active occasions, so the Annual tab's targets sum
  // reflects reality without re-typing it by hand whenever an occasion
  // changes.
  React.useEffect(() => {
    if (!giftsBucket) return;
    const rounded = Math.round(budgetedTotal * 100) / 100;
    if (Math.abs((giftsBucket.target || 0) - rounded) < 0.005) return;
    updateGoals(goals.map((g) => (g.id === giftsBucket.id ? { ...g, target: rounded > 0 ? rounded : null } : g)));
  }, [budgetedTotal, giftsBucket, goals, updateGoals]);

  function renderOccasionCard(o) {
    const totalBudget = o.recipients.reduce((s, r) => s + (Number(r.budget) || 0), 0);
    const totalSpent = o.recipients.reduce((s, r) => s + (r.purchased ? recipientActualCost(o, r) : 0), 0);
    const purchasedCount = o.recipients.filter((r) => r.purchased).length;
    const pct = totalBudget > 0 ? (totalSpent / totalBudget) * 100 : 0;
    const isOpen = !!expanded[o.id];
    return (
      <Card key={o.id}>
        <div className="flex items-center justify-between gap-3 cursor-pointer" onClick={() => setExpanded((p) => ({ ...p, [o.id]: !p[o.id] }))}>
          <div className="flex items-center gap-2 min-w-0">
            {isOpen ? <ChevronDown size={16} style={{ color: COLORS.inkSoft }} /> : <ChevronRight size={16} style={{ color: COLORS.inkSoft }} />}
            <div className="min-w-0">
              <h3 className="font-display font-semibold truncate" style={{ color: COLORS.ink }}>{o.name}</h3>
              <p className="font-body text-xs" style={{ color: COLORS.inkSoft }}>
                {o.date ? `${o.date} · ` : ''}{purchasedCount} of {o.recipients.length} purchased
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
            {o.archived ? (
              <button onClick={() => toggleArchived(o.id)} title="Unarchive occasion" style={{ color: COLORS.inkSoft }} className="hover:text-violet-600">
                <ArchiveRestore size={15} />
              </button>
            ) : (
              <>
                <button onClick={() => duplicateOccasion(o)} title="Duplicate for next year" style={{ color: COLORS.inkSoft }} className="hover:text-violet-600">
                  <Copy size={15} />
                </button>
                <button onClick={() => toggleArchived(o.id)} title="Archive occasion" style={{ color: COLORS.inkSoft }} className="hover:text-violet-600">
                  <Archive size={15} />
                </button>
              </>
            )}
            <button onClick={() => removeOccasion(o.id)} title="Delete occasion" style={{ color: COLORS.inkSoft }} className="hover:text-red-500">
              <Trash2 size={15} />
            </button>
          </div>
        </div>

        {o.recipients.length > 0 && (
          <div className="mt-3">
            <div className="flex items-center justify-between mb-1">
              <span className="font-body text-xs" style={{ color: COLORS.inkSoft }}>{formatCurrency(totalSpent)} of {formatCurrency(totalBudget)} spent</span>
            </div>
            <JarBar pct={pct} height={8} />
          </div>
        )}

        {isOpen && (
          <div className="mt-4 space-y-2">
            {o.recipients.map((r) => {
              const linked = linkedPurchasesFor(o.id, r.id);
              return (
              <div key={r.id} className="rounded-xl px-3 py-2" style={{ background: COLORS.bg }}>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => updateRecipient(o.id, r.id, { purchased: !r.purchased })}
                    className="rounded-full w-6 h-6 flex items-center justify-center flex-shrink-0"
                    style={{ background: r.purchased ? COLORS.teal : '#EEEBFA', color: r.purchased ? '#fff' : COLORS.inkSoft }}
                    title={r.purchased ? 'Purchased — click to undo' : 'Mark as purchased'}
                  >
                    {r.purchased && <Check size={14} />}
                  </button>
                  <input
                    key={`name-${r.id}`}
                    defaultValue={r.name}
                    onBlur={(e) => updateRecipient(o.id, r.id, { name: e.target.value.trim() || r.name })}
                    onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                    className="font-body font-semibold text-sm rounded-lg px-1.5 py-0.5 outline-none flex-1 min-w-0"
                    style={{ color: COLORS.ink, textDecoration: r.purchased ? 'line-through' : 'none', border: '1.5px solid transparent', background: 'transparent' }}
                    onFocus={(e) => { e.target.style.borderColor = COLORS.violet; e.target.style.background = '#fff'; }}
                  />
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <span className="font-body text-xs" style={{ color: COLORS.inkSoft }}>Budget $</span>
                    <input
                      key={`budget-${r.id}`}
                      type="number" min="0" step="0.01"
                      defaultValue={r.budget}
                      onBlur={(e) => updateRecipient(o.id, r.id, { budget: Math.abs(parseFloat(e.target.value)) || 0 })}
                      onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                      className="font-body text-xs rounded-lg px-1.5 py-0.5 outline-none text-right"
                      style={{ width: 60, color: COLORS.inkSoft, border: `1.5px solid ${COLORS.border}` }}
                    />
                  </div>
                  {r.purchased && (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <span className="font-body text-xs" style={{ color: COLORS.inkSoft }}>Actual $</span>
                      {linked.length > 0 ? (
                        <span className="font-body text-xs font-semibold" style={{ color: COLORS.teal }}>
                          {formatCurrency(linked.reduce((s, p) => s + p.amount, 0))}
                        </span>
                      ) : (
                        <input
                          key={`actual-${r.id}`}
                          type="number" min="0" step="0.01"
                          defaultValue={r.actualCost ?? ''}
                          onBlur={(e) => updateRecipient(o.id, r.id, { actualCost: e.target.value ? (Math.abs(parseFloat(e.target.value)) || 0) : undefined })}
                          onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                          placeholder="0.00"
                          className="font-body text-xs rounded-lg px-1.5 py-0.5 outline-none text-right"
                          style={{ width: 60, color: COLORS.ink, border: `1.5px solid ${COLORS.border}` }}
                        />
                      )}
                    </div>
                  )}
                  <button onClick={() => removeRecipient(o.id, r.id)} style={{ color: COLORS.inkSoft }} className="hover:text-red-500 flex-shrink-0">
                    <Trash2 size={14} />
                  </button>
                </div>
                {linked.length > 0 && (
                  <div className="mt-1.5 ml-8 space-y-1">
                    {linked.map((p) => (
                      <div key={p.allocationId} className="flex items-center justify-between gap-2">
                        <p className="font-body text-xs truncate" style={{ color: COLORS.inkSoft }}>{p.description} &middot; {p.date} &middot; {formatCurrency(p.amount)}</p>
                        <button onClick={() => unlinkPurchase(p.txId, p.allocationId)} title="Unlink this purchase" style={{ color: COLORS.inkSoft }} className="hover:text-red-500 flex-shrink-0">
                          <Unlink size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              );
            })}

            {addRecipientFor === o.id ? (
              <div className="flex items-center gap-2 rounded-xl px-3 py-2" style={{ background: COLORS.violetSoft }}>
                <TextInput
                  placeholder="Name"
                  value={recipientForm.name}
                  onChange={(e) => setRecipientForm({ ...recipientForm, name: e.target.value })}
                  style={{ flex: 1 }}
                />
                <TextInput
                  type="number" min="0" step="0.01"
                  placeholder="Budget"
                  value={recipientForm.budget}
                  onChange={(e) => setRecipientForm({ ...recipientForm, budget: e.target.value })}
                  style={{ width: 100 }}
                />
                <GhostButton onClick={() => addRecipient(o.id)}><Check size={14} /> Add</GhostButton>
              </div>
            ) : (
              <button
                onClick={() => { setAddRecipientFor(o.id); setRecipientForm({ name: '', budget: '' }); }}
                className="font-body text-xs font-semibold"
                style={{ color: COLORS.violet }}
              >
                + Add recipient
              </button>
            )}
          </div>
        )}
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-display font-bold text-2xl" style={{ color: COLORS.ink }}>Gifts</h2>
          <p className="font-body text-sm" style={{ color: COLORS.inkSoft }}>
            Who you're buying for, budgets, and what's left to get.
            {giftsBucket && ` Gifts bucket: ${formatCurrency(giftsBucket.saved || 0)} available.`}
          </p>
        </div>
        <PrimaryButton onClick={() => setShowAdd((v) => !v)}><Plus size={15} /> New occasion</PrimaryButton>
      </div>

      {budgetedTotal > 0 && (
        <Card>
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-display font-semibold" style={{ color: COLORS.ink }}>Gift budget</h3>
            <span className="font-body text-xs" style={{ color: COLORS.inkSoft }}>{formatCurrency(spentTotal)} of {formatCurrency(budgetedTotal)} spent</span>
          </div>
          <JarBar pct={budgetedTotal > 0 ? (spentTotal / budgetedTotal) * 100 : 0} height={14} />

          {giftsBucket && (
            <div className="mt-3">
              <div className="flex items-center justify-between mb-1">
                <span className="font-body text-xs font-semibold" style={{ color: COLORS.ink }}>Available in Gifts bucket</span>
                <span className="font-body text-xs" style={{ color: COLORS.inkSoft }}>{formatCurrency(giftsBucket.saved || 0)} of {formatCurrency(budgetedTotal)}</span>
              </div>
              <div style={{ background: '#EEEBFA', borderRadius: 999, height: 14, overflow: 'hidden' }}>
                <div style={{
                  width: `${Math.min(100, ((giftsBucket.saved || 0) / budgetedTotal) * 100)}%`, height: '100%', borderRadius: 999,
                  background: (giftsBucket.saved || 0) >= needed ? COLORS.teal : COLORS.coral,
                  transition: 'width 0.5s ease',
                }} />
              </div>
            </div>
          )}

          {giftsBucket && needed > 0 && (
            <p className="font-body text-xs mt-2" style={{ color: (giftsBucket.saved || 0) >= needed ? COLORS.inkSoft : COLORS.coral }}>
              {(giftsBucket.saved || 0) >= needed
                ? `You have enough set aside for the ${remainingCount} gift${remainingCount === 1 ? '' : 's'} left to buy.`
                : `Still need ${formatCurrency(needed - (giftsBucket.saved || 0))} more for the ${remainingCount} gift${remainingCount === 1 ? '' : 's'} left to buy.`}
            </p>
          )}
        </Card>
      )}

      {giftSpendStats.total > 0 && (
        <Card>
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-display font-semibold" style={{ color: COLORS.ink }}>Gift spending</h3>
            <span className="font-body text-xs" style={{ color: COLORS.inkSoft }}>{formatCurrency(giftSpendStats.total)} allocated</span>
          </div>
          <div style={{ display: 'flex', height: 14, borderRadius: 999, overflow: 'hidden', background: '#EEEBFA' }}>
            {giftSpendStats.confirmed > 0 && (
              <div style={{ width: `${(giftSpendStats.confirmed / giftSpendStats.total) * 100}%`, background: COLORS.teal }} />
            )}
            {giftSpendStats.pending > 0 && (
              <div style={{ width: `${(giftSpendStats.pending / giftSpendStats.total) * 100}%`, background: COLORS.gold }} />
            )}
          </div>
          <div className="flex items-center gap-4 mt-2">
            <span className="font-body text-xs flex items-center gap-1.5" style={{ color: COLORS.inkSoft }}>
              <span style={{ width: 8, height: 8, borderRadius: 999, background: COLORS.teal, display: 'inline-block' }} />
              Transferred: {formatCurrency(giftSpendStats.confirmed)}
            </span>
            <span className="font-body text-xs flex items-center gap-1.5" style={{ color: COLORS.inkSoft }}>
              <span style={{ width: 8, height: 8, borderRadius: 999, background: COLORS.gold, display: 'inline-block' }} />
              Pending: {formatCurrency(giftSpendStats.pending)}
            </span>
          </div>
        </Card>
      )}

      {unassignedPurchases.length > 0 && (
        <Card>
          <h3 className="font-display font-semibold flex items-center gap-1.5 mb-1" style={{ color: COLORS.ink }}>
            <Link2 size={16} /> Unassigned gift purchases
          </h3>
          <p className="font-body text-xs mb-3" style={{ color: COLORS.inkSoft }}>
            Charged to the Gifts bucket in the Ledger — pick who each one was for.
          </p>
          <div className="space-y-2">
            {unassignedPurchases.map((p) => {
              const key = `${p.txId}:${p.allocationId}`;
              const pick = assignPicks[key] || { occasionId: '', recipientId: '' };
              const pickOccasion = giftOccasions.find((o) => o.id === pick.occasionId);
              return (
                <div key={key} className="flex flex-wrap items-center gap-2 rounded-xl px-3 py-2" style={{ background: COLORS.bg }}>
                  <div className="min-w-0 flex-1">
                    <p className="font-body font-semibold text-sm truncate" style={{ color: COLORS.ink }}>{p.description}</p>
                    <p className="font-body text-xs" style={{ color: COLORS.inkSoft }}>{p.date} &middot; {formatCurrency(p.amount)}</p>
                  </div>
                  <Select
                    value={pick.occasionId}
                    onChange={(e) => setAssignPicks((prev) => ({ ...prev, [key]: { occasionId: e.target.value, recipientId: '' } }))}
                    style={{ width: 'auto', maxWidth: 160 }}
                  >
                    <option value="">Occasion...</option>
                    {activeOccasions.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </Select>
                  <Select
                    value={pick.recipientId}
                    onChange={(e) => setAssignPicks((prev) => ({ ...prev, [key]: { ...pick, recipientId: e.target.value } }))}
                    disabled={!pickOccasion}
                    style={{ width: 'auto', maxWidth: 140 }}
                  >
                    <option value="">Recipient...</option>
                    {pickOccasion?.recipients.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </Select>
                  <GhostButton
                    onClick={() => assignPurchase(p.txId, p.allocationId, pick.occasionId, pick.recipientId)}
                    disabled={!pick.occasionId || !pick.recipientId}
                  >
                    <Check size={14} /> Link
                  </GhostButton>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {showAdd && (
        <Card>
          <div className="grid sm:grid-cols-3 gap-3 items-end">
            <div className="sm:col-span-2">
              <label className="font-body text-xs font-semibold" style={{ color: COLORS.inkSoft }}>Name</label>
              <TextInput placeholder="e.g. Christmas 2026" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <label className="font-body text-xs font-semibold" style={{ color: COLORS.inkSoft }}>Date (optional)</label>
              <TextInput type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </div>
            <div className="sm:col-span-3">
              <PrimaryButton onClick={addOccasion}><Check size={15} /> Save occasion</PrimaryButton>
            </div>
          </div>
        </Card>
      )}

      {activeOccasions.length === 0 ? (
        <Card><EmptyState icon={Gift} title="No occasions yet" subtitle="Add Christmas, a birthday, or any gift-giving occasion to start tracking who you're buying for." /></Card>
      ) : (
        activeOccasions.map(renderOccasionCard)
      )}

      {archivedOccasions.length > 0 && (
        <div>
          <button
            onClick={() => setShowArchived((v) => !v)}
            className="flex items-center gap-1.5 font-body text-sm font-semibold"
            style={{ color: COLORS.inkSoft }}
          >
            {showArchived ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            <Archive size={14} /> Archived occasions ({archivedOccasions.length})
          </button>
          {showArchived && (
            <div className="space-y-5 mt-3">
              {archivedOccasions.map(renderOccasionCard)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

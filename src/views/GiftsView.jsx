import React, { useState } from 'react';
import { Gift, Plus, Check, Trash2, ChevronDown, ChevronRight, Copy } from 'lucide-react';
import { COLORS } from '../lib/constants';
import { uid, formatCurrency } from '../lib/helpers';
import { Card, PrimaryButton, GhostButton, TextInput, EmptyState, JarBar } from '../components/ui';

/* ---------------------------------- Gifts ---------------------------------- */

export function GiftsView({ giftOccasions, updateGiftOccasions, goals }) {
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', date: '' });
  const [expanded, setExpanded] = useState({});
  const [addRecipientFor, setAddRecipientFor] = useState(null);
  const [recipientForm, setRecipientForm] = useState({ name: '', budget: '' });

  const giftsBucket = goals.find((g) => g.name.trim().toLowerCase() === 'gifts');

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

  const sorted = [...giftOccasions].sort((a, b) => {
    if (a.date && b.date) return a.date.localeCompare(b.date);
    if (a.date) return -1;
    if (b.date) return 1;
    return 0;
  });

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

      {sorted.length === 0 ? (
        <Card><EmptyState icon={Gift} title="No occasions yet" subtitle="Add Christmas, a birthday, or any gift-giving occasion to start tracking who you're buying for." /></Card>
      ) : (
        sorted.map((o) => {
          const totalBudget = o.recipients.reduce((s, r) => s + (Number(r.budget) || 0), 0);
          const totalSpent = o.recipients.reduce((s, r) => s + (r.purchased ? (Number(r.actualCost) || 0) : 0), 0);
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
                  <button onClick={() => duplicateOccasion(o)} title="Duplicate for next year" style={{ color: COLORS.inkSoft }} className="hover:text-violet-600">
                    <Copy size={15} />
                  </button>
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
                  {o.recipients.map((r) => (
                    <div key={r.id} className="flex items-center gap-2 rounded-xl px-3 py-2" style={{ background: COLORS.bg }}>
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
                        </div>
                      )}
                      <button onClick={() => removeRecipient(o.id, r.id)} style={{ color: COLORS.inkSoft }} className="hover:text-red-500 flex-shrink-0">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}

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
        })
      )}
    </div>
  );
}

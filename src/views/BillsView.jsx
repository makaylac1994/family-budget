import React, { useState, useMemo } from 'react';
import { CalendarClock, Plus, Check, Trash2 } from 'lucide-react';
import { COLORS, DEFAULT_EXPENSE_CATEGORIES } from '../lib/constants';
import { uid, monthLabel } from '../lib/helpers';
import { Card, PrimaryButton, TextInput, Select, EmptyState, CategoryEditCell } from '../components/ui';

/* ---------------------------------- Bills ---------------------------------- */

export function BillsView({ bills, updateBills, month, budgets, hiddenCategories }) {
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', amount: '', dueDay: '1', category: 'Utilities' });

  const allCategories = useMemo(() => {
    const set = new Set([...DEFAULT_EXPENSE_CATEGORIES, ...Object.keys(budgets)]);
    bills.forEach((b) => set.add(b.category));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [budgets, bills]);

  const visibleCategories = useMemo(
    () => allCategories.filter((c) => !hiddenCategories.includes(c)),
    [allCategories, hiddenCategories]
  );

  function categoryOptionsFor(current) {
    return visibleCategories.includes(current) ? visibleCategories : [...visibleCategories, current];
  }

  function addBill() {
    if (!form.name.trim() || !form.amount) return;
    updateBills([...bills, {
      id: uid(), name: form.name.trim(), amount: parseFloat(form.amount) || 0,
      dueDay: parseInt(form.dueDay) || 1, category: form.category, paidMonths: [],
    }]);
    setForm({ name: '', amount: '', dueDay: '1', category: 'Utilities' });
    setShowAdd(false);
  }

  function togglePaid(id) {
    updateBills(bills.map((b) => {
      if (b.id !== id) return b;
      const paid = b.paidMonths || [];
      const isPaid = paid.includes(month);
      return { ...b, paidMonths: isPaid ? paid.filter((m) => m !== month) : [...paid, month] };
    }));
  }

  function updateBillField(id, field, value) {
    updateBills(bills.map((b) => (b.id === id ? { ...b, [field]: value } : b)));
  }

  function removeBill(id) {
    updateBills(bills.filter((b) => b.id !== id));
  }

  const sorted = [...bills].sort((a, b) => a.dueDay - b.dueDay);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-display font-bold text-2xl" style={{ color: COLORS.ink }}>Recurring bills</h2>
          <p className="font-body text-sm" style={{ color: COLORS.inkSoft }}>Toggling paid applies to {monthLabel(month)}.</p>
        </div>
        <PrimaryButton onClick={() => setShowAdd((v) => !v)}><Plus size={15} /> New bill</PrimaryButton>
      </div>

      {showAdd && (
        <Card>
          <div className="grid sm:grid-cols-4 gap-3 items-end">
            <div>
              <label className="font-body text-xs font-semibold" style={{ color: COLORS.inkSoft }}>Name</label>
              <TextInput placeholder="e.g. Internet" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <label className="font-body text-xs font-semibold" style={{ color: COLORS.inkSoft }}>Amount</label>
              <TextInput type="number" min="0" step="0.01" placeholder="0.00" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            </div>
            <div>
              <label className="font-body text-xs font-semibold" style={{ color: COLORS.inkSoft }}>Due day</label>
              <TextInput type="number" min="1" max="31" value={form.dueDay} onChange={(e) => setForm({ ...form, dueDay: e.target.value })} />
            </div>
            <div>
              <label className="font-body text-xs font-semibold" style={{ color: COLORS.inkSoft }}>Category</label>
              <Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {visibleCategories.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            </div>
            <div className="sm:col-span-4">
              <PrimaryButton onClick={addBill}><Check size={15} /> Save bill</PrimaryButton>
            </div>
          </div>
        </Card>
      )}

      {sorted.length === 0 ? (
        <Card><EmptyState icon={CalendarClock} title="No bills added" subtitle="Add the subscriptions and bills you pay every month." /></Card>
      ) : (
        <Card style={{ padding: 0 }}>
          <div className="divide-y" style={{ borderColor: COLORS.border }}>
            {sorted.map((b) => {
              const isPaid = (b.paidMonths || []).includes(month);
              const billCategoryOptions = categoryOptionsFor(b.category);
              return (
                <div key={b.id} className="flex items-center justify-between px-4 py-3 gap-3">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <button
                      onClick={() => togglePaid(b.id)}
                      className="rounded-full w-6 h-6 flex items-center justify-center flex-shrink-0"
                      style={{ background: isPaid ? COLORS.teal : '#EEEBFA', color: isPaid ? '#fff' : COLORS.inkSoft }}
                    >
                      {isPaid && <Check size={14} />}
                    </button>
                    <div className="flex-1 min-w-0">
                      <input
                        key={`name-${b.id}`}
                        defaultValue={b.name}
                        onBlur={(e) => {
                          e.target.style.borderColor = 'transparent';
                          e.target.style.background = 'transparent';
                          updateBillField(b.id, 'name', e.target.value.trim() || b.name);
                        }}
                        onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                        className="font-body font-semibold text-sm rounded-lg px-1.5 py-0.5 outline-none w-full"
                        style={{ color: COLORS.ink, textDecoration: isPaid ? 'line-through' : 'none', border: `1.5px solid transparent`, background: 'transparent' }}
                        onFocus={(e) => { e.target.style.borderColor = COLORS.violet; e.target.style.background = '#fff'; }}
                      />
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        <CategoryEditCell value={b.category} options={billCategoryOptions} onChange={(cat) => updateBillField(b.id, 'category', cat)} />
                        <div className="flex items-center gap-1">
                          <span className="font-body text-xs" style={{ color: COLORS.inkSoft }}>Due day</span>
                          <input
                            key={`day-${b.id}`}
                            type="number" min="1" max="31"
                            defaultValue={b.dueDay}
                            onBlur={(e) => {
                              const v = parseInt(e.target.value);
                              updateBillField(b.id, 'dueDay', Number.isFinite(v) ? Math.min(31, Math.max(1, v)) : b.dueDay);
                            }}
                            onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                            className="font-body text-xs rounded-lg px-1.5 py-0.5 outline-none"
                            style={{ width: 40, color: COLORS.inkSoft, border: `1.5px solid ${COLORS.border}` }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <div className="flex items-center gap-0.5">
                      <span className="font-display font-semibold text-sm" style={{ color: COLORS.ink }}>$</span>
                      <input
                        key={`amt-${b.id}`}
                        type="number" min="0" step="0.01"
                        defaultValue={b.amount}
                        onBlur={(e) => updateBillField(b.id, 'amount', Math.abs(parseFloat(e.target.value)) || 0)}
                        onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                        className="font-display font-semibold text-sm rounded-lg px-1.5 py-0.5 outline-none text-right"
                        style={{ width: 70, color: COLORS.ink, border: `1.5px solid ${COLORS.border}` }}
                      />
                    </div>
                    <button onClick={() => removeBill(b.id)} style={{ color: COLORS.inkSoft }} className="hover:text-red-500"><Trash2 size={15} /></button>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}

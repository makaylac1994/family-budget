import React, { useState, useMemo } from 'react';
import { Plus, PiggyBank, Palette, Trash2 } from 'lucide-react';
import { COLORS, DEFAULT_EXPENSE_CATEGORIES } from '../lib/constants';
import { categoryColor } from '../lib/categoryColor';
import { formatCurrency, currentMonthStr, budgetAmountForMonth, setBudgetAmountFromNow } from '../lib/helpers';
import { Card, MonthNav, TextInput, PrimaryButton, EmptyState, CategoryBadge, CategoryColorPicker, JarBar } from '../components/ui';

/* ---------------------------------- Budgets ---------------------------------- */

export function BudgetsView({ budgets, updateBudgets, transactions, month, setMonth, categoryColors, updateCategoryColors, goals, goToLedgerCategory }) {
  const [newCat, setNewCat] = useState('');
  const [newLimit, setNewLimit] = useState('');
  const [colorPickerOpen, setColorPickerOpen] = useState({});

  const bucketNameSet = useMemo(() => new Set(goals.map((g) => g.name)), [goals]);

  const spentByCategory = useMemo(() => {
    const map = {};
    transactions.filter((t) => t.type === 'expense' && !t.excludeFromTotals && t.date.startsWith(month)).forEach((t) => {
      if (t.splits && t.splits.length) {
        t.splits.forEach((s) => {
          if (bucketNameSet.has(s.category)) return;
          map[s.category] = (map[s.category] || 0) + s.amount;
        });
      } else if (!bucketNameSet.has(t.category)) {
        map[t.category] = (map[t.category] || 0) + t.amount;
      }
    });
    return map;
  }, [transactions, month, bucketNameSet]);

  function addCategory() {
    if (!newCat.trim() || !newLimit) return;
    updateBudgets({ ...budgets, [newCat.trim()]: parseFloat(newLimit) || 0 });
    setNewCat(''); setNewLimit('');
  }

  const isEditable = month >= currentMonthStr();

  function updateLimit(cat, val) {
    if (!isEditable) return;
    updateBudgets({ ...budgets, [cat]: setBudgetAmountFromNow(budgets[cat], parseFloat(val) || 0) });
  }

  function removeCategory(cat) {
    const next = { ...budgets };
    delete next[cat];
    updateBudgets(next);
  }

  function setCategoryColor(cat, color) {
    updateCategoryColors({ ...categoryColors, [cat]: color });
  }

  function toggleColorPicker(cat) {
    setColorPickerOpen((prev) => ({ ...prev, [cat]: !prev[cat] }));
  }

  // Firestore doesn't preserve map-field key order, so relying on
  // Object.entries(budgets) directly makes cards visually reshuffle any
  // time the household doc round-trips (e.g. after a color change writes
  // categoryColors and the live listener re-fires with a fresh snapshot).
  // Sorting explicitly keeps the order stable regardless of that.
  const entries = Object.entries(budgets).sort((a, b) => a[0].localeCompare(b[0]));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display font-bold text-2xl" style={{ color: COLORS.ink }}>Budgets</h2>
          <p className="font-body text-sm" style={{ color: COLORS.inkSoft }}>Set a monthly limit per category and watch the jars fill.</p>
        </div>
        <MonthNav month={month} setMonth={setMonth} />
      </div>

      <Card>
        <div className="flex flex-wrap gap-2 items-end">
          <div className="flex-1 min-w-[160px]">
            <label className="font-body text-xs font-semibold" style={{ color: COLORS.inkSoft }}>Category name</label>
            <TextInput list="cat-suggestions" placeholder="e.g. Groceries" value={newCat} onChange={(e) => setNewCat(e.target.value)} />
            <datalist id="cat-suggestions">
              {DEFAULT_EXPENSE_CATEGORIES.map((c) => <option key={c} value={c} />)}
            </datalist>
          </div>
          <div>
            <label className="font-body text-xs font-semibold" style={{ color: COLORS.inkSoft }}>Monthly limit</label>
            <TextInput type="number" min="0" step="1" placeholder="0" value={newLimit} onChange={(e) => setNewLimit(e.target.value)} style={{ width: 130 }} />
          </div>
          <PrimaryButton onClick={addCategory}><Plus size={15} /> Add</PrimaryButton>
        </div>
      </Card>

      {entries.length === 0 ? (
        <Card><EmptyState icon={PiggyBank} title="No budgets yet" subtitle="Add your first category above to start tracking limits." /></Card>
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          {entries.map(([cat, rawValue]) => {
            const limit = budgetAmountForMonth(rawValue, month);
            const spent = spentByCategory[cat] || 0;
            const pct = limit ? (spent / limit) * 100 : 0;
            return (
              <Card key={cat}>
                <div className="flex items-center justify-between mb-2">
                  <button onClick={() => goToLedgerCategory(cat)} title={`View ${cat} in Ledger`}>
                    <CategoryBadge cat={cat} />
                  </button>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => toggleColorPicker(cat)}
                      style={{ color: colorPickerOpen[cat] ? COLORS.violet : COLORS.inkSoft }}
                      className="hover:text-violet-600"
                      title="Change color"
                    >
                      <Palette size={14} />
                    </button>
                    <button onClick={() => removeCategory(cat)} style={{ color: COLORS.inkSoft }} className="hover:text-red-500"><Trash2 size={14} /></button>
                  </div>
                </div>
                {colorPickerOpen[cat] && (
                  <div className="mb-3">
                    <CategoryColorPicker current={categoryColor(cat, categoryColors)} onChange={(c) => setCategoryColor(cat, c)} />
                  </div>
                )}
                <JarBar pct={pct} height={16} />
                <div className="flex items-center justify-between mt-2 font-body text-sm">
                  <span style={{ color: COLORS.inkSoft }}>{formatCurrency(spent)} spent</span>
                  <div className="flex items-center gap-1">
                    <span style={{ color: COLORS.inkSoft }}>limit</span>
                    <input
                      type="number" min="0" value={limit}
                      onChange={(e) => updateLimit(cat, e.target.value)}
                      disabled={!isEditable}
                      title={isEditable ? undefined : 'Past months are locked — budgets can only be changed from the current month forward.'}
                      className="w-20 rounded-lg px-2 py-1 text-right font-semibold text-sm outline-none disabled:opacity-60"
                      style={{ border: `1.5px solid ${COLORS.border}`, color: COLORS.ink }}
                    />
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

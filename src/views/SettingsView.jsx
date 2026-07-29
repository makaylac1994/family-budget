import React, { useState, useMemo } from 'react';
import { Check, X, Palette, Settings2, Trash2, Download, RefreshCw, Loader2, Plus } from 'lucide-react';
import { COLORS, DEFAULT_EXPENSE_CATEGORIES } from '../lib/constants';
import { categoryColor } from '../lib/categoryColor';
import { isSavingsAccount, todayStr, uid } from '../lib/helpers';
import { Card, CategoryBadge, TextInput, CategoryColorPicker, Select, GhostButton, PrimaryButton, EmptyState } from '../components/ui';
import { BillsView } from './BillsView';
import { TransferPlanSection } from './TransferPlanSection';

function NoteRow({ note, onSave, onDelete }) {
  const [text, setText] = useState(note.text);
  const [saved, setSaved] = useState(true);

  React.useEffect(() => { setText(note.text); }, [note.text]);

  function handleChange(e) {
    setText(e.target.value);
    setSaved(false);
  }

  function handleBlur() {
    if (text !== note.text) onSave(text);
    setSaved(true);
  }

  return (
    <div className="rounded-xl p-3" style={{ background: COLORS.bg }}>
      <div className="flex items-center justify-between mb-1.5">
        <span className="font-body text-xs" style={{ color: COLORS.inkSoft }}>{saved ? 'Saved' : 'Saving...'}</span>
        <button onClick={onDelete} title="Delete note" style={{ color: COLORS.inkSoft }} className="hover:text-red-500">
          <Trash2 size={14} />
        </button>
      </div>
      <textarea
        value={text}
        onChange={handleChange}
        onBlur={handleBlur}
        rows={4}
        className="w-full rounded-xl px-3 py-2 text-sm font-body outline-none resize-y"
        style={{ border: `1.5px solid ${COLORS.border}`, color: COLORS.ink, background: '#fff' }}
        onFocus={(e) => { e.target.style.borderColor = COLORS.violet; }}
      />
    </div>
  );
}

function NotesSection({ notes, updateNotes }) {
  const [showAdd, setShowAdd] = useState(false);
  const [newText, setNewText] = useState('');

  function addNote() {
    if (!newText.trim()) return;
    updateNotes([...notes, { id: uid(), text: newText.trim(), createdAt: Date.now() }]);
    setNewText('');
    setShowAdd(false);
  }

  function updateNoteText(id, text) {
    updateNotes(notes.map((n) => (n.id === id ? { ...n, text } : n)));
  }

  function removeNote(id) {
    updateNotes(notes.filter((n) => n.id !== id));
  }

  const sorted = [...notes].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  return (
    <Card>
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-display font-semibold" style={{ color: COLORS.ink }}>Notes</h3>
        <GhostButton onClick={() => setShowAdd((v) => !v)}><Plus size={14} /> Add note</GhostButton>
      </div>
      <p className="font-body text-xs mb-3" style={{ color: COLORS.inkSoft }}>
        Shared with everyone in this household &mdash; a good place to write down category definitions, rules of thumb, or anything you want to stay on the same page about.
      </p>
      {showAdd && (
        <div className="mb-3 rounded-xl p-3" style={{ background: COLORS.violetSoft }}>
          <textarea
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            rows={4}
            autoFocus
            placeholder={`e.g.\nGroceries = food + household supplies\nShopping = anything from Amazon that isn't a gift\nDining Out = restaurants, coffee, takeout`}
            className="w-full rounded-xl px-3 py-2 text-sm font-body outline-none resize-y mb-2"
            style={{ border: `1.5px solid ${COLORS.border}`, color: COLORS.ink, background: '#fff' }}
            onFocus={(e) => { e.target.style.borderColor = COLORS.violet; }}
          />
          <PrimaryButton onClick={addNote}><Check size={15} /> Save note</PrimaryButton>
        </div>
      )}
      {sorted.length === 0 ? (
        <EmptyState icon={Settings2} title="No notes yet" subtitle="Add one to write down category definitions or anything else worth remembering." />
      ) : (
        <div className="space-y-3">
          {sorted.map((n) => (
            <NoteRow key={n.id} note={n} onSave={(text) => updateNoteText(n.id, text)} onDelete={() => removeNote(n.id)} />
          ))}
        </div>
      )}
    </Card>
  );
}

// Shared by the full "Categories" section in Settings and the lighter-weight
// "Manage categories" modal opened from the Ledger — one implementation of
// hide/restore/rename/recolor instead of two.
export function CategoryManager({ budgets, transactions, goals, hiddenCategories, updateHiddenCategories, renameCategory, categoryColors, updateCategoryColors }) {
  const bucketNameSet = useMemo(() => new Set(goals.map((g) => g.name)), [goals]);
  const budgetCategorySet = useMemo(() => new Set(Object.keys(budgets)), [budgets]);
  const allCategories = useMemo(() => {
    const set = new Set([...DEFAULT_EXPENSE_CATEGORIES, ...Object.keys(budgets), 'Income']);
    transactions.forEach((t) => { if (!bucketNameSet.has(t.category)) set.add(t.category); });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [budgets, transactions, bucketNameSet]);
  const visibleCategories = useMemo(
    () => allCategories.filter((c) => !hiddenCategories.includes(c)),
    [allCategories, hiddenCategories]
  );

  const [editingCat, setEditingCat] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [colorPickerOpen, setColorPickerOpen] = useState({});

  function hideCategory(cat) {
    if (!hiddenCategories.includes(cat)) updateHiddenCategories([...hiddenCategories, cat]);
  }
  function restoreCategory(cat) {
    updateHiddenCategories(hiddenCategories.filter((c) => c !== cat));
  }

  function startEditing(cat) {
    setEditingCat(cat);
    setEditValue(cat);
  }

  function confirmRename() {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== editingCat) {
      renameCategory(editingCat, trimmed);
    }
    setEditingCat(null);
  }

  function toggleColorPicker(cat) {
    setColorPickerOpen((prev) => ({ ...prev, [cat]: !prev[cat] }));
  }

  function setCategoryColor(cat, color) {
    updateCategoryColors({ ...categoryColors, [cat]: color });
  }

  return (
    <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <p className="font-body text-xs font-semibold mb-1.5" style={{ color: COLORS.inkSoft }}>In use</p>
          <div className="space-y-1.5">
            {visibleCategories.filter((c) => c !== 'Income').map((cat) => (
              <div key={cat}>
                <div className="flex items-center justify-between rounded-xl px-3 py-2" style={{ background: COLORS.bg }}>
                  {editingCat === cat ? (
                    <div className="flex items-center gap-1 flex-1 mr-2">
                      <TextInput
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') confirmRename(); if (e.key === 'Escape') setEditingCat(null); }}
                        autoFocus
                        style={{ padding: '4px 8px', fontSize: 12 }}
                      />
                      <button onClick={confirmRename} style={{ color: COLORS.teal }}><Check size={15} /></button>
                      <button onClick={() => setEditingCat(null)} style={{ color: COLORS.inkSoft }}><X size={15} /></button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <CategoryBadge cat={cat} />
                      {!budgetCategorySet.has(cat) && (
                        <span className="font-body text-xs" style={{ color: COLORS.inkSoft }} title="Not in your budget — added automatically">Auto</span>
                      )}
                    </div>
                  )}
                  {editingCat !== cat && (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => toggleColorPicker(cat)}
                        style={{ color: colorPickerOpen[cat] ? COLORS.violet : COLORS.inkSoft }}
                        className="hover:text-violet-600"
                        title="Change color"
                      >
                        <Palette size={13} />
                      </button>
                      <button onClick={() => startEditing(cat)} style={{ color: COLORS.inkSoft }} className="hover:text-violet-600" title="Rename">
                        <Settings2 size={13} />
                      </button>
                      <button onClick={() => hideCategory(cat)} style={{ color: COLORS.inkSoft }} className="hover:text-red-500" title="Hide from dropdowns">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  )}
                </div>
                {colorPickerOpen[cat] && (
                  <div className="px-3 py-2">
                    <CategoryColorPicker current={categoryColor(cat, categoryColors)} onChange={(c) => setCategoryColor(cat, c)} />
                  </div>
                )}
              </div>
            ))}
            {visibleCategories.filter((c) => c !== 'Income').length === 0 && (
              <p className="font-body text-xs" style={{ color: COLORS.inkSoft }}>No categories to show &mdash; everything's hidden.</p>
            )}
          </div>
        </div>
        <div>
          <p className="font-body text-xs font-semibold mb-1.5" style={{ color: COLORS.inkSoft }}>Hidden</p>
          {hiddenCategories.length === 0 ? (
            <p className="font-body text-xs" style={{ color: COLORS.inkSoft }}>Nothing hidden yet.</p>
          ) : (
            <div className="space-y-1.5">
              {hiddenCategories.filter((c) => allCategories.includes(c)).map((cat) => (
                <div key={cat} className="flex items-center justify-between rounded-xl px-3 py-2" style={{ background: COLORS.bg, opacity: 0.6 }}>
                  <CategoryBadge cat={cat} />
                  <button onClick={() => restoreCategory(cat)} className="font-body text-xs font-semibold" style={{ color: COLORS.violet }}>
                    Restore
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
  );
}

function CategoriesSection(props) {
  return (
    <Card>
      <h3 className="font-display font-semibold mb-2" style={{ color: COLORS.ink }}>Categories</h3>
      <p className="font-body text-xs mb-3" style={{ color: COLORS.inkSoft }}>
        Hide categories you don't use to declutter the dropdowns everywhere in the app. Click the pencil to rename one &mdash; useful for categories the app auto-added from Plaid that don't quite match how you think about them. Renaming updates every transaction, budget, and bill using that category.
      </p>
      <CategoryManager {...props} />
    </Card>
  );
}

function AnnualAccountSection({ accounts, annualAccountId, updateAnnualAccountId }) {
  const savingsAccounts = (accounts || []).filter(isSavingsAccount);

  return (
    <Card>
      <h3 className="font-display font-semibold mb-2" style={{ color: COLORS.ink }}>Annual tracking</h3>
      <p className="font-body text-xs mb-3" style={{ color: COLORS.inkSoft }}>
        Pick which connected account behaves like an active fund with money flowing in and out (not just long-term savings) &mdash; it'll get its own "Annual" tab instead of sitting in Savings.
      </p>
      {savingsAccounts.length === 0 ? (
        <p className="font-body text-xs" style={{ color: COLORS.inkSoft }}>Connect a savings account on the Accounts tab first.</p>
      ) : (
        <Select value={annualAccountId || ''} onChange={(e) => updateAnnualAccountId(e.target.value || null)} style={{ maxWidth: 320 }}>
          <option value="">None</option>
          {savingsAccounts.map((a) => (
            <option key={a.id} value={a.id}>{a.name}{a.mask ? ` ••${a.mask}` : ''}</option>
          ))}
        </Select>
      )}
    </Card>
  );
}

function downloadTransactionsBackup(transactions) {
  const blob = new Blob([JSON.stringify(transactions, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `family-budget-transactions-backup-${todayStr()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function DataBackupSection({ transactions, migrateLegacyTransactions }) {
  const [migrating, setMigrating] = useState(false);

  async function handleMigrate() {
    const ok = window.confirm(
      "This moves your saved transactions into the new storage format. We recommend downloading a backup first (button above) — have you done that? Continue?"
    );
    if (!ok) return;
    setMigrating(true);
    try {
      await migrateLegacyTransactions();
    } catch (e) {
      window.alert(`Migration failed: ${e.message}. Nothing is removed unless it fully succeeds — safe to try again.`);
    } finally {
      setMigrating(false);
    }
  }

  return (
    <Card>
      <h3 className="font-display font-semibold mb-2" style={{ color: COLORS.ink }}>Backup</h3>
      <p className="font-body text-xs mb-3" style={{ color: COLORS.inkSoft }}>
        Download a copy of all {transactions.length} transactions as a file on your computer &mdash; a safety net before any big change, or just for peace of mind.
      </p>
      <div className="flex flex-wrap gap-2">
        <GhostButton onClick={() => downloadTransactionsBackup(transactions)}>
          <Download size={15} /> Download transactions backup
        </GhostButton>
        <GhostButton onClick={handleMigrate} disabled={migrating}>
          {migrating ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />} Migrate old transaction storage
        </GhostButton>
      </div>
    </Card>
  );
}

export function SettingsView({ bills, updateBills, month, budgets, transactions, goals, hiddenCategories, updateHiddenCategories, notes, updateNotes, accounts, annualAccountId, updateAnnualAccountId, renameCategory, categoryColors, updateCategoryColors, migrateLegacyTransactions, transferPlans, updateTransferPlans, completeTransferPlan, undoTransferPlan }) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-display font-bold text-2xl" style={{ color: COLORS.ink }}>Settings</h2>
        <p className="font-body text-sm" style={{ color: COLORS.inkSoft }}>Notes, categories, and recurring bills and transfers, all in one place.</p>
      </div>

      <NotesSection notes={notes} updateNotes={updateNotes} />
      <CategoriesSection budgets={budgets} transactions={transactions} goals={goals} hiddenCategories={hiddenCategories} updateHiddenCategories={updateHiddenCategories} renameCategory={renameCategory} categoryColors={categoryColors} updateCategoryColors={updateCategoryColors} />
      <AnnualAccountSection accounts={accounts} annualAccountId={annualAccountId} updateAnnualAccountId={updateAnnualAccountId} />
      <BillsView bills={bills} updateBills={updateBills} month={month} budgets={budgets} hiddenCategories={hiddenCategories} />
      <TransferPlanSection
        transferPlans={transferPlans}
        updateTransferPlans={updateTransferPlans}
        goals={goals}
        transactions={transactions}
        completeTransferPlan={completeTransferPlan}
        undoTransferPlan={undoTransferPlan}
      />
      <DataBackupSection transactions={transactions} migrateLegacyTransactions={migrateLegacyTransactions} />
    </div>
  );
}

import React, { useState, useMemo } from 'react';
import Papa from 'papaparse';
import {
  PiggyBank, Upload, Plus, Trash2, Search, ChevronRight, ChevronDown, ChevronUp,
  TrendingUp, TrendingDown, X, Check, Sparkles, Flame, Scissors, Settings2, Repeat,
  Receipt, CreditCard, Landmark, ArrowUpDown, Clock, Flag, StickyNote, Layers, Link2,
} from 'lucide-react';
import { COLORS, DEFAULT_EXPENSE_CATEGORIES } from '../lib/constants';
import {
  uid, indexById, isSavingsAccount, formatCurrency, todayStr, normalizeDescription,
  merchantToken, txSignature, detectHeaderMap, rowToTransaction, paymentSourceFor,
  allocationDirection, isAllocationApplied,
} from '../lib/helpers';
import {
  Card, TextInput, Select, PrimaryButton, GhostButton, MonthNav, EmptyState,
  CategoryBadge, CategoryEditCell, AmountEditCell,
} from '../components/ui';
import { CategoryManager } from './SettingsView';

/* ---------------------------------- Ledger ---------------------------------- */

const SORT_FIELDS = [
  { value: 'none', label: 'None' },
  { value: 'date', label: 'Date' },
  { value: 'description', label: 'Description' },
  { value: 'amount', label: 'Amount' },
  { value: 'category', label: 'Category' },
  { value: 'type', label: 'Type' },
  { value: 'flag', label: 'Flag' },
];

const FLAG_TYPES = [
  { value: 'any', label: 'Any (default priority)' },
  { value: 'flaggedForReview', label: 'Flagged for partner' },
  { value: 'pendingRemoval', label: 'Needs review (bank)' },
  { value: 'pending', label: 'Pending' },
  { value: 'excludeFromTotals', label: 'Excluded (transfer)' },
];

// Lower rank sorts first (ascending) -- most attention-worthy flags lead.
// A manual flag outranks the automatic bank-sync ones: it's a deliberate
// ask from one partner to the other, not just a data-integrity heads-up.
function flagRank(t, flagType) {
  if (flagType && flagType !== 'any') return t[flagType] ? 0 : 1;
  if (t.flaggedForReview) return 0;
  if (t.pendingRemoval) return 1;
  if (t.pending) return 2;
  if (t.excludeFromTotals) return 3;
  return 4;
}

const DEFAULT_SORT_RULES = [
  { field: 'date', dir: 'desc', flagType: 'any' },
  { field: 'none', dir: 'asc', flagType: 'any' },
  { field: 'none', dir: 'asc', flagType: 'any' },
];

function compareByField(a, b, field, flagType) {
  if (field === 'amount') return a.amount - b.amount;
  if (field === 'date') return a.date.localeCompare(b.date);
  if (field === 'description') return a.description.localeCompare(b.description, undefined, { sensitivity: 'base' });
  if (field === 'category') return a.category.localeCompare(b.category, undefined, { sensitivity: 'base' });
  if (field === 'type') return a.type.localeCompare(b.type);
  if (field === 'flag') return flagRank(a, flagType) - flagRank(b, flagType);
  return 0;
}

function isRollupEligible(t) {
  return t.excludeFromTotals === true
    && !t.pendingRemoval
    && !t.flaggedForReview
    && !t.note
    && !t.pending
    && !(t.savingsAllocations && t.savingsAllocations.length && t.savingsTransferConfirmed === false);
}

function weekKeyOf(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  const monday = new Date(d);
  monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return monday.toISOString().slice(0, 10);
}

export function LedgerView({ transactions, updateTransactions, budgets, month, setMonth, hiddenCategories, updateHiddenCategories, categoryMemory, updateCategoryMemory, goals, updateGoals, accounts, catFilter, setCatFilter, sourceFilter, setSourceFilter, typeFilter, setTypeFilter, lastSyncAt, bucketFilter, setBucketFilter, renameCategory, categoryColors, updateCategoryColors }) {
  const [search, setSearch] = useState('');
  const [amountMin, setAmountMin] = useState('');
  const [amountMax, setAmountMax] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [showSort, setShowSort] = useState(false);
  const [sortRules, setSortRules] = useState(DEFAULT_SORT_RULES);
  const [showMoreFilters, setShowMoreFilters] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [preview, setPreview] = useState(null);
  const [splitTarget, setSplitTarget] = useState(null);
  const [splitRows, setSplitRows] = useState([]);
  const [remainderCategory, setRemainderCategory] = useState('Other');
  const [expandedSplits, setExpandedSplits] = useState({});
  const [expandedNotes, setExpandedNotes] = useState({});
  const [showCategoryManager, setShowCategoryManager] = useState(false);
  const [groupTransfers, setGroupTransfers] = useState(false);
  const [expandedRollups, setExpandedRollups] = useState({});
  const [linkTarget, setLinkTarget] = useState(null);
  const [linkSearch, setLinkSearch] = useState('');
  const [expandedLinks, setExpandedLinks] = useState({});
  const [expandedDetails, setExpandedDetails] = useState({});
  const [allocateTarget, setAllocateTarget] = useState(null);
  const [allocateRows, setAllocateRows] = useState([]);
  const [newBucketName, setNewBucketName] = useState('');
  const [allocateDirection, setAllocateDirection] = useState('deposit');
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  const accountsById = useMemo(() => indexById(accounts), [accounts]);
  const savingsAccountsList = useMemo(
    () => (accounts || []).filter(isSavingsAccount),
    [accounts]
  );
  const bucketGroups = useMemo(() => {
    const linkedIds = new Set(savingsAccountsList.map((a) => a.id));
    const groups = savingsAccountsList
      .map((a) => ({
        id: a.id,
        label: `${a.name}${a.mask ? ` ••${a.mask}` : ''}`,
        buckets: goals.filter((g) => g.accountId === a.id),
      }))
      .filter((grp) => grp.buckets.length > 0);
    const unlinked = goals.filter((g) => !g.accountId || !linkedIds.has(g.accountId));
    if (unlinked.length) groups.push({ id: 'unlinked', label: 'Not linked to an account', buckets: unlinked });
    return groups;
  }, [savingsAccountsList, goals]);
  function togglePaymentSource(id) {
    const tx = transactions.find((t) => t.id === id);
    if (!tx) return;
    const current = paymentSourceFor(tx, accountsById);
    const next = current === 'card' ? 'bank' : 'card';
    updateTransactions(transactions.map((t) => (t.id === id ? { ...t, paymentSource: next } : t)));
  }

  function toggleExcluded(id) {
    updateTransactions(transactions.map((t) => (t.id === id ? { ...t, excludeFromTotals: !t.excludeFromTotals } : t)));
  }

  function toggleFlag(id) {
    updateTransactions(transactions.map((t) => (t.id === id ? { ...t, flaggedForReview: !t.flaggedForReview } : t)));
  }

  function updateNote(id, note) {
    updateTransactions(transactions.map((t) => (t.id === id ? { ...t, note: note || undefined } : t)));
  }

  const connectedAccountIds = useMemo(() => new Set((accounts || []).map((a) => a.id)), [accounts]);
  const orphanedTransactions = useMemo(
    () => transactions
      .filter((t) => t.plaidAccountId && !connectedAccountIds.has(t.plaidAccountId))
      .sort((a, b) => b.date.localeCompare(a.date)),
    [transactions, connectedAccountIds]
  );
  const [showOrphanReview, setShowOrphanReview] = useState(false);
  const [orphanSelected, setOrphanSelected] = useState(() => new Set());

  function toggleOrphanSelected(id) {
    setOrphanSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function deleteSelectedOrphans() {
    if (orphanSelected.size === 0) return;
    if (!window.confirm(`Permanently delete ${orphanSelected.size} transaction(s)? This can't be undone.`)) return;
    reverseAllocationsForBulkDelete(transactions.filter((t) => orphanSelected.has(t.id)));
    updateTransactions(
      transactions
        .filter((t) => !orphanSelected.has(t.id))
        .map((t) => (t.linkedTransferId && orphanSelected.has(t.linkedTransferId) ? { ...t, linkedTransferId: undefined } : t))
    );
    setOrphanSelected(new Set());
    setShowOrphanReview(false);
  }

  function toggleSelected(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function deleteSelected() {
    if (selectedIds.size === 0) return;
    if (!window.confirm(`Delete ${selectedIds.size} selected transaction(s)? This can't be undone.`)) return;
    reverseAllocationsForBulkDelete(transactions.filter((t) => selectedIds.has(t.id)));
    updateTransactions(
      transactions
        .filter((t) => !selectedIds.has(t.id))
        .map((t) => (t.linkedTransferId && selectedIds.has(t.linkedTransferId) ? { ...t, linkedTransferId: undefined } : t))
    );
    setSelectedIds(new Set());
  }

  function markSelectedAsTransfer(exclude) {
    if (selectedIds.size === 0) return;
    updateTransactions(transactions.map((t) => (selectedIds.has(t.id) ? { ...t, excludeFromTotals: exclude } : t)));
    setSelectedIds(new Set());
  }

  function rememberCategory(description, category) {
    const exactKey = normalizeDescription(description);
    if (!exactKey || !category) return;
    const token = merchantToken(description);
    updateCategoryMemory({
      exact: { ...categoryMemory.exact, [exactKey]: category },
      merchant: token ? { ...categoryMemory.merchant, [token]: category } : categoryMemory.merchant,
    });
  }

  const bucketNameSet = useMemo(() => new Set(goals.map((g) => g.name)), [goals]);

  const allCategories = useMemo(() => {
    const set = new Set([...DEFAULT_EXPENSE_CATEGORIES, ...Object.keys(budgets), 'Income']);
    transactions.forEach((t) => { if (!bucketNameSet.has(t.category)) set.add(t.category); });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [budgets, transactions, bucketNameSet]);

  const visibleCategories = useMemo(
    () => allCategories.filter((c) => !hiddenCategories.includes(c)),
    [allCategories, hiddenCategories]
  );

  function categoryOptionsFor(current) {
    if (visibleCategories.includes(current)) return visibleCategories;
    if (bucketCategoryNames.includes(current)) return visibleCategories;
    return [...visibleCategories, current];
  }

  const [form, setForm] = useState({ date: todayStr(), description: '', category: 'Groceries', amount: '', type: 'expense' });

  const hasCustomDateRange = !!(dateFrom || dateTo);

  function updateSortRule(index, patch) {
    setSortRules((rules) => rules.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function compareTransactions(a, b) {
    for (const rule of sortRules) {
      if (rule.field === 'none') continue;
      const cmp = compareByField(a, b, rule.field, rule.flagType);
      if (cmp !== 0) return rule.dir === 'desc' ? -cmp : cmp;
    }
    return 0;
  }

  const filtered = useMemo(() => {
    if (bucketFilter) {
      return transactions
        .filter((t) => t.savingsAllocations && t.savingsAllocations.some((a) => a.bucketId === bucketFilter))
        .filter((t) => t.description.toLowerCase().includes(search.toLowerCase()))
        .sort(compareTransactions);
    }
    return transactions
      .filter((t) => (hasCustomDateRange
        ? (!dateFrom || t.date >= dateFrom) && (!dateTo || t.date <= dateTo)
        : t.date.startsWith(month)))
      .filter((t) => catFilter === 'All' || t.category === catFilter || (t.splits && t.splits.some((s) => s.category === catFilter)))
      .filter((t) => sourceFilter === 'All' || paymentSourceFor(t, accountsById) === sourceFilter)
      .filter((t) => typeFilter === 'All' || t.type === typeFilter)
      .filter((t) => !amountMin || t.amount >= parseFloat(amountMin))
      .filter((t) => !amountMax || t.amount <= parseFloat(amountMax))
      .filter((t) => t.description.toLowerCase().includes(search.toLowerCase()))
      .sort(compareTransactions);
  }, [transactions, month, catFilter, sourceFilter, typeFilter, bucketFilter, accountsById, search, dateFrom, dateTo, hasCustomDateRange, amountMin, amountMax, sortRules]);

  const transactionsById = useMemo(() => indexById(transactions), [transactions]);

  const absorbedTransferIds = useMemo(() => {
    const s = new Set();
    filtered.forEach((t) => { if (t.linkedTransferId && transactionsById[t.linkedTransferId]) s.add(t.linkedTransferId); });
    return s;
  }, [filtered, transactionsById]);

  const visibleFiltered = useMemo(
    () => filtered.filter((t) => !absorbedTransferIds.has(t.id)),
    [filtered, absorbedTransferIds]
  );

  const renderItems = useMemo(() => {
    if (!groupTransfers) return visibleFiltered.map((t) => ({ type: 'tx', t }));
    const items = [];
    let run = [];
    const flush = () => {
      if (run.length >= 2) {
        items.push({ type: 'rollup', id: `rollup-${run[0].id}`, items: run, total: run.reduce((s, x) => s + x.amount, 0) });
      } else {
        run.forEach((t) => items.push({ type: 'tx', t }));
      }
      run = [];
    };
    for (const t of visibleFiltered) {
      const eligible = isRollupEligible(t);
      if (eligible && (run.length === 0 || weekKeyOf(t.date) === weekKeyOf(run[run.length - 1].date))) {
        run.push(t);
      } else {
        flush();
        if (eligible) run.push(t); else items.push({ type: 'tx', t });
      }
    }
    flush();
    return items;
  }, [visibleFiltered, groupTransfers]);

  const linkCandidates = useMemo(() => {
    if (!linkTarget) return [];
    const monthKey = linkTarget.date.slice(0, 7);
    const linkedElsewhere = new Set(
      transactions.filter((t) => t.linkedTransferId && t.id !== linkTarget.id).map((t) => t.linkedTransferId)
    );
    return transactions
      .filter((t) => t.id !== linkTarget.id && t.excludeFromTotals && t.date.startsWith(monthKey))
      .filter((t) => !linkedElsewhere.has(t.id) || t.id === linkTarget.linkedTransferId)
      .filter((t) => t.description.toLowerCase().includes(linkSearch.toLowerCase()))
      .sort((a, b) => Math.abs(a.amount - linkTarget.amount) - Math.abs(b.amount - linkTarget.amount));
  }, [linkTarget, linkSearch, transactions]);

  const filteredSummary = useMemo(() => {
    let countedIncome = 0, countedExpense = 0, excludedTotal = 0, excludedCount = 0;
    filtered.forEach((t) => {
      if (t.excludeFromTotals) {
        excludedTotal += t.amount;
        excludedCount++;
      } else if (t.type === 'income') {
        countedIncome += t.amount;
      } else {
        countedExpense += t.amount;
      }
    });
    return { countedIncome, countedExpense, excludedTotal, excludedCount };
  }, [filtered]);

  function addTransaction() {
    if (!form.description.trim() || !form.amount) return;
    const tx = {
      id: uid(), date: form.date, description: form.description.trim(),
      category: form.type === 'income' ? 'Income' : form.category,
      amount: Math.abs(parseFloat(form.amount)) || 0, type: form.type,
    };
    updateTransactions([tx, ...transactions]);
    if (tx.type === 'expense') rememberCategory(tx.description, tx.category);
    setForm({ date: todayStr(), description: '', category: 'Groceries', amount: '', type: 'expense' });
    setShowAdd(false);
  }

  function removeTransaction(id) {
    const tx = transactions.find((t) => t.id === id);
    if (tx && isAllocationApplied(tx)) {
      const oldSign = allocationDirection(tx) === 'withdraw' ? -1 : 1;
      applyAllocationDelta(tx.savingsAllocations, oldSign, [], 1);
    }
    updateTransactions(
      transactions
        .filter((t) => t.id !== id)
        .map((t) => (t.linkedTransferId === id ? { ...t, linkedTransferId: undefined } : t))
    );
  }

  const bucketCategoryNames = useMemo(() => goals.map((g) => g.name), [goals]);

  function updateCategory(id, category) {
    const tx = transactions.find((t) => t.id === id);
    if (tx) rememberCategory(tx.description, category);
    updateTransactions(transactions.map((t) => (t.id === id ? { ...t, category } : t)));
  }

  function updateDate(id, date) {
    updateTransactions(transactions.map((t) => (t.id === id ? { ...t, date } : t)));
  }

  function updateCategoryOrAllocate(id, newValue) {
    const tx = transactions.find((t) => t.id === id);
    if (!tx) return;
    const newBucket = goals.find((g) => g.name === newValue);
    const wasApplied = isAllocationApplied(tx);

    if (newBucket) {
      // Reverse any previously-applied allocation before switching categories
      if (wasApplied) {
        const oldSign = allocationDirection(tx) === 'withdraw' ? -1 : 1;
        applyAllocationDelta(tx.savingsAllocations, oldSign, [], 1);
      }
      const newAlloc = [{ id: uid(), bucketId: newBucket.id, amount: tx.amount }];
      updateTransactions(transactions.map((t) => (
        t.id === id
          ? { ...t, category: newValue, savingsAllocations: newAlloc, savingsDirection: 'withdraw', savingsTransferConfirmed: false }
          : t
      )));
    } else if (tx.savingsAllocations) {
      if (wasApplied) {
        const oldSign = allocationDirection(tx) === 'withdraw' ? -1 : 1;
        applyAllocationDelta(tx.savingsAllocations, oldSign, [], 1);
      }
      rememberCategory(tx.description, newValue);
      updateTransactions(transactions.map((t) => (
        t.id === id ? { ...t, category: newValue, savingsAllocations: undefined, savingsDirection: undefined, savingsTransferConfirmed: undefined } : t
      )));
    } else {
      rememberCategory(tx.description, newValue);
      updateTransactions(transactions.map((t) => (t.id === id ? { ...t, category: newValue } : t)));
    }
  }

  function toggleTransferConfirmed(id) {
    const tx = transactions.find((t) => t.id === id);
    if (!tx || !tx.savingsAllocations || !tx.savingsAllocations.length) return;
    const sign = allocationDirection(tx) === 'withdraw' ? -1 : 1;
    const nowConfirmed = !isAllocationApplied(tx);
    if (nowConfirmed) {
      applyAllocationDelta([], 1, tx.savingsAllocations, sign);
    } else {
      applyAllocationDelta(tx.savingsAllocations, sign, [], 1);
    }
    updateTransactions(transactions.map((t) => (t.id === id ? { ...t, savingsTransferConfirmed: nowConfirmed } : t)));
  }

  function updateAmount(id, amount) {
    const tx = transactions.find((t) => t.id === id);
    if (tx && tx.savingsAllocations && tx.savingsAllocations.length && tx.amount > 0) {
      const ratio = amount / tx.amount;
      const newAlloc = tx.savingsAllocations.map((a) => ({ ...a, amount: Math.round(a.amount * ratio * 100) / 100 }));
      if (isAllocationApplied(tx)) {
        const sign = allocationDirection(tx) === 'withdraw' ? -1 : 1;
        applyAllocationDelta(tx.savingsAllocations, sign, newAlloc, sign);
      }
      updateTransactions(transactions.map((t) => (t.id === id ? { ...t, amount, savingsAllocations: newAlloc } : t)));
      return;
    }
    updateTransactions(transactions.map((t) => (t.id === id ? { ...t, amount } : t)));
  }

  function updateType(id) {
    const tx = transactions.find((t) => t.id === id);
    if (!tx) return;
    const newType = tx.type === 'income' ? 'expense' : 'income';
    const newCategory = newType === 'income'
      ? 'Income'
      : (tx.category === 'Income' ? 'Other' : tx.category);
    if (newType === 'expense') rememberCategory(tx.description, newCategory);
    updateTransactions(transactions.map((t) => (
      t.id === id ? { ...t, type: newType, category: newCategory } : t
    )));
  }

  function updateSplitCategory(txId, splitId, category) {
    const tx = transactions.find((t) => t.id === txId);
    if (!tx || !tx.splits) return;
    const newSplits = tx.splits.map((s) => (s.id === splitId ? { ...s, category } : s));

    const newSavingsAllocations = newSplits
      .filter((s) => bucketNameSet.has(s.category))
      .map((s) => {
        const bucket = goals.find((g) => g.name === s.category);
        return bucket ? { id: uid(), bucketId: bucket.id, amount: s.amount } : null;
      })
      .filter(Boolean);

    const wasApplied = isAllocationApplied(tx);
    const oldSign = allocationDirection(tx) === 'withdraw' ? -1 : 1;
    applyAllocationDelta(wasApplied ? tx.savingsAllocations : [], oldSign, [], 1);

    if (!bucketNameSet.has(category)) rememberCategory(tx.description, category);

    updateTransactions(transactions.map((t) => (
      t.id === txId
        ? {
            ...t,
            splits: newSplits,
            savingsAllocations: newSavingsAllocations.length ? newSavingsAllocations : undefined,
            savingsDirection: newSavingsAllocations.length ? 'withdraw' : undefined,
            savingsTransferConfirmed: newSavingsAllocations.length ? false : undefined,
          }
        : t
    )));
  }

  function openLinkModal(t) {
    setLinkTarget(t);
    setLinkSearch('');
  }

  function linkTransfer(transferId) {
    updateTransactions(transactions.map((t) => (t.id === linkTarget.id ? { ...t, linkedTransferId: transferId } : t)));
    setLinkTarget(null);
  }

  function unlinkTransfer() {
    updateTransactions(transactions.map((t) => (t.id === linkTarget.id ? { ...t, linkedTransferId: undefined } : t)));
    setLinkTarget(null);
  }

  function openSplitModal(t) {
    setSplitTarget(t);
    if (t.splits && t.splits.length) {
      setSplitRows(t.splits.slice(0, -1).map((s) => ({ id: uid(), category: s.category, amount: String(s.amount) })));
      setRemainderCategory(t.splits[t.splits.length - 1].category);
    } else {
      setSplitRows([]);
      setRemainderCategory(t.category);
    }
  }

  function addSplitRow() {
    setSplitRows((rows) => [...rows, { id: uid(), category: 'Other', amount: '' }]);
  }

  function updateSplitRow(id, field, value) {
    setSplitRows((rows) => rows.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  }

  function removeSplitRow(id) {
    setSplitRows((rows) => rows.filter((r) => r.id !== id));
  }

  const explicitSum = splitRows.reduce((s, r) => s + (Math.abs(parseFloat(r.amount)) || 0), 0);
  const remaining = splitTarget ? Math.round((splitTarget.amount - explicitSum) * 100) / 100 : 0;

  function confirmSplit() {
    if (!splitTarget) return;
    const explicit = splitRows
      .map((r) => ({ category: r.category, amount: Math.abs(parseFloat(r.amount)) || 0 }))
      .filter((r) => r.amount > 0);
    if (explicit.length === 0 || remaining < 0) return;
    const finalSplits = remaining > 0
      ? [...explicit, { category: remainderCategory, amount: remaining }]
      : explicit;
    const withIds = finalSplits.map((s) => ({ id: uid(), ...s }));

    // Route any split rows pointed at a savings bucket into savingsAllocations instead of budget categories.
    // These start pending (unconfirmed) until the "Transferred" checkbox is checked.
    const newSavingsAllocations = withIds
      .filter((s) => bucketNameSet.has(s.category))
      .map((s) => {
        const bucket = goals.find((g) => g.name === s.category);
        return bucket ? { id: uid(), bucketId: bucket.id, amount: s.amount } : null;
      })
      .filter(Boolean);

    const wasApplied = isAllocationApplied(splitTarget);
    const oldSign = allocationDirection(splitTarget) === 'withdraw' ? -1 : 1;
    applyAllocationDelta(wasApplied ? splitTarget.savingsAllocations : [], oldSign, [], 1);

    updateTransactions(transactions.map((t) => (
      t.id === splitTarget.id
        ? {
            ...t,
            splits: withIds,
            savingsAllocations: newSavingsAllocations.length ? newSavingsAllocations : undefined,
            savingsDirection: newSavingsAllocations.length ? 'withdraw' : undefined,
            savingsTransferConfirmed: newSavingsAllocations.length ? false : undefined,
          }
        : t
    )));
    setExpandedSplits((prev) => ({ ...prev, [splitTarget.id]: true }));
    setSplitTarget(null);
  }

  function removeSplit(id) {
    const tx = transactions.find((t) => t.id === id);
    if (tx && isAllocationApplied(tx)) {
      const oldSign = allocationDirection(tx) === 'withdraw' ? -1 : 1;
      applyAllocationDelta(tx.savingsAllocations, oldSign, [], 1);
    }
    updateTransactions(transactions.map((t) => (
      t.id === id ? { ...t, splits: undefined, savingsAllocations: undefined, savingsDirection: undefined, savingsTransferConfirmed: undefined } : t
    )));
  }

  function openAllocateModal(t) {
    setAllocateTarget(t);
    const existing = (t.savingsAllocations || []).map((a) => ({ id: uid(), bucketId: a.bucketId, amount: String(a.amount) }));
    setAllocateRows(existing.length ? existing : (goals.length ? [{ id: uid(), bucketId: goals[0].id, amount: String(t.amount) }] : []));
    setAllocateDirection(allocationDirection(t));
    setNewBucketName('');
  }

  function addAllocateRow() {
    setAllocateRows((rows) => [...rows, { id: uid(), bucketId: goals[0] ? goals[0].id : '', amount: '' }]);
  }

  function updateAllocateRow(id, field, value) {
    setAllocateRows((rows) => rows.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  }

  function removeAllocateRow(id) {
    setAllocateRows((rows) => rows.filter((r) => r.id !== id));
  }

  function createBucketInline() {
    if (!newBucketName.trim()) return;
    const bucket = { id: uid(), name: newBucketName.trim(), saved: 0, target: null };
    updateGoals([...goals, bucket]);
    setAllocateRows((rows) => [...rows, { id: uid(), bucketId: bucket.id, amount: '' }]);
    setNewBucketName('');
  }

  const allocatedSum = allocateRows.reduce((s, r) => s + (Math.abs(parseFloat(r.amount)) || 0), 0);
  const allocateOverBudget = allocateTarget ? allocatedSum > allocateTarget.amount + 0.001 : false;

  function applyAllocationDelta(oldAllocations, oldSign, newAllocations, newSign) {
    const oldByBucket = {};
    (oldAllocations || []).forEach((a) => { oldByBucket[a.bucketId] = (oldByBucket[a.bucketId] || 0) + a.amount; });
    const newByBucket = {};
    newAllocations.forEach((a) => { newByBucket[a.bucketId] = (newByBucket[a.bucketId] || 0) + a.amount; });
    const touched = new Set([...Object.keys(oldByBucket), ...Object.keys(newByBucket)]);
    updateGoals(goals.map((g) => {
      if (!touched.has(g.id)) return g;
      const delta = newSign * (newByBucket[g.id] || 0) - oldSign * (oldByBucket[g.id] || 0);
      return { ...g, saved: Math.max(0, g.saved + delta) };
    }));
  }

  function reverseAllocationsForBulkDelete(txList) {
    const deltaByBucket = {};
    txList.forEach((tx) => {
      if (!isAllocationApplied(tx)) return;
      const sign = allocationDirection(tx) === 'withdraw' ? -1 : 1;
      tx.savingsAllocations.forEach((a) => {
        deltaByBucket[a.bucketId] = (deltaByBucket[a.bucketId] || 0) - sign * a.amount;
      });
    });
    if (Object.keys(deltaByBucket).length === 0) return;
    updateGoals(goals.map((g) => (
      deltaByBucket[g.id] ? { ...g, saved: Math.max(0, g.saved + deltaByBucket[g.id]) } : g
    )));
  }

  function confirmAllocate() {
    if (!allocateTarget || allocateOverBudget) return;
    const clean = allocateRows
      .filter((r) => r.bucketId && (Math.abs(parseFloat(r.amount)) || 0) > 0)
      .map((r) => ({ id: uid(), bucketId: r.bucketId, amount: Math.abs(parseFloat(r.amount)) || 0 }));

    // New allocations start pending -- require the "Transferred" checkbox,
    // same as the split and quick-category allocation paths, rather than
    // moving the bucket balance the instant this modal is saved. Editing an
    // already-confirmed allocation (e.g. nudging a split between buckets)
    // keeps its confirmed state instead of silently un-confirming a
    // transfer that already really happened.
    const hadAllocations = !!(allocateTarget.savingsAllocations && allocateTarget.savingsAllocations.length);
    const wasApplied = isAllocationApplied(allocateTarget);
    const nowConfirmed = hadAllocations ? wasApplied : false;
    const oldSign = allocationDirection(allocateTarget) === 'withdraw' ? -1 : 1;
    const newSign = allocateDirection === 'withdraw' ? -1 : 1;
    applyAllocationDelta(wasApplied ? allocateTarget.savingsAllocations : [], oldSign, nowConfirmed ? clean : [], newSign);
    updateTransactions(transactions.map((t) => (
      t.id === allocateTarget.id
        ? { ...t, savingsAllocations: clean.length ? clean : undefined, savingsDirection: clean.length ? allocateDirection : undefined, savingsTransferConfirmed: clean.length ? nowConfirmed : undefined }
        : t
    )));
    setAllocateTarget(null);
  }

  function removeAllocation() {
    if (!allocateTarget) return;
    const wasApplied = isAllocationApplied(allocateTarget);
    const oldSign = allocationDirection(allocateTarget) === 'withdraw' ? -1 : 1;
    applyAllocationDelta(wasApplied ? allocateTarget.savingsAllocations : [], oldSign, [], 1);
    updateTransactions(transactions.map((t) => (
      t.id === allocateTarget.id ? { ...t, savingsAllocations: undefined, savingsDirection: undefined, savingsTransferConfirmed: undefined } : t
    )));
    setAllocateTarget(null);
  }

  function bucketName(id) {
    const b = goals.find((g) => g.id === id);
    return b ? b.name : 'Deleted bucket';
  }

  function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const map = detectHeaderMap(results.meta.fields || []);
        const existingSigs = new Set(transactions.map(txSignature));
        const seenInBatch = new Set();
        const rows = results.data
          .map((r) => rowToTransaction(r, map, categoryMemory))
          .filter((t) => t.amount > 0)
          .map((t) => {
            const sig = txSignature(t);
            const isDuplicate = existingSigs.has(sig) || seenInBatch.has(sig);
            seenInBatch.add(sig);
            return { ...t, _duplicate: isDuplicate, _include: !isDuplicate };
          });
        setPreview(rows);
      },
    });
    e.target.value = '';
  }

  function togglePreviewRow(id) {
    setPreview((rows) => rows.map((r) => (r.id === id ? { ...r, _include: !r._include } : r)));
  }

  function confirmImport() {
    if (preview && preview.length) {
      const toImport = preview.filter((t) => t._include).map(({ _memoryMatch, _duplicate, _include, ...t }) => t);
      if (toImport.length) updateTransactions([...toImport, ...transactions]);
    }
    setPreview(null);
    setShowImport(false);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display font-bold text-2xl" style={{ color: COLORS.ink }}>Ledger</h2>
          <p className="font-body text-sm" style={{ color: COLORS.inkSoft }}>
            {bucketFilter ? 'Every transfer tied to this bucket, across all time.' : 'Every dollar in and out, filterable by month.'}
          </p>
        </div>
        {bucketFilter ? (
          <button
            onClick={() => setBucketFilter(null)}
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold font-body"
            style={{ background: COLORS.violetSoft, color: COLORS.violet }}
          >
            <PiggyBank size={14} /> {goals.find((g) => g.id === bucketFilter)?.name || 'Bucket'} <X size={13} />
          </button>
        ) : hasCustomDateRange ? (
          <button
            onClick={() => { setDateFrom(''); setDateTo(''); }}
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold font-body"
            style={{ background: COLORS.violetSoft, color: COLORS.violet }}
          >
            {dateFrom || '\u2026'} &rarr; {dateTo || '\u2026'} <X size={13} />
          </button>
        ) : (
          <MonthNav month={month} setMonth={setMonth} />
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: COLORS.inkSoft }} />
          <TextInput placeholder="Search descriptions..." value={search} onChange={(e) => setSearch(e.target.value)} style={{ paddingLeft: 32 }} />
        </div>
        <Select value={catFilter} onChange={(e) => setCatFilter(e.target.value)} style={{ width: 170 }}>
          <option value="All">All categories</option>
          <optgroup label="Categories">
            {visibleCategories.map((c) => <option key={c} value={c}>{c}</option>)}
          </optgroup>
          {bucketCategoryNames.length > 0 && (
            <optgroup label="Savings buckets">
              {bucketCategoryNames.map((c) => <option key={c} value={c}>{`\uD83D\uDC37 ${c}`}</option>)}
            </optgroup>
          )}
        </Select>
        <Select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)} style={{ width: 150 }}>
          <option value="All">Bank + Card</option>
          <option value="bank">Bank (bills)</option>
          <option value="card">Credit card</option>
        </Select>
        <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} style={{ width: 140 }}>
          <option value="All">Income + Expense</option>
          <option value="income">Income only</option>
          <option value="expense">Expense only</option>
        </Select>
        <GhostButton onClick={() => setShowMoreFilters((v) => !v)}>
          {showMoreFilters ? <ChevronUp size={15} /> : <ChevronDown size={15} />} Amount &amp; date
        </GhostButton>
        <GhostButton onClick={() => setShowSort((v) => !v)}>
          <ArrowUpDown size={15} /> Sort
        </GhostButton>
        <GhostButton
          onClick={() => setGroupTransfers((v) => !v)}
          style={groupTransfers ? { background: COLORS.violet, color: '#fff' } : undefined}
        >
          <Layers size={15} /> Group transfers
        </GhostButton>
        <GhostButton onClick={() => setShowCategoryManager(true)}><Settings2 size={15} /> Categories</GhostButton>
        <GhostButton onClick={() => setShowImport(true)}><Upload size={15} /> Import CSV</GhostButton>
        {orphanedTransactions.length > 0 && (
          <GhostButton onClick={() => setShowOrphanReview(true)} style={{ color: COLORS.coral, background: '#FFE9E9' }}>
            <Trash2 size={15} /> Review {orphanedTransactions.length} leftover
          </GhostButton>
        )}
        <PrimaryButton onClick={() => setShowAdd((v) => !v)}><Plus size={15} /> Add entry</PrimaryButton>
      </div>

      {showMoreFilters && (
        <Card>
          <div className="grid sm:grid-cols-4 gap-3 items-end">
            <div>
              <label className="font-body text-xs font-semibold" style={{ color: COLORS.inkSoft }}>Min amount</label>
              <TextInput type="number" min="0" step="0.01" placeholder="$0.00" value={amountMin} onChange={(e) => setAmountMin(e.target.value)} />
            </div>
            <div>
              <label className="font-body text-xs font-semibold" style={{ color: COLORS.inkSoft }}>Max amount</label>
              <TextInput type="number" min="0" step="0.01" placeholder="No max" value={amountMax} onChange={(e) => setAmountMax(e.target.value)} />
            </div>
            <div>
              <label className="font-body text-xs font-semibold" style={{ color: COLORS.inkSoft }}>From date</label>
              <TextInput type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </div>
            <div>
              <label className="font-body text-xs font-semibold" style={{ color: COLORS.inkSoft }}>To date</label>
              <TextInput type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>
          </div>
          <p className="font-body text-xs mt-2" style={{ color: COLORS.inkSoft }}>
            {hasCustomDateRange
              ? 'A date range is set, so it replaces the month selector above until cleared.'
              : 'Description is filtered by the search box up top; these narrow by amount and date on top of that.'}
          </p>
          {(amountMin || amountMax || dateFrom || dateTo) && (
            <button
              onClick={() => { setAmountMin(''); setAmountMax(''); setDateFrom(''); setDateTo(''); }}
              className="font-body text-xs font-semibold mt-2"
              style={{ color: COLORS.coral }}
            >
              Clear these filters
            </button>
          )}
        </Card>
      )}

      {showSort && (
        <Card>
          <p className="font-body text-xs mb-3" style={{ color: COLORS.inkSoft }}>
            Sort in levels &mdash; ties in the first level break using the second, then the third. Handy for spotting duplicates: try Description, then Date, then Amount.
          </p>
          <div className="space-y-2">
            {sortRules.map((rule, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="font-body text-xs font-semibold flex-shrink-0" style={{ color: COLORS.inkSoft, width: 60 }}>
                  {i === 0 ? 'Sort by' : 'Then by'}
                </span>
                <Select
                  value={rule.field}
                  onChange={(e) => updateSortRule(i, { field: e.target.value })}
                  style={{ flex: 1, maxWidth: 220 }}
                >
                  {(i === 0 ? SORT_FIELDS.filter((f) => f.value !== 'none') : SORT_FIELDS).map((f) => (
                    <option key={f.value} value={f.value}>{f.label}</option>
                  ))}
                </Select>
                {rule.field === 'flag' && (
                  <Select
                    value={rule.flagType || 'any'}
                    onChange={(e) => updateSortRule(i, { flagType: e.target.value })}
                    style={{ flex: 1, maxWidth: 200 }}
                  >
                    {FLAG_TYPES.map((f) => (
                      <option key={f.value} value={f.value}>{f.label}</option>
                    ))}
                  </Select>
                )}
                <button
                  type="button"
                  onClick={() => updateSortRule(i, { dir: rule.dir === 'asc' ? 'desc' : 'asc' })}
                  disabled={rule.field === 'none'}
                  className="inline-flex items-center gap-1 rounded-xl px-3 py-2 text-sm font-semibold font-body disabled:opacity-40"
                  style={{ background: COLORS.violetSoft, color: COLORS.violet }}
                >
                  {rule.dir === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  {rule.dir === 'asc' ? 'Ascending' : 'Descending'}
                </button>
              </div>
            ))}
          </div>
          <button
            onClick={() => setSortRules(DEFAULT_SORT_RULES)}
            className="font-body text-xs font-semibold mt-3"
            style={{ color: COLORS.coral }}
          >
            Reset to default (newest first)
          </button>
        </Card>
      )}

      {selectedIds.size > 0 && (
        <div className="flex items-center justify-between rounded-xl px-4 py-2.5" style={{ background: COLORS.violetSoft }}>
          <span className="font-body text-sm font-semibold" style={{ color: COLORS.violet }}>{selectedIds.size} selected</span>
          <div className="flex items-center gap-2">
            <button onClick={() => setSelectedIds(new Set())} className="font-body text-xs font-semibold" style={{ color: COLORS.inkSoft }}>Clear</button>
            <button
              onClick={() => markSelectedAsTransfer(true)}
              className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold font-body"
              style={{ background: '#fff', color: COLORS.violet }}
            >
              <Repeat size={13} /> Exclude from totals
            </button>
            <button
              onClick={() => markSelectedAsTransfer(false)}
              className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold font-body"
              style={{ background: '#fff', color: COLORS.inkSoft }}
            >
              Include in totals
            </button>
            <button
              onClick={deleteSelected}
              className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold font-body text-white"
              style={{ background: COLORS.coral }}
            >
              <Trash2 size={13} /> Delete selected
            </button>
          </div>
        </div>
      )}

      {showAdd && (
        <Card>
          <div className="grid sm:grid-cols-5 gap-3 items-end">
            <div>
              <label className="font-body text-xs font-semibold" style={{ color: COLORS.inkSoft }}>Date</label>
              <TextInput type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </div>
            <div className="sm:col-span-2">
              <label className="font-body text-xs font-semibold" style={{ color: COLORS.inkSoft }}>Description</label>
              <TextInput placeholder="e.g. Trader Joe's" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            <div>
              <label className="font-body text-xs font-semibold" style={{ color: COLORS.inkSoft }}>Type</label>
              <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                <option value="expense">Expense</option>
                <option value="income">Income</option>
              </Select>
            </div>
            <div>
              <label className="font-body text-xs font-semibold" style={{ color: COLORS.inkSoft }}>Amount</label>
              <TextInput type="number" step="0.01" min="0" placeholder="0.00" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            </div>
            {form.type === 'expense' && (
              <div className="sm:col-span-2">
                <label className="font-body text-xs font-semibold" style={{ color: COLORS.inkSoft }}>Category</label>
                <Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                  {visibleCategories.filter((c) => c !== 'Income').map((c) => <option key={c} value={c}>{c}</option>)}
                </Select>
              </div>
            )}
            <div className="flex gap-2">
              <PrimaryButton onClick={addTransaction}><Check size={15} /> Save</PrimaryButton>
            </div>
          </div>
        </Card>
      )}

      {filtered.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl px-4 py-2.5" style={{ background: COLORS.bg }}>
          <span className="font-body text-xs" style={{ color: COLORS.inkSoft }}>Showing {filtered.length} transaction{filtered.length === 1 ? '' : 's'}:</span>
          {filteredSummary.countedIncome > 0 && (
            <span className="font-body text-xs font-semibold" style={{ color: COLORS.teal }}>+{formatCurrency(filteredSummary.countedIncome)} counted income</span>
          )}
          {filteredSummary.countedExpense > 0 && (
            <span className="font-body text-xs font-semibold" style={{ color: COLORS.coral }}>-{formatCurrency(filteredSummary.countedExpense)} counted expense</span>
          )}
          {filteredSummary.excludedCount > 0 && (
            <span className="font-body text-xs font-semibold" style={{ color: COLORS.gold }}>
              {formatCurrency(filteredSummary.excludedTotal)} excluded ({filteredSummary.excludedCount})
            </span>
          )}
        </div>
      )}

      <Card style={{ padding: 0 }}>
        {filtered.length === 0 ? (
          <EmptyState icon={Receipt} title="No transactions here" subtitle="Add one manually or import a CSV to get started." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm font-body">
              <thead>
                <tr style={{ color: COLORS.inkSoft }} className="text-left border-b" >
                  <th className="pl-4 pr-1 py-2.5" style={{ width: 30 }}>
                    <div
                      onClick={() => {
                        const visibleIds = filtered.map((t) => t.id);
                        const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
                        setSelectedIds(allSelected ? new Set() : new Set(visibleIds));
                      }}
                      className="flex items-center justify-center cursor-pointer"
                      style={{
                        width: 14, height: 14, borderRadius: 4,
                        border: `1.5px solid ${filtered.length > 0 && filtered.every((t) => selectedIds.has(t.id)) ? COLORS.violet : COLORS.border}`,
                        background: filtered.length > 0 && filtered.every((t) => selectedIds.has(t.id)) ? COLORS.violet : 'transparent',
                      }}
                    >
                      {filtered.length > 0 && filtered.every((t) => selectedIds.has(t.id)) && <Check size={10} style={{ color: '#fff' }} strokeWidth={3} />}
                    </div>
                  </th>
                  <th className="px-4 py-2.5 font-semibold text-xs uppercase tracking-wide">Date</th>
                  <th className="px-4 py-2.5 font-semibold text-xs uppercase tracking-wide">Description</th>
                  <th className="px-4 py-2.5 font-semibold text-xs uppercase tracking-wide">Category</th>
                  <th className="px-4 py-2.5 font-semibold text-xs uppercase tracking-wide text-right">Amount</th>
                  <th className="px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {renderItems.map((item) => {
                  if (item.type === 'rollup') {
                    return (
                      <tr key={item.id} className="border-b last:border-0" style={{ borderColor: COLORS.border, background: COLORS.bg }}>
                        <td className="pl-4 pr-1 py-2.5"></td>
                        <td colSpan={4} className="px-4 py-2.5">
                          <button
                            onClick={() => setExpandedRollups((p) => ({ ...p, [item.id]: !p[item.id] }))}
                            className="flex items-center justify-between w-full text-left"
                          >
                            <span className="flex items-center gap-1.5 font-body text-sm font-semibold" style={{ color: COLORS.inkSoft }}>
                              {expandedRollups[item.id] ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                              {item.items.length} transfers this week
                            </span>
                            <span className="font-body text-sm font-semibold" style={{ color: COLORS.gold }}>{formatCurrency(item.total)} excluded</span>
                          </button>
                          {expandedRollups[item.id] && (
                            <div className="mt-2 space-y-1 pl-5">
                              {item.items.map((t) => (
                                <div key={t.id} className="flex items-center justify-between text-xs" style={{ color: COLORS.inkSoft }}>
                                  <span>{t.date} &middot; {t.description}</span>
                                  <span>{formatCurrency(t.amount)}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-2.5"></td>
                      </tr>
                    );
                  }
                  const t = item.t;
                  const hasNote = !!t.note;
                  const hasAllocation = t.savingsAllocations && t.savingsAllocations.length > 0;
                  const hasLink = t.linkedTransferId && transactionsById[t.linkedTransferId];
                  const detailsOpen = expandedDetails[t.id] || expandedNotes[t.id];
                  const hasDetails = hasNote || hasAllocation || hasLink || detailsOpen;
                  return (
                  <React.Fragment key={t.id}>
                    <tr className="border-b last:border-0" style={{ borderColor: COLORS.border }}>
                      <td className="pl-4 pr-1 py-2.5">
                        <div
                          onClick={() => toggleSelected(t.id)}
                          className="flex items-center justify-center cursor-pointer"
                          style={{
                            width: 14, height: 14, borderRadius: 4,
                            border: `1.5px solid ${selectedIds.has(t.id) ? COLORS.violet : COLORS.border}`,
                            background: selectedIds.has(t.id) ? COLORS.violet : 'transparent',
                          }}
                        >
                          {selectedIds.has(t.id) && <Check size={10} style={{ color: '#fff' }} strokeWidth={3} />}
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <input
                          key={`date-${t.id}`}
                          type="date"
                          defaultValue={t.date}
                          onBlur={(e) => {
                            e.target.style.borderColor = 'transparent';
                            e.target.style.background = 'transparent';
                            if (e.target.value) updateDate(t.id, e.target.value);
                          }}
                          onFocus={(e) => { e.target.style.borderColor = COLORS.violet; e.target.style.background = '#fff'; }}
                          onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                          className="font-body text-sm rounded-lg px-1 py-0.5 outline-none"
                          style={{ color: COLORS.inkSoft, border: '1.5px solid transparent', background: 'transparent' }}
                        />
                      </td>
                      <td className="px-4 py-2.5 font-medium" style={{ color: COLORS.ink }}>
                        {t.description}
                        {t.addedAt && lastSyncAt && t.addedAt === lastSyncAt && (
                          <span
                            className="inline-flex items-center justify-center rounded-full ml-1.5"
                            style={{ width: 16, height: 16, background: COLORS.teal }}
                            title="New since your last sync"
                          >
                            <Sparkles size={9} style={{ color: '#fff' }} />
                          </span>
                        )}
                        {t.pendingRemoval && (
                          <span
                            className="inline-flex items-center justify-center rounded-full ml-1.5"
                            style={{ width: 16, height: 16, background: COLORS.gold }}
                            title="Needs review — check the Accounts tab"
                          >
                            <Flame size={9} style={{ color: '#fff' }} />
                          </span>
                        )}
                        {t.pending && (
                          <span
                            className="inline-flex items-center justify-center rounded-full ml-1.5"
                            style={{ width: 16, height: 16, background: COLORS.border }}
                            title="Your bank hasn't fully posted this yet — amount or date may still change"
                          >
                            <Clock size={9} style={{ color: COLORS.inkSoft }} />
                          </span>
                        )}
                        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                          {(() => {
                            const src = paymentSourceFor(t, accountsById);
                            const isCard = src === 'card';
                            const Icon = isCard ? CreditCard : Landmark;
                            const color = isCard ? COLORS.violet : COLORS.gold;
                            return (
                              <button
                                type="button"
                                onClick={() => togglePaymentSource(t.id)}
                                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold font-body"
                                style={{ background: `${color}22`, color }}
                                title={isCard ? 'Charged to credit card — click to mark as bank/bill' : 'Paid from bank — click to mark as credit card'}
                              >
                                <Icon size={11} /> {isCard ? 'Card' : 'Bank'}
                              </button>
                            );
                          })()}
                          <button
                            type="button"
                            onClick={() => toggleExcluded(t.id)}
                            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold font-body"
                            style={t.excludeFromTotals
                              ? { background: COLORS.violetSoft, color: COLORS.violet }
                              : { background: COLORS.bg, color: COLORS.inkSoft }}
                            title="Mark as a transfer (e.g. paying your credit card bill) so it isn't double-counted as spending"
                          >
                            <Repeat size={11} /> {t.excludeFromTotals ? 'Excluded from totals' : 'Exclude from totals'}
                          </button>
                        </div>
                        {hasDetails && (
                          <div className="mt-1">
                            <button
                              onClick={() => setExpandedDetails((p) => ({ ...p, [t.id]: !p[t.id] }))}
                              className="inline-flex items-center gap-1.5 font-body text-xs"
                              style={{ color: COLORS.inkSoft }}
                            >
                              {detailsOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                              {hasNote && <StickyNote size={11} style={{ color: COLORS.violet }} />}
                              {hasAllocation && <PiggyBank size={11} style={{ color: COLORS.teal }} />}
                              {hasLink && <Link2 size={11} style={{ color: COLORS.teal }} />}
                            </button>
                            {detailsOpen && (
                            <div className="mt-1 space-y-1">
                        {expandedNotes[t.id] ? (
                          <input
                            key={`note-${t.id}`}
                            defaultValue={t.note || ''}
                            placeholder="Note (optional)"
                            autoFocus
                            onBlur={(e) => { updateNote(t.id, e.target.value.trim()); setExpandedNotes((p) => ({ ...p, [t.id]: false })); }}
                            onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                            className="font-body text-xs rounded-lg px-1.5 py-0.5 outline-none w-full mt-1"
                            style={{ color: COLORS.ink, border: `1.5px solid ${COLORS.border}`, background: '#fff' }}
                          />
                        ) : t.note && (
                          <p
                            onClick={() => setExpandedNotes((p) => ({ ...p, [t.id]: true }))}
                            className="font-body text-xs mt-1 cursor-pointer"
                            style={{ color: COLORS.inkSoft }}
                            title="Click to edit"
                          >
                            🗒 {t.note}
                          </p>
                        )}
                        {t.savingsAllocations && t.savingsAllocations.length > 0 && (() => {
                          const applied = isAllocationApplied(t);
                          const dir = allocationDirection(t);
                          const label = t.savingsAllocations.length === 1
                            ? `${formatCurrency(t.savingsAllocations[0].amount)} ${dir === 'withdraw' ? '\u2190' : '\u2192'} ${bucketName(t.savingsAllocations[0].bucketId)}`
                            : `${formatCurrency(t.savingsAllocations.reduce((s, a) => s + a.amount, 0))} ${dir === 'withdraw' ? '\u2190' : '\u2192'} ${t.savingsAllocations.length} buckets`;
                          return (
                            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                              <div
                                className="flex items-center gap-1 font-body font-normal text-xs"
                                style={{ color: applied ? (dir === 'withdraw' ? COLORS.coral : COLORS.teal) : COLORS.gold }}
                              >
                                <PiggyBank size={11} />
                                {applied ? label : `Pending \u2014 ${label}`}
                              </div>
                              <div
                                onClick={() => toggleTransferConfirmed(t.id)}
                                className="flex items-center gap-1 cursor-pointer select-none"
                                title="Mark whether the transfer has actually happened"
                              >
                                <span
                                  className="flex items-center justify-center flex-shrink-0"
                                  style={{
                                    width: 12, height: 12, borderRadius: 3,
                                    border: `1.5px solid ${applied ? COLORS.teal : COLORS.border}`,
                                    background: applied ? COLORS.teal : 'transparent',
                                  }}
                                >
                                  {applied && <Check size={8} style={{ color: '#fff' }} strokeWidth={3} />}
                                </span>
                                <span className="font-body text-xs" style={{ color: applied ? COLORS.teal : COLORS.inkSoft }}>
                                  Transferred
                                </span>
                              </div>
                            </div>
                          );
                        })()}
                        {t.linkedTransferId && transactionsById[t.linkedTransferId] && (() => {
                          const linked = transactionsById[t.linkedTransferId];
                          return (
                            <div className="mt-1">
                              <button
                                onClick={() => setExpandedLinks((p) => ({ ...p, [t.id]: !p[t.id] }))}
                                className="inline-flex items-center gap-1 font-body text-xs font-semibold"
                                style={{ color: COLORS.teal }}
                              >
                                {expandedLinks[t.id] ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                                <Link2 size={11} /> Reconciled with bank transfer
                              </button>
                              {expandedLinks[t.id] && (
                                <p className="font-body text-xs mt-0.5 pl-4" style={{ color: COLORS.inkSoft }}>
                                  {linked.date} &middot; {linked.description} &middot; {formatCurrency(linked.amount)}
                                </p>
                              )}
                            </div>
                          );
                        })()}
                            </div>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        {t.splits && t.splits.length ? (
                          <button
                            onClick={() => setExpandedSplits((p) => ({ ...p, [t.id]: !p[t.id] }))}
                            className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold font-body"
                            style={{ background: COLORS.violetSoft, color: COLORS.violet }}
                          >
                            {expandedSplits[t.id] ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                            Split &middot; {t.splits.length}
                          </button>
                        ) : (
                          <CategoryEditCell value={t.category} options={categoryOptionsFor(t.category)} bucketGroups={bucketGroups} onChange={(cat) => updateCategoryOrAllocate(t.id, cat)} />
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {t.splits && t.splits.length ? (
                          <span className="font-semibold text-sm inline-flex items-center gap-0.5" style={{ color: t.type === 'income' ? COLORS.teal : COLORS.coral }}>
                            <button
                              type="button"
                              onClick={() => updateType(t.id)}
                              className="font-semibold text-sm rounded px-0.5"
                              title={t.type === 'income' ? 'Income — click to mark as expense' : 'Expense — click to mark as income'}
                            >
                              {t.type === 'income' ? '+' : '-'}
                            </button>
                            {formatCurrency(t.amount)}
                          </span>
                        ) : (
                          <AmountEditCell value={t.amount} type={t.type} onCommit={(amt) => updateAmount(t.id, amt)} onToggleType={() => updateType(t.id)} />
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <div className="flex items-center justify-end gap-2.5">
                          <button onClick={() => toggleFlag(t.id)} style={{ color: t.flaggedForReview ? COLORS.gold : COLORS.inkSoft }} className="hover:text-amber-600" title={t.flaggedForReview ? 'Flagged for review — click to clear' : 'Flag for your partner to review'}>
                            <Flag size={15} fill={t.flaggedForReview ? COLORS.gold : 'none'} />
                          </button>
                          <button onClick={() => setExpandedNotes((p) => ({ ...p, [t.id]: !p[t.id] }))} style={{ color: t.note ? COLORS.violet : COLORS.inkSoft }} className="hover:text-violet-600" title={t.note ? 'Edit note' : 'Add a note'}>
                            <StickyNote size={15} fill={t.note ? COLORS.violet : 'none'} />
                          </button>
                          <button onClick={() => openAllocateModal(t)} style={{ color: t.savingsAllocations && t.savingsAllocations.length ? (isAllocationApplied(t) ? (allocationDirection(t) === 'withdraw' ? COLORS.coral : COLORS.teal) : COLORS.gold) : COLORS.inkSoft }} className="hover:text-teal-600" title="Choose bucket / allocate to savings">
                            <PiggyBank size={15} fill={t.savingsAllocations && t.savingsAllocations.length ? (isAllocationApplied(t) ? (allocationDirection(t) === 'withdraw' ? COLORS.coral : COLORS.teal) : COLORS.gold) : 'none'} />
                          </button>
                          {!t.excludeFromTotals && t.savingsAllocations && t.savingsAllocations.length > 0 && (
                            <button onClick={() => openLinkModal(t)} style={{ color: t.linkedTransferId ? COLORS.teal : COLORS.inkSoft }} className="hover:text-teal-600" title={t.linkedTransferId ? 'Change linked bank transfer' : 'Link to a real bank transfer'}>
                              <Link2 size={15} />
                            </button>
                          )}
                          <button onClick={() => openSplitModal(t)} style={{ color: t.splits && t.splits.length ? COLORS.violet : COLORS.inkSoft }} className="hover:text-violet-600" title="Split transaction">
                            <Scissors size={15} fill={t.splits && t.splits.length ? COLORS.violet : 'none'} />
                          </button>
                          <button onClick={() => removeTransaction(t.id)} style={{ color: COLORS.inkSoft }} className="hover:text-red-500" title="Delete">
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                    {t.splits && expandedSplits[t.id] && t.splits.map((s) => (
                      <tr key={s.id} className="border-b last:border-0" style={{ borderColor: COLORS.border, background: COLORS.bg }}>
                        <td className="px-4 py-2"></td>
                        <td className="px-4 py-2"></td>
                        <td className="px-4 py-2 pl-8 text-xs" style={{ color: COLORS.inkSoft }}>&#8618; portion</td>
                        <td className="px-4 py-2">
                          <CategoryEditCell value={s.category} options={categoryOptionsFor(s.category)} bucketGroups={bucketGroups} onChange={(cat) => updateSplitCategory(t.id, s.id, cat)} />
                        </td>
                        <td className="px-4 py-2 text-right font-semibold text-sm" style={{ color: t.type === 'income' ? COLORS.teal : COLORS.coral }}>
                          {t.type === 'income' ? '+' : '-'}{formatCurrency(s.amount)}
                        </td>
                        <td className="px-4 py-2"></td>
                      </tr>
                    ))}
                  </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {showImport && (
        <div className="fixed inset-0 flex items-center justify-center p-4 z-50" style={{ background: 'rgba(33,31,61,0.45)' }}>
          <Card style={{ maxWidth: 520, width: '100%', maxHeight: '80vh', overflowY: 'auto' }}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-display font-semibold text-lg" style={{ color: COLORS.ink }}>Import from CSV</h3>
              <button onClick={() => { setShowImport(false); setPreview(null); }} style={{ color: COLORS.inkSoft }}><X size={18} /></button>
            </div>
            {!preview ? (
              <>
                <p className="font-body text-sm mb-3" style={{ color: COLORS.inkSoft }}>
                  Upload a CSV with columns like date, description, amount, and optionally category or type. We'll auto-detect the columns.
                </p>
                <label className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed py-8 cursor-pointer" style={{ borderColor: COLORS.border }}>
                  <Upload size={22} style={{ color: COLORS.violet }} />
                  <span className="font-body text-sm font-semibold mt-2" style={{ color: COLORS.violet }}>Choose a CSV file</span>
                  <input type="file" accept=".csv" onChange={handleFile} className="hidden" />
                </label>
              </>
            ) : (
              <>
                <p className="font-body text-sm mb-2" style={{ color: COLORS.inkSoft }}>
                  Found {preview.length} transaction(s). Review before importing:
                  {preview.some((t) => t._memoryMatch) && (
                    <span style={{ color: COLORS.violet }}> &middot; {preview.filter((t) => t._memoryMatch).length} auto-categorized from memory</span>
                  )}
                  {preview.some((t) => t._duplicate) && (
                    <span style={{ color: COLORS.coral }}> &middot; {preview.filter((t) => t._duplicate).length} possible duplicate(s) unchecked below</span>
                  )}
                </p>
                <div className="max-h-64 overflow-y-auto rounded-xl border mb-3" style={{ borderColor: COLORS.border }}>
                  <table className="w-full text-xs font-body">
                    <tbody>
                      {preview.map((t) => (
                        <tr
                          key={t.id}
                          className="border-b last:border-0"
                          style={{ borderColor: COLORS.border, background: t._duplicate ? '#FFF3F3' : 'transparent', opacity: t._include ? 1 : 0.55 }}
                        >
                          <td className="pl-2 py-1.5" style={{ width: 26 }}>
                            <div
                              onClick={() => togglePreviewRow(t.id)}
                              className="flex items-center justify-center cursor-pointer"
                              style={{
                                width: 14, height: 14, borderRadius: 4,
                                border: `1.5px solid ${t._include ? COLORS.violet : COLORS.border}`,
                                background: t._include ? COLORS.violet : 'transparent',
                              }}
                            >
                              {t._include && <Check size={10} style={{ color: '#fff' }} strokeWidth={3} />}
                            </div>
                          </td>
                          <td className="px-2 py-1.5">{t.date}</td>
                          <td className="px-2 py-1.5">
                            {t.description}
                            {t._duplicate && (
                              <div className="flex items-center gap-1 mt-0.5" style={{ color: COLORS.coral }}>
                                <Flame size={10} />
                                <span className="font-semibold" style={{ fontSize: 10 }}>Possible duplicate</span>
                              </div>
                            )}
                          </td>
                          <td className="px-2 py-1.5">
                            <div className="flex items-center gap-1">
                              <CategoryBadge cat={t.category} />
                              {t._memoryMatch && <Sparkles size={11} style={{ color: COLORS.violet }} title="Auto-categorized from memory" />}
                            </div>
                          </td>
                          <td className="px-2 py-1.5 text-right" style={{ color: t.type === 'income' ? COLORS.teal : COLORS.coral }}>
                            {t.type === 'income' ? '+' : '-'}{formatCurrency(t.amount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex gap-2 justify-end">
                  <GhostButton onClick={() => setPreview(null)}>Back</GhostButton>
                  <PrimaryButton onClick={confirmImport} disabled={preview.filter((t) => t._include).length === 0}>
                    <Check size={15} /> Import {preview.filter((t) => t._include).length} entries
                  </PrimaryButton>
                </div>
              </>
            )}
          </Card>
        </div>
      )}

      {linkTarget && (
        <div className="fixed inset-0 flex items-center justify-center p-4 z-50" style={{ background: 'rgba(33,31,61,0.45)' }}>
          <Card style={{ maxWidth: 440, width: '100%', maxHeight: '85vh', overflowY: 'auto' }}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-display font-semibold text-lg" style={{ color: COLORS.ink }}>Link to a bank transfer</h3>
              <button onClick={() => setLinkTarget(null)} style={{ color: COLORS.inkSoft }}><X size={18} /></button>
            </div>

            <div className="rounded-xl px-3 py-2 mb-3" style={{ background: COLORS.bg }}>
              <p className="font-body font-semibold text-sm" style={{ color: COLORS.ink }}>{linkTarget.description}</p>
              <p className="font-body text-xs" style={{ color: COLORS.inkSoft }}>{linkTarget.date} &middot; {formatCurrency(linkTarget.amount)}</p>
            </div>

            {linkTarget.linkedTransferId && transactionsById[linkTarget.linkedTransferId] && (
              <div className="flex items-center justify-between rounded-xl px-3 py-2 mb-3" style={{ background: COLORS.violetSoft }}>
                <span className="font-body text-xs" style={{ color: COLORS.violet }}>
                  Currently linked: {transactionsById[linkTarget.linkedTransferId].description}
                </span>
                <GhostButton onClick={unlinkTransfer}>Unlink</GhostButton>
              </div>
            )}

            <TextInput placeholder="Search transactions..." value={linkSearch} onChange={(e) => setLinkSearch(e.target.value)} />

            <div className="mt-2 space-y-1 max-h-72 overflow-y-auto">
              {linkCandidates.length === 0 ? (
                <p className="font-body text-xs py-4 text-center" style={{ color: COLORS.inkSoft }}>No matching transfer transactions found this month.</p>
              ) : linkCandidates.map((c) => (
                <button
                  key={c.id}
                  onClick={() => linkTransfer(c.id)}
                  className="w-full flex items-center justify-between rounded-lg px-2.5 py-2 text-left hover:bg-violet-50"
                  style={{ background: c.id === linkTarget.linkedTransferId ? COLORS.violetSoft : 'transparent' }}
                >
                  <span className="font-body text-xs" style={{ color: COLORS.ink }}>{c.date} &middot; {c.description}</span>
                  <span className="font-body text-xs font-semibold" style={{ color: COLORS.inkSoft }}>{formatCurrency(c.amount)}</span>
                </button>
              ))}
            </div>

            <div className="flex justify-end mt-3">
              <GhostButton onClick={() => setLinkTarget(null)}>Close</GhostButton>
            </div>
          </Card>
        </div>
      )}

      {splitTarget && (
        <div className="fixed inset-0 flex items-center justify-center p-4 z-50" style={{ background: 'rgba(33,31,61,0.45)' }}>
          <Card style={{ maxWidth: 480, width: '100%', maxHeight: '85vh', overflowY: 'auto' }}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-display font-semibold text-lg" style={{ color: COLORS.ink }}>Split transaction</h3>
              <button onClick={() => setSplitTarget(null)} style={{ color: COLORS.inkSoft }}><X size={18} /></button>
            </div>

            <div className="rounded-xl px-3 py-2 mb-4" style={{ background: COLORS.bg }}>
              <p className="font-body font-semibold text-sm" style={{ color: COLORS.ink }}>{splitTarget.description}</p>
              <p className="font-body text-xs" style={{ color: COLORS.inkSoft }}>{splitTarget.date} &middot; Total {formatCurrency(splitTarget.amount)}</p>
            </div>

            {splitRows.length === 0 && (
              <p className="font-body text-xs mb-3" style={{ color: COLORS.inkSoft }}>
                Add a split for each category this transaction should be divided into. Whatever's left over automatically goes to the category below.
              </p>
            )}

            <div className="space-y-2 mb-2">
              {splitRows.map((row) => (
                <div key={row.id} className="flex items-center gap-2">
                  <Select value={row.category} onChange={(e) => updateSplitRow(row.id, 'category', e.target.value)} style={{ flex: 1 }}>
                    <optgroup label="Categories">
                      {categoryOptionsFor(row.category).map((c) => <option key={c} value={c}>{c}</option>)}
                    </optgroup>
                    {bucketCategoryNames.length > 0 && (
                      <optgroup label="Savings buckets">
                        {bucketCategoryNames.map((c) => <option key={c} value={c}>{`\uD83D\uDC37 ${c}`}</option>)}
                      </optgroup>
                    )}
                  </Select>
                  <TextInput
                    type="number" min="0" step="0.01" placeholder="0.00"
                    value={row.amount} onChange={(e) => updateSplitRow(row.id, 'amount', e.target.value)}
                    style={{ width: 100 }}
                  />
                  <button onClick={() => removeSplitRow(row.id)} style={{ color: COLORS.inkSoft }} className="hover:text-red-500">
                    <X size={15} />
                  </button>
                </div>
              ))}
            </div>

            <button onClick={addSplitRow} className="font-body text-xs font-semibold mb-4" style={{ color: COLORS.violet }}>
              + Add another split
            </button>

            <div className="flex items-center gap-2 rounded-xl px-3 py-2 mb-1" style={{ background: remaining < 0 ? '#FFE9E9' : COLORS.violetSoft }}>
              <Select value={remainderCategory} onChange={(e) => setRemainderCategory(e.target.value)} style={{ flex: 1 }}>
                <optgroup label="Categories">
                  {categoryOptionsFor(remainderCategory).map((c) => <option key={c} value={c}>{c}</option>)}
                </optgroup>
                {bucketCategoryNames.length > 0 && (
                  <optgroup label="Savings buckets">
                    {bucketCategoryNames.map((c) => <option key={c} value={c}>{`\uD83D\uDC37 ${c}`}</option>)}
                  </optgroup>
                )}
              </Select>
              <span
                className="font-display font-semibold text-sm"
                style={{ color: remaining < 0 ? COLORS.coral : COLORS.violet, minWidth: 90, textAlign: 'right' }}
              >
                {formatCurrency(Math.max(remaining, 0))}
              </span>
            </div>
            <p className="font-body text-xs mb-4" style={{ color: remaining < 0 ? COLORS.coral : COLORS.inkSoft }}>
              {remaining < 0
                ? `You've allocated ${formatCurrency(-remaining)} more than the total.`
                : 'Remaining amount, auto-calculated from the total above.'}
            </p>

            <div className="flex justify-between items-center">
              {splitTarget.splits ? (
                <GhostButton onClick={() => { removeSplit(splitTarget.id); setSplitTarget(null); }}>Remove split</GhostButton>
              ) : <span />}
              <PrimaryButton onClick={confirmSplit} disabled={splitRows.length === 0 || remaining < 0}>
                <Check size={15} /> Save split
              </PrimaryButton>
            </div>
          </Card>
        </div>
      )}

      {allocateTarget && (
        <div className="fixed inset-0 flex items-center justify-center p-4 z-50" style={{ background: 'rgba(33,31,61,0.45)' }}>
          <Card style={{ maxWidth: 460, width: '100%', maxHeight: '85vh', overflowY: 'auto' }}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-display font-semibold text-lg" style={{ color: COLORS.ink }}>Choose bucket</h3>
              <button onClick={() => setAllocateTarget(null)} style={{ color: COLORS.inkSoft }}><X size={18} /></button>
            </div>

            <div className="rounded-xl px-3 py-2 mb-4" style={{ background: COLORS.bg }}>
              <p className="font-body font-semibold text-sm" style={{ color: COLORS.ink }}>{allocateTarget.description}</p>
              <p className="font-body text-xs" style={{ color: COLORS.inkSoft }}>{allocateTarget.date} &middot; Total {formatCurrency(allocateTarget.amount)}</p>
            </div>

            <label className="font-body text-xs font-semibold mb-1.5 block" style={{ color: COLORS.inkSoft }}>Direction</label>
            <div className="flex items-center gap-2 mb-1.5">
              <button
                onClick={() => setAllocateDirection('deposit')}
                className="flex-1 flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold font-body transition-colors"
                style={allocateDirection === 'deposit'
                  ? { background: COLORS.violet, color: '#fff' }
                  : { background: COLORS.violetSoft, color: COLORS.violet }}
              >
                <TrendingUp size={14} /> Deposit
              </button>
              <button
                onClick={() => setAllocateDirection('withdraw')}
                className="flex-1 flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold font-body transition-colors"
                style={allocateDirection === 'withdraw'
                  ? { background: COLORS.coral, color: '#fff' }
                  : { background: '#FFE9E9', color: COLORS.coral }}
              >
                <TrendingDown size={14} /> Withdraw
              </button>
            </div>
            <p className="font-body text-xs mb-4" style={{ color: COLORS.inkSoft }}>
              {allocateDirection === 'withdraw'
                ? 'Amounts below will be subtracted from the buckets (money coming out of savings).'
                : 'Amounts below will be added to the buckets (money going into savings).'}
            </p>

            {goals.length === 0 && allocateRows.length === 0 ? (
              <p className="font-body text-xs mb-3" style={{ color: COLORS.inkSoft }}>
                You don't have any savings buckets yet. Create one below to get started.
              </p>
            ) : (
              <div className="space-y-2 mb-2">
                {allocateRows.map((row) => (
                  <div key={row.id} className="flex items-center gap-2">
                    <Select value={row.bucketId} onChange={(e) => updateAllocateRow(row.id, 'bucketId', e.target.value)} style={{ flex: 1 }}>
                      {savingsAccountsList.map((a) => {
                        const acctGoals = goals.filter((g) => g.accountId === a.id);
                        if (!acctGoals.length) return null;
                        return (
                          <optgroup key={a.id} label={`${a.name}${a.mask ? ` ••${a.mask}` : ''}`}>
                            {acctGoals.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                          </optgroup>
                        );
                      })}
                      {(() => {
                        const linkedIds = new Set(savingsAccountsList.map((a) => a.id));
                        const unlinked = goals.filter((g) => !g.accountId || !linkedIds.has(g.accountId));
                        if (!unlinked.length) return null;
                        return (
                          <optgroup label="Not linked to an account">
                            {unlinked.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                          </optgroup>
                        );
                      })()}
                    </Select>
                    <TextInput
                      type="number" min="0" step="0.01" placeholder="0.00"
                      value={row.amount} onChange={(e) => updateAllocateRow(row.id, 'amount', e.target.value)}
                      style={{ width: 100 }}
                    />
                    <button onClick={() => removeAllocateRow(row.id)} style={{ color: COLORS.inkSoft }} className="hover:text-red-500">
                      <X size={15} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {goals.length > 0 && (
              <button onClick={addAllocateRow} className="font-body text-xs font-semibold mb-4" style={{ color: COLORS.violet }}>
                + Add another bucket
              </button>
            )}

            <div className="flex items-center gap-2 mb-1">
              <TextInput
                placeholder="New bucket name"
                value={newBucketName}
                onChange={(e) => setNewBucketName(e.target.value)}
                style={{ flex: 1 }}
              />
              <GhostButton onClick={createBucketInline}><Plus size={14} /> Create</GhostButton>
            </div>

            <p className="font-body text-xs mt-3 mb-4" style={{ color: allocateOverBudget ? COLORS.coral : COLORS.inkSoft }}>
              {allocateOverBudget
                ? `You've allocated ${formatCurrency(allocatedSum)}, more than the ${formatCurrency(allocateTarget.amount)} transaction.`
                : `Allocated ${formatCurrency(allocatedSum)} of ${formatCurrency(allocateTarget.amount)}. Doesn't need to add up to the full amount.`}
            </p>

            <div className="flex justify-between items-center">
              {allocateTarget.savingsAllocations ? (
                <GhostButton onClick={removeAllocation}>Remove allocation</GhostButton>
              ) : <span />}
              <PrimaryButton onClick={confirmAllocate} disabled={allocateOverBudget}>
                <Check size={15} /> Save allocation
              </PrimaryButton>
            </div>
          </Card>
        </div>
      )}

      {showOrphanReview && (
        <div className="fixed inset-0 flex items-center justify-center p-4 z-50" style={{ background: 'rgba(33,31,61,0.45)' }}>
          <Card style={{ maxWidth: 560, width: '100%', maxHeight: '85vh', overflowY: 'auto' }}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-display font-semibold text-lg" style={{ color: COLORS.ink }}>Review leftover transactions</h3>
              <button onClick={() => setShowOrphanReview(false)} style={{ color: COLORS.inkSoft }}><X size={18} /></button>
            </div>
            <p className="font-body text-xs mb-3" style={{ color: COLORS.inkSoft }}>
              These are tied to a bank account that's no longer connected. That's expected for an old sandbox test bank &mdash; but if you disconnected and reconnected a <em>real</em> bank, these could be genuine history (paychecks, mortgage payments, etc.) that Plaid's new connection hasn't re-supplied yet. Nothing is deleted until you select transactions below and confirm.
            </p>
            <div className="rounded-xl border mb-3" style={{ borderColor: COLORS.border, maxHeight: 320, overflowY: 'auto' }}>
              <table className="w-full text-xs font-body">
                <thead>
                  <tr className="text-left border-b" style={{ borderColor: COLORS.border, color: COLORS.inkSoft }}>
                    <th className="pl-3 pr-1 py-2" style={{ width: 24 }}>
                      <div
                        onClick={() => {
                          const allIds = orphanedTransactions.map((t) => t.id);
                          const allSelected = allIds.every((id) => orphanSelected.has(id));
                          setOrphanSelected(allSelected ? new Set() : new Set(allIds));
                        }}
                        className="flex items-center justify-center cursor-pointer"
                        style={{
                          width: 13, height: 13, borderRadius: 3,
                          border: `1.5px solid ${orphanedTransactions.length > 0 && orphanedTransactions.every((t) => orphanSelected.has(t.id)) ? COLORS.violet : COLORS.border}`,
                          background: orphanedTransactions.length > 0 && orphanedTransactions.every((t) => orphanSelected.has(t.id)) ? COLORS.violet : 'transparent',
                        }}
                      >
                        {orphanedTransactions.length > 0 && orphanedTransactions.every((t) => orphanSelected.has(t.id)) && <Check size={9} style={{ color: '#fff' }} strokeWidth={3} />}
                      </div>
                    </th>
                    <th className="px-2 py-2">Date</th>
                    <th className="px-2 py-2">Description</th>
                    <th className="px-2 py-2 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {orphanedTransactions.map((t) => (
                    <tr key={t.id} className="border-b last:border-0" style={{ borderColor: COLORS.border }}>
                      <td className="pl-3 pr-1 py-1.5">
                        <div
                          onClick={() => toggleOrphanSelected(t.id)}
                          className="flex items-center justify-center cursor-pointer"
                          style={{
                            width: 13, height: 13, borderRadius: 3,
                            border: `1.5px solid ${orphanSelected.has(t.id) ? COLORS.violet : COLORS.border}`,
                            background: orphanSelected.has(t.id) ? COLORS.violet : 'transparent',
                          }}
                        >
                          {orphanSelected.has(t.id) && <Check size={9} style={{ color: '#fff' }} strokeWidth={3} />}
                        </div>
                      </td>
                      <td className="px-2 py-1.5" style={{ color: COLORS.inkSoft }}>{t.date}</td>
                      <td className="px-2 py-1.5" style={{ color: COLORS.ink }}>{t.description}</td>
                      <td className="px-2 py-1.5 text-right" style={{ color: t.type === 'income' ? COLORS.teal : COLORS.coral }}>
                        {t.type === 'income' ? '+' : '-'}{formatCurrency(t.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-between items-center">
              <span className="font-body text-xs" style={{ color: COLORS.inkSoft }}>{orphanSelected.size} selected</span>
              <div className="flex gap-2">
                <GhostButton onClick={() => setShowOrphanReview(false)}>Close</GhostButton>
                <button
                  onClick={deleteSelectedOrphans}
                  disabled={orphanSelected.size === 0}
                  className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold font-body text-white disabled:opacity-50"
                  style={{ background: COLORS.coral }}
                >
                  <Trash2 size={15} /> Delete selected
                </button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {showCategoryManager && (
        <div className="fixed inset-0 flex items-center justify-center p-4 z-50" style={{ background: 'rgba(33,31,61,0.45)' }}>
          <Card style={{ maxWidth: 420, width: '100%', maxHeight: '80vh', overflowY: 'auto' }}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-display font-semibold text-lg" style={{ color: COLORS.ink }}>Manage categories</h3>
              <button onClick={() => setShowCategoryManager(false)} style={{ color: COLORS.inkSoft }}><X size={18} /></button>
            </div>
            <p className="font-body text-xs mb-3" style={{ color: COLORS.inkSoft }}>
              Hide categories you don't use to declutter the dropdowns. Nothing is deleted — existing transactions keep their category, and you can bring one back anytime.
            </p>

            <CategoryManager
              budgets={budgets}
              transactions={transactions}
              goals={goals}
              hiddenCategories={hiddenCategories}
              updateHiddenCategories={updateHiddenCategories}
              renameCategory={renameCategory}
              categoryColors={categoryColors}
              updateCategoryColors={updateCategoryColors}
            />
          </Card>
        </div>
      )}
    </div>
  );
}

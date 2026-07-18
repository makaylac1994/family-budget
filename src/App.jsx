import React, { useState, useEffect, useMemo } from 'react';
import Papa from 'papaparse';
import { db } from './firebase';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend } from 'recharts';
import {
  Wallet, Receipt, PiggyBank, Target, CalendarClock, Upload, Plus, Trash2,
  Search, ChevronLeft, ChevronRight, ChevronDown, TrendingUp, TrendingDown, X, Check,
  Loader2, Sparkles, Flame, Scissors, Palette, Settings2, Coins,
} from 'lucide-react';

/* ---------------------------------- tokens ---------------------------------- */

const COLORS = {
  bg: '#F5F3FF',
  surface: '#FFFFFF',
  ink: '#211F3D',
  inkSoft: '#6E6B92',
  border: '#E7E3FB',
  teal: '#219E8B',
  coral: '#FF6B6B',
  gold: '#FFB627',
  violet: '#7C5CFC',
  violetSoft: '#EFE9FF',
};

const CATEGORY_COLORS = {
  Housing: '#7C5CFC',
  Groceries: '#219E8B',
  Transportation: '#3FA7D6',
  Utilities: '#FFB627',
  Entertainment: '#FF6B6B',
  'Dining Out': '#F15BB5',
  Health: '#2EC4B6',
  Shopping: '#F3722C',
  Savings: '#577590',
  Other: '#9C89B8',
  Income: '#219E8B',
};

const DEFAULT_EXPENSE_CATEGORIES = [
  'Housing', 'Groceries', 'Transportation', 'Utilities',
  'Entertainment', 'Dining Out', 'Health', 'Shopping', 'Other',
];

const PRESET_SWATCHES = [
  '#7C5CFC', '#219E8B', '#3FA7D6', '#FFB627', '#FF6B6B',
  '#F15BB5', '#2EC4B6', '#F3722C', '#577590', '#9C89B8',
  '#E63946', '#06A77D',
];

const CategoryColorContext = React.createContext({});

/* ---------------------------------- helpers ---------------------------------- */

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function formatCurrency(n) {
  const num = Number(n) || 0;
  return num.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function currentMonthStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(monthStr) {
  const [y, m] = monthStr.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function shiftMonth(monthStr, delta) {
  const [y, m] = monthStr.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function categoryColor(cat, overrides) {
  return (overrides && overrides[cat]) || CATEGORY_COLORS[cat] || COLORS.violet;
}

function useCategoryColor(cat) {
  const overrides = React.useContext(CategoryColorContext);
  return categoryColor(cat, overrides);
}

function normalizeDate(raw) {
  if (!raw) return todayStr();
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  return todayStr();
}

function normalizeDescription(desc) {
  return String(desc || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\d+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function merchantToken(desc) {
  const parts = normalizeDescription(desc).split(' ').filter(Boolean);
  return parts.length ? parts[0] : '';
}

function txSignature(t) {
  return `${t.date}|${Math.round(t.amount * 100)}|${t.type}|${normalizeDescription(t.description)}`;
}

function detectHeaderMap(fields) {
  const map = {};
  fields.forEach((f) => {
    const key = f.toLowerCase().trim();
    if (!map.date && /date/.test(key)) map.date = f;
    if (!map.description && /(desc|memo|payee)/.test(key) && !/member/.test(key)) map.description = f;
    if (!map.description && /name/.test(key) && !/member/.test(key)) map.description = f;
    if (!map.amount && /(amount|amt)/.test(key)) map.amount = f;
    if (!map.debit && /debit/.test(key)) map.debit = f;
    if (!map.credit && /credit/.test(key)) map.credit = f;
    if (!map.category && /categor/.test(key)) map.category = f;
    if (!map.type && /type/.test(key)) map.type = f;
    if (!map.member && /member/.test(key)) map.member = f;
  });
  return map;
}

function rowToTransaction(row, map, memory) {
  const date = normalizeDate(map.date ? row[map.date] : '');

  let description = map.description ? String(row[map.description] || '').trim() : '';
  if (map.member && row[map.member]) {
    const member = String(row[map.member]).trim();
    if (member) description = description ? `${description} (${member})` : member;
  }
  if (!description) description = 'Imported transaction';

  let amount = 0;
  let type = 'expense';

  if (map.amount) {
    // Single signed-amount column (e.g. "-1750.00" = expense, "32.00" = income)
    amount = parseFloat(String(row[map.amount]).replace(/[^0-9.\-]/g, ''));
    if (Number.isNaN(amount)) amount = 0;
    type = amount < 0 ? 'expense' : 'income';
  } else if (map.debit || map.credit) {
    // Separate Debit/Credit columns (only one is populated per row)
    const debit = map.debit ? parseFloat(String(row[map.debit]).replace(/[^0-9.\-]/g, '')) : 0;
    const credit = map.credit ? parseFloat(String(row[map.credit]).replace(/[^0-9.\-]/g, '')) : 0;
    if (!Number.isNaN(debit) && debit > 0) {
      amount = debit; type = 'expense';
    } else if (!Number.isNaN(credit) && credit > 0) {
      amount = credit; type = 'income';
    }
  } else if (map.type && row[map.type]) {
    type = /income|credit|deposit/i.test(String(row[map.type])) ? 'income' : 'expense';
  }

  amount = Math.abs(amount) || 0;

  let category = map.category && row[map.category]
    ? String(row[map.category]).trim()
    : (type === 'income' ? 'Income' : 'Other');

  let memoryMatch = false;
  if (memory) {
    const exactKey = normalizeDescription(description);
    const token = merchantToken(description);
    if (exactKey && memory.exact && memory.exact[exactKey]) {
      category = memory.exact[exactKey];
      memoryMatch = true;
    } else if (token && memory.merchant && memory.merchant[token]) {
      category = memory.merchant[token];
      memoryMatch = true;
    }
  }

  return { id: uid(), date, description, category, amount, type, _memoryMatch: memoryMatch };
}

/* ---------------------------------- household gate ---------------------------------- */

function HouseholdGate({ onSubmit }) {
  const [code, setCode] = useState('');
  return (
    <div className="min-h-screen flex items-center justify-center px-5" style={{ background: COLORS.bg }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fredoka:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap');
        .font-display { font-family: 'Fredoka', sans-serif; }
        .font-body { font-family: 'Inter', sans-serif; }
      `}</style>
      <div className="rounded-2xl p-6 w-full" style={{ maxWidth: 380, background: COLORS.surface, border: `1px solid ${COLORS.border}`, boxShadow: '0 2px 10px rgba(124,92,252,0.06)' }}>
        <div className="flex items-center gap-2 mb-1">
          <span style={{ fontSize: 26 }}>🫙</span>
          <h1 className="font-display font-bold text-2xl" style={{ color: COLORS.ink }}>Family Budget</h1>
        </div>
        <p className="font-body text-sm mb-4" style={{ color: COLORS.inkSoft }}>
          Enter your household code. Make one up if this is your first time, then share it with anyone else who should see this data &mdash; everyone using the same code sees the same budget, live.
        </p>
        <TextInput
          placeholder="e.g. smith-family-2026"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && code.trim()) onSubmit(code.trim()); }}
        />
        <div className="mt-3">
          <PrimaryButton onClick={() => code.trim() && onSubmit(code.trim())} style={{ width: '100%', justifyContent: 'center' }}>
            <Check size={15} /> Continue
          </PrimaryButton>
        </div>
        <p className="font-body text-xs mt-3" style={{ color: COLORS.inkSoft }}>
          Anyone who knows this code can view and edit this budget, so pick something specific to your family rather than a common word.
        </p>
      </div>
    </div>
  );
}

/* ---------------------------------- small UI ---------------------------------- */

function JarBar({ pct, height = 14 }) {
  const width = Math.min(Math.max(pct, 0), 100);
  let color = COLORS.teal;
  if (pct >= 100) color = COLORS.coral;
  else if (pct >= 75) color = COLORS.gold;
  return (
    <div style={{ background: '#EEEBFA', borderRadius: 999, height, position: 'relative', overflow: 'hidden' }}>
      <div style={{
        width: `${width}%`, height: '100%', borderRadius: 999,
        background: `linear-gradient(90deg, ${color}AA, ${color})`,
        transition: 'width 0.5s ease',
      }} />
      {pct >= 100 && (
        <Flame size={12} style={{ position: 'absolute', right: 4, top: height / 2 - 6, color: '#fff' }} />
      )}
    </div>
  );
}

function Card({ children, style, className = '' }) {
  return (
    <div
      className={`rounded-2xl p-5 ${className}`}
      style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, boxShadow: '0 2px 10px rgba(124,92,252,0.06)', ...style }}
    >
      {children}
    </div>
  );
}

function CategoryBadge({ cat }) {
  const c = useCategoryColor(cat);
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold font-body"
      style={{ background: `${c}22`, color: c }}
    >
      {cat}
    </span>
  );
}

function CategoryEditCell({ value, options, bucketOptions, onChange }) {
  const color = useCategoryColor(value);
  return (
    <div className="relative inline-block">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none rounded-full pl-2.5 pr-6 py-1 text-xs font-semibold font-body outline-none cursor-pointer"
        style={{ background: `${color}22`, color, border: 'none' }}
      >
        {bucketOptions && bucketOptions.length > 0 ? (
          <>
            <optgroup label="Categories">
              {options.map((c) => <option key={c} value={c} style={{ color: COLORS.ink, background: '#fff' }}>{c}</option>)}
            </optgroup>
            <optgroup label="Savings buckets">
              {bucketOptions.map((c) => <option key={c} value={c} style={{ color: COLORS.ink, background: '#fff' }}>{`\uD83D\uDC37 ${c}`}</option>)}
            </optgroup>
          </>
        ) : (
          options.map((c) => <option key={c} value={c} style={{ color: COLORS.ink, background: '#fff' }}>{c}</option>)
        )}
      </select>
      <ChevronDown size={11} className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2" style={{ color }} />
    </div>
  );
}

function CategoryColorPicker({ current, onChange }) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {PRESET_SWATCHES.map((c) => (
        <button
          key={c}
          onClick={() => onChange(c)}
          title={c}
          className="rounded-full flex-shrink-0"
          style={{
            width: 18, height: 18, background: c,
            boxShadow: current.toLowerCase() === c.toLowerCase() ? `0 0 0 2px #fff, 0 0 0 3.5px ${COLORS.ink}` : 'none',
          }}
        />
      ))}
      <label
        className="relative rounded-full flex-shrink-0 flex items-center justify-center cursor-pointer overflow-hidden"
        style={{ width: 18, height: 18, border: `1.5px dashed ${COLORS.inkSoft}` }}
        title="Custom color"
      >
        <Palette size={10} style={{ color: COLORS.inkSoft, pointerEvents: 'none' }} />
        <input
          type="color"
          value={current}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 opacity-0 cursor-pointer"
        />
      </label>
    </div>
  );
}

function AmountEditCell({ value, type, onCommit, onToggleType }) {
  const [text, setText] = useState(String(value));
  useEffect(() => { setText(String(value)); }, [value]);
  const color = type === 'income' ? COLORS.teal : COLORS.coral;

  function commit() {
    const num = Math.abs(parseFloat(text)) || 0;
    setText(String(num));
    if (num !== value) onCommit(num);
  }

  return (
    <div className="flex items-center justify-end gap-1">
      <button
        type="button"
        onClick={onToggleType}
        className="font-semibold text-sm rounded px-0.5"
        style={{ color }}
        title={type === 'income' ? 'Income — click to mark as expense' : 'Expense — click to mark as income'}
      >
        {type === 'income' ? '+' : '-'}$
      </button>
      <input
        type="number"
        min="0"
        step="0.01"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
        className="w-20 text-right font-semibold text-sm rounded-lg px-1.5 py-1 outline-none"
        style={{ border: `1.5px solid ${COLORS.border}`, color, background: '#fff' }}
        onFocus={(e) => { e.target.style.borderColor = color; }}
      />
    </div>
  );
}

function EmptyState({ icon: Icon, title, subtitle }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-14 px-6">
      <div className="rounded-full p-4 mb-3" style={{ background: COLORS.violetSoft }}>
        <Icon size={28} style={{ color: COLORS.violet }} />
      </div>
      <p className="font-display font-semibold text-lg" style={{ color: COLORS.ink }}>{title}</p>
      <p className="font-body text-sm mt-1 max-w-xs" style={{ color: COLORS.inkSoft }}>{subtitle}</p>
    </div>
  );
}

function TextInput(props) {
  return (
    <input
      {...props}
      className={`w-full rounded-xl px-3 py-2 text-sm font-body outline-none focus:ring-2 ${props.className || ''}`}
      style={{ border: `1.5px solid ${COLORS.border}`, color: COLORS.ink, ...props.style }}
      onFocus={(e) => { e.target.style.borderColor = COLORS.violet; props.onFocus && props.onFocus(e); }}
      onBlur={(e) => { e.target.style.borderColor = COLORS.border; props.onBlur && props.onBlur(e); }}
    />
  );
}

function Select(props) {
  return (
    <select
      {...props}
      className={`w-full rounded-xl px-3 py-2 text-sm font-body outline-none ${props.className || ''}`}
      style={{ border: `1.5px solid ${COLORS.border}`, color: COLORS.ink, background: '#fff', ...props.style }}
    >
      {props.children}
    </select>
  );
}

function PrimaryButton({ children, onClick, style, type = 'button', disabled }) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold font-body text-white transition-transform active:scale-95 disabled:opacity-50"
      style={{ background: `linear-gradient(135deg, ${COLORS.violet}, #6446E0)`, boxShadow: '0 3px 10px rgba(124,92,252,0.35)', ...style }}
    >
      {children}
    </button>
  );
}

function GhostButton({ children, onClick, style }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold font-body transition-colors"
      style={{ color: COLORS.violet, background: COLORS.violetSoft, ...style }}
    >
      {children}
    </button>
  );
}

/* ---------------------------------- month nav ---------------------------------- */

function MonthNav({ month, setMonth }) {
  return (
    <div className="flex items-center gap-2">
      <button onClick={() => setMonth(shiftMonth(month, -1))} className="rounded-full p-1.5 hover:bg-white/60" style={{ color: COLORS.inkSoft }}>
        <ChevronLeft size={18} />
      </button>
      <span className="font-display font-semibold text-sm sm:text-base" style={{ color: COLORS.ink, minWidth: 130, textAlign: 'center' }}>
        {monthLabel(month)}
      </span>
      <button onClick={() => setMonth(shiftMonth(month, 1))} className="rounded-full p-1.5 hover:bg-white/60" style={{ color: COLORS.inkSoft }}>
        <ChevronRight size={18} />
      </button>
    </div>
  );
}

/* ---------------------------------- Dashboard ---------------------------------- */

function DashboardView({ transactions, budgets, bills, goals, month, setMonth, setTab }) {
  const categoryColors = React.useContext(CategoryColorContext);
  const [hiddenChartCats, setHiddenChartCats] = useState([]);
  const [showChartFilter, setShowChartFilter] = useState(false);
  const bucketNameSet = useMemo(() => new Set(goals.map((g) => g.name)), [goals]);
  const monthTx = useMemo(() => transactions.filter((t) => t.date.startsWith(month)), [transactions, month]);
  const income = monthTx.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const expense = monthTx.filter((t) => t.type === 'expense').reduce((s, t) => {
    if (t.splits && t.splits.length) {
      return s + t.splits.reduce((sum, sp) => sum + (bucketNameSet.has(sp.category) ? 0 : sp.amount), 0);
    }
    return s + (bucketNameSet.has(t.category) ? 0 : t.amount);
  }, 0);
  const net = income - expense;
  const totalSaved = goals.reduce((s, g) => s + (g.saved || 0), 0);
  const plannedBudgetTotal = Object.values(budgets).reduce((s, limit) => s + (Number(limit) || 0), 0);
  const plannedBillsTotal = bills.reduce((s, b) => s + (Number(b.amount) || 0), 0);

  const byCategory = {};
  monthTx.filter((t) => t.type === 'expense').forEach((t) => {
    if (t.splits && t.splits.length) {
      t.splits.forEach((s) => {
        if (bucketNameSet.has(s.category)) return;
        byCategory[s.category] = (byCategory[s.category] || 0) + s.amount;
      });
    } else if (!bucketNameSet.has(t.category)) {
      byCategory[t.category] = (byCategory[t.category] || 0) + t.amount;
    }
  });
  const pieData = Object.entries(byCategory).map(([name, value]) => ({ name, value }));
  const visiblePieData = pieData.filter((d) => !hiddenChartCats.includes(d.name));

  function toggleChartCat(cat) {
    setHiddenChartCats((prev) => (prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]));
  }

  const budgetRows = Object.entries(budgets).map(([cat, limit]) => ({
    cat, limit, spent: byCategory[cat] || 0,
  })).sort((a, b) => (b.spent / (b.limit || 1)) - (a.spent / (a.limit || 1))).slice(0, 4);

  const unpaidBills = bills
    .filter((b) => !(b.paidMonths || []).includes(month))
    .sort((a, b) => a.dueDay - b.dueDay);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display font-bold text-2xl" style={{ color: COLORS.ink }}>How this month's looking</h2>
          <p className="font-body text-sm" style={{ color: COLORS.inkSoft }}>A snapshot of where things stand.</p>
        </div>
        <MonthNav month={month} setMonth={setMonth} />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
        <Card>
          <div className="flex items-center gap-2 mb-1" style={{ color: COLORS.teal }}>
            <TrendingUp size={16} /><span className="font-body text-xs font-semibold uppercase tracking-wide">Income</span>
          </div>
          <p className="font-display font-bold text-xl" style={{ color: COLORS.ink }}>{formatCurrency(income)}</p>
        </Card>
        <Card>
          <div className="flex items-center gap-2 mb-1" style={{ color: COLORS.coral }}>
            <TrendingDown size={16} /><span className="font-body text-xs font-semibold uppercase tracking-wide">Expenses</span>
          </div>
          <p className="font-display font-bold text-xl" style={{ color: COLORS.ink }}>{formatCurrency(expense)}</p>
        </Card>
        <Card>
          <div className="flex items-center gap-2 mb-1" style={{ color: net >= 0 ? COLORS.violet : COLORS.coral }}>
            <Wallet size={16} /><span className="font-body text-xs font-semibold uppercase tracking-wide">Net</span>
          </div>
          <p className="font-display font-bold text-xl" style={{ color: COLORS.ink }}>{formatCurrency(net)}</p>
        </Card>
        <Card>
          <div className="flex items-center gap-2 mb-1" style={{ color: COLORS.gold }}>
            <PiggyBank size={16} /><span className="font-body text-xs font-semibold uppercase tracking-wide">Total saved</span>
          </div>
          <p className="font-display font-bold text-xl" style={{ color: COLORS.ink }}>{formatCurrency(totalSaved)}</p>
        </Card>
        <Card>
          <div className="flex items-center gap-2 mb-1" style={{ color: COLORS.violet }}>
            <Target size={16} /><span className="font-body text-xs font-semibold uppercase tracking-wide">Planned budget</span>
          </div>
          <p className="font-display font-bold text-xl" style={{ color: COLORS.ink }}>{formatCurrency(plannedBudgetTotal)}</p>
        </Card>
        <Card>
          <div className="flex items-center gap-2 mb-1" style={{ color: COLORS.gold }}>
            <CalendarClock size={16} /><span className="font-body text-xs font-semibold uppercase tracking-wide">Planned bills</span>
          </div>
          <p className="font-display font-bold text-xl" style={{ color: COLORS.ink }}>{formatCurrency(plannedBillsTotal)}</p>
        </Card>
      </div>

      <div className="grid lg:grid-cols-5 gap-5">
        <Card className="lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-display font-semibold" style={{ color: COLORS.ink }}>Spending by category</h3>
            {pieData.length > 0 && (
              <div className="relative">
                <button
                  onClick={() => setShowChartFilter((v) => !v)}
                  className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold font-body"
                  style={{ background: hiddenChartCats.length > 0 ? COLORS.violetSoft : COLORS.bg, color: hiddenChartCats.length > 0 ? COLORS.violet : COLORS.inkSoft }}
                >
                  <Settings2 size={12} />
                  {hiddenChartCats.length > 0 ? `${pieData.length - hiddenChartCats.length}/${pieData.length}` : 'Filter'}
                  <ChevronDown size={12} />
                </button>
                {showChartFilter && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setShowChartFilter(false)} />
                    <div
                      className="absolute right-0 mt-1.5 rounded-xl p-1.5 z-20"
                      style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, boxShadow: '0 8px 24px rgba(33,31,61,0.15)', width: 190, maxHeight: 240, overflowY: 'auto' }}
                    >
                      {pieData.map((entry) => {
                        const hidden = hiddenChartCats.includes(entry.name);
                        const c = categoryColor(entry.name, categoryColors);
                        return (
                          <div
                            key={entry.name}
                            onClick={() => toggleChartCat(entry.name)}
                            className="flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer font-body text-xs select-none"
                            style={{ color: hidden ? COLORS.inkSoft : COLORS.ink }}
                          >
                            <span
                              className="flex items-center justify-center flex-shrink-0"
                              style={{
                                width: 14, height: 14, borderRadius: 4,
                                border: `1.5px solid ${hidden ? COLORS.border : c}`,
                                background: hidden ? 'transparent' : c,
                              }}
                            >
                              {!hidden && <Check size={10} style={{ color: '#fff' }} strokeWidth={3} />}
                            </span>
                            <span style={{ width: 7, height: 7, borderRadius: 999, background: hidden ? COLORS.inkSoft : c, display: 'inline-block', flexShrink: 0 }} />
                            <span className="truncate">{entry.name}</span>
                          </div>
                        );
                      })}
                      {hiddenChartCats.length > 0 && (
                        <button
                          onClick={() => setHiddenChartCats([])}
                          className="w-full text-left font-body text-xs font-semibold px-2 py-1.5 mt-0.5 rounded-lg"
                          style={{ color: COLORS.violet }}
                        >
                          Show all
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
          {pieData.length === 0 ? (
            <EmptyState icon={Receipt} title="Nothing logged yet" subtitle="Add a transaction to see the breakdown here." />
          ) : visiblePieData.length === 0 ? (
            <div style={{ width: '100%', height: 220 }} className="flex items-center justify-center">
              <p className="font-body text-xs text-center max-w-[160px]" style={{ color: COLORS.inkSoft }}>
                Every category is hidden &mdash; open the filter to show one again.
              </p>
            </div>
          ) : (
            <div style={{ width: '100%', height: 220 }}>
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={visiblePieData} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={3}>
                    {visiblePieData.map((entry, i) => <Cell key={i} fill={categoryColor(entry.name, categoryColors)} />)}
                  </Pie>
                  <Tooltip formatter={(v) => formatCurrency(v)} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card className="lg:col-span-3">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-display font-semibold" style={{ color: COLORS.ink }}>Budget check-in</h3>
            <button onClick={() => setTab('budgets')} className="font-body text-xs font-semibold" style={{ color: COLORS.violet }}>Manage &rarr;</button>
          </div>
          {budgetRows.length === 0 ? (
            <EmptyState icon={PiggyBank} title="No budgets set" subtitle="Set monthly limits per category to track progress." />
          ) : (
            <div className="space-y-3">
              {budgetRows.map((r) => (
                <div key={r.cat}>
                  <div className="flex justify-between text-sm font-body mb-1">
                    <CategoryBadge cat={r.cat} />
                    <span style={{ color: COLORS.inkSoft }}>{formatCurrency(r.spent)} / {formatCurrency(r.limit)}</span>
                  </div>
                  <JarBar pct={r.limit ? (r.spent / r.limit) * 100 : 0} />
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-display font-semibold" style={{ color: COLORS.ink }}>Savings buckets</h3>
          <button onClick={() => setTab('savings')} className="font-body text-xs font-semibold" style={{ color: COLORS.violet }}>Manage &rarr;</button>
        </div>
        {goals.length === 0 ? (
          <EmptyState icon={Coins} title="No savings buckets yet" subtitle="Create one on the Savings tab to see it charted here." />
        ) : (
          <div style={{ width: '100%', height: 240 }}>
            <ResponsiveContainer>
              <BarChart data={goals.map((g) => ({ name: g.name, saved: g.saved || 0, target: g.target || 0 }))} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: COLORS.inkSoft }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: COLORS.inkSoft }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${v}`} width={55} />
                <Tooltip formatter={(v) => formatCurrency(v)} />
                <Legend wrapperStyle={{ fontSize: 12, fontFamily: 'Inter, sans-serif' }} />
                <Bar dataKey="saved" name="Saved" fill={COLORS.violet} radius={[6, 6, 0, 0]} maxBarSize={40} />
                <Bar dataKey="target" name="Target" fill={COLORS.violetSoft} stroke={COLORS.violet} strokeWidth={1} radius={[6, 6, 0, 0]} maxBarSize={40} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      <Card>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-display font-semibold" style={{ color: COLORS.ink }}>Upcoming bills</h3>
          <button onClick={() => setTab('bills')} className="font-body text-xs font-semibold" style={{ color: COLORS.violet }}>Manage &rarr;</button>
        </div>
        {unpaidBills.length === 0 ? (
          <EmptyState icon={CalendarClock} title="All caught up" subtitle="No unpaid bills this month." />
        ) : (
          <div className="grid sm:grid-cols-2 gap-2">
            {unpaidBills.slice(0, 6).map((b) => (
              <div key={b.id} className="flex items-center justify-between rounded-xl px-3 py-2" style={{ background: COLORS.bg }}>
                <div>
                  <p className="font-body font-semibold text-sm" style={{ color: COLORS.ink }}>{b.name}</p>
                  <p className="font-body text-xs" style={{ color: COLORS.inkSoft }}>Due day {b.dueDay}</p>
                </div>
                <span className="font-display font-semibold text-sm" style={{ color: COLORS.ink }}>{formatCurrency(b.amount)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

/* ---------------------------------- Ledger ---------------------------------- */

function LedgerView({ transactions, updateTransactions, budgets, month, setMonth, hiddenCategories, updateHiddenCategories, categoryMemory, updateCategoryMemory, goals, updateGoals }) {
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('All');
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [preview, setPreview] = useState(null);
  const [splitTarget, setSplitTarget] = useState(null);
  const [splitRows, setSplitRows] = useState([]);
  const [remainderCategory, setRemainderCategory] = useState('Other');
  const [expandedSplits, setExpandedSplits] = useState({});
  const [showCategoryManager, setShowCategoryManager] = useState(false);
  const [allocateTarget, setAllocateTarget] = useState(null);
  const [allocateRows, setAllocateRows] = useState([]);
  const [newBucketName, setNewBucketName] = useState('');
  const [allocateDirection, setAllocateDirection] = useState('deposit');

  function allocationDirection(t) {
    return t.savingsDirection || (t.type === 'income' ? 'withdraw' : 'deposit');
  }

  function isAllocationApplied(t) {
    return !!(t.savingsAllocations && t.savingsAllocations.length && t.savingsTransferConfirmed !== false);
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

  function hideCategory(cat) {
    if (!hiddenCategories.includes(cat)) updateHiddenCategories([...hiddenCategories, cat]);
  }

  function restoreCategory(cat) {
    updateHiddenCategories(hiddenCategories.filter((c) => c !== cat));
  }

  const [form, setForm] = useState({ date: todayStr(), description: '', category: 'Groceries', amount: '', type: 'expense' });

  const filtered = useMemo(() => {
    return transactions
      .filter((t) => t.date.startsWith(month))
      .filter((t) => catFilter === 'All' || t.category === catFilter || (t.splits && t.splits.some((s) => s.category === catFilter)))
      .filter((t) => t.description.toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [transactions, month, catFilter, search]);

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
    updateTransactions(transactions.filter((t) => t.id !== id));
  }

  const bucketCategoryNames = useMemo(() => goals.map((g) => g.name), [goals]);

  function updateCategory(id, category) {
    const tx = transactions.find((t) => t.id === id);
    if (tx) rememberCategory(tx.description, category);
    updateTransactions(transactions.map((t) => (t.id === id ? { ...t, category } : t)));
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
    if (tx && tx.savingsAllocations && tx.savingsAllocations.length && bucketCategoryNames.includes(tx.category)) {
      const newAlloc = tx.savingsAllocations.map((a) => ({ ...a, amount }));
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
    setAllocateRows(
      (t.savingsAllocations || []).map((a) => ({ id: uid(), bucketId: a.bucketId, amount: String(a.amount) }))
    );
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

  function confirmAllocate() {
    if (!allocateTarget || allocateOverBudget) return;
    const clean = allocateRows
      .filter((r) => r.bucketId && (Math.abs(parseFloat(r.amount)) || 0) > 0)
      .map((r) => ({ id: uid(), bucketId: r.bucketId, amount: Math.abs(parseFloat(r.amount)) || 0 }));

    const wasApplied = isAllocationApplied(allocateTarget);
    const oldSign = allocationDirection(allocateTarget) === 'withdraw' ? -1 : 1;
    const newSign = allocateDirection === 'withdraw' ? -1 : 1;
    applyAllocationDelta(wasApplied ? allocateTarget.savingsAllocations : [], oldSign, clean, newSign);
    updateTransactions(transactions.map((t) => (
      t.id === allocateTarget.id
        ? { ...t, savingsAllocations: clean.length ? clean : undefined, savingsDirection: clean.length ? allocateDirection : undefined, savingsTransferConfirmed: undefined }
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
          <p className="font-body text-sm" style={{ color: COLORS.inkSoft }}>Every dollar in and out, filterable by month.</p>
        </div>
        <MonthNav month={month} setMonth={setMonth} />
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
        <GhostButton onClick={() => setShowCategoryManager(true)}><Settings2 size={15} /> Categories</GhostButton>
        <GhostButton onClick={() => setShowImport(true)}><Upload size={15} /> Import CSV</GhostButton>
        <PrimaryButton onClick={() => setShowAdd((v) => !v)}><Plus size={15} /> Add entry</PrimaryButton>
      </div>

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

      <Card style={{ padding: 0 }}>
        {filtered.length === 0 ? (
          <EmptyState icon={Receipt} title="No transactions here" subtitle="Add one manually or import a CSV to get started." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm font-body">
              <thead>
                <tr style={{ color: COLORS.inkSoft }} className="text-left border-b" >
                  <th className="px-4 py-2.5 font-semibold text-xs uppercase tracking-wide">Date</th>
                  <th className="px-4 py-2.5 font-semibold text-xs uppercase tracking-wide">Description</th>
                  <th className="px-4 py-2.5 font-semibold text-xs uppercase tracking-wide">Category</th>
                  <th className="px-4 py-2.5 font-semibold text-xs uppercase tracking-wide text-right">Amount</th>
                  <th className="px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((t) => (
                  <React.Fragment key={t.id}>
                    <tr className="border-b last:border-0" style={{ borderColor: COLORS.border }}>
                      <td className="px-4 py-2.5" style={{ color: COLORS.inkSoft }}>{t.date}</td>
                      <td className="px-4 py-2.5 font-medium" style={{ color: COLORS.ink }}>
                        {t.description}
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
                          <CategoryEditCell value={t.category} options={categoryOptionsFor(t.category)} bucketOptions={bucketCategoryNames} onChange={(cat) => updateCategoryOrAllocate(t.id, cat)} />
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
                          <button onClick={() => openAllocateModal(t)} style={{ color: t.savingsAllocations && t.savingsAllocations.length ? (isAllocationApplied(t) ? (allocationDirection(t) === 'withdraw' ? COLORS.coral : COLORS.teal) : COLORS.gold) : COLORS.inkSoft }} className="hover:text-teal-600" title="Allocate to savings">
                            <PiggyBank size={15} />
                          </button>
                          <button onClick={() => openSplitModal(t)} style={{ color: COLORS.inkSoft }} className="hover:text-violet-600" title="Split transaction">
                            <Scissors size={15} />
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
                        <td className="px-4 py-2 pl-8 text-xs" style={{ color: COLORS.inkSoft }}>&#8618; portion</td>
                        <td className="px-4 py-2">
                          <CategoryEditCell value={s.category} options={categoryOptionsFor(s.category)} bucketOptions={bucketCategoryNames} onChange={(cat) => updateSplitCategory(t.id, s.id, cat)} />
                        </td>
                        <td className="px-4 py-2 text-right font-semibold text-sm" style={{ color: t.type === 'income' ? COLORS.teal : COLORS.coral }}>
                          {t.type === 'income' ? '+' : '-'}{formatCurrency(s.amount)}
                        </td>
                        <td className="px-4 py-2"></td>
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
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
              <h3 className="font-display font-semibold text-lg" style={{ color: COLORS.ink }}>Allocate to savings</h3>
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
                      {goals.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
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

            <div className="space-y-1.5 mb-4">
              {visibleCategories.filter((c) => c !== 'Income').map((cat) => (
                <div key={cat} className="flex items-center justify-between rounded-xl px-3 py-2" style={{ background: COLORS.bg }}>
                  <CategoryBadge cat={cat} />
                  <button onClick={() => hideCategory(cat)} style={{ color: COLORS.inkSoft }} className="hover:text-red-500" title="Hide from dropdowns">
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              {visibleCategories.filter((c) => c !== 'Income').length === 0 && (
                <p className="font-body text-xs" style={{ color: COLORS.inkSoft }}>No categories to show &mdash; everything's hidden.</p>
              )}
            </div>

            {hiddenCategories.length > 0 && (
              <>
                <p className="font-body text-xs font-semibold mb-2" style={{ color: COLORS.inkSoft }}>Hidden</p>
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
              </>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------- Budgets ---------------------------------- */

function BudgetsView({ budgets, updateBudgets, transactions, month, setMonth, categoryColors, updateCategoryColors, goals }) {
  const [newCat, setNewCat] = useState('');
  const [newLimit, setNewLimit] = useState('');
  const [colorPickerOpen, setColorPickerOpen] = useState({});

  const bucketNameSet = useMemo(() => new Set(goals.map((g) => g.name)), [goals]);

  const spentByCategory = useMemo(() => {
    const map = {};
    transactions.filter((t) => t.type === 'expense' && t.date.startsWith(month)).forEach((t) => {
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

  function updateLimit(cat, val) {
    updateBudgets({ ...budgets, [cat]: parseFloat(val) || 0 });
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

  const entries = Object.entries(budgets);

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
          {entries.map(([cat, limit]) => {
            const spent = spentByCategory[cat] || 0;
            const pct = limit ? (spent / limit) * 100 : 0;
            return (
              <Card key={cat}>
                <div className="flex items-center justify-between mb-2">
                  <CategoryBadge cat={cat} />
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
                      className="w-20 rounded-lg px-2 py-1 text-right font-semibold text-sm outline-none"
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

/* ---------------------------------- Goals ---------------------------------- */

function SavingsView({ goals, updateGoals, transactions }) {
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [deposits, setDeposits] = useState({});

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

  const hasPending = Object.values(pendingByBucket).some((v) => v !== 0);

  function addBucket() {
    if (!name.trim()) return;
    const t = parseFloat(target);
    updateGoals([...goals, { id: uid(), name: name.trim(), target: t > 0 ? t : null, saved: 0 }]);
    setName(''); setTarget(''); setShowAdd(false);
  }

  function addFunds(id) {
    const amt = parseFloat(deposits[id]);
    if (!amt) return;
    updateGoals(goals.map((g) => g.id === id ? { ...g, saved: g.saved + amt } : g));
    setDeposits({ ...deposits, [id]: '' });
  }

  function updateTarget(id, val) {
    const t = parseFloat(val);
    updateGoals(goals.map((g) => g.id === id ? { ...g, target: t > 0 ? t : null } : g));
  }

  function updateSavedAmount(id, val) {
    const v = Math.max(0, parseFloat(val) || 0);
    updateGoals(goals.map((g) => (g.id === id ? { ...g, saved: v } : g)));
  }

  function updateBucketName(id, val) {
    const v = val.trim();
    updateGoals(goals.map((g) => (g.id === id ? { ...g, name: v || g.name } : g)));
  }

  function removeBucket(id) {
    updateGoals(goals.filter((g) => g.id !== id));
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-display font-bold text-2xl" style={{ color: COLORS.ink }}>Savings</h2>
          <p className="font-body text-sm" style={{ color: COLORS.inkSoft }}>Name your buckets, then allocate money into them &mdash; from here or right from the ledger.</p>
        </div>
        <PrimaryButton onClick={() => setShowAdd((v) => !v)}><Plus size={15} /> New bucket</PrimaryButton>
      </div>

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
            {goals.filter((g) => pendingByBucket[g.id]).map((g) => {
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

      {goals.length === 0 ? (
        <Card><EmptyState icon={Target} title="No savings buckets yet" subtitle="Create one for anything you're setting money aside for &mdash; an emergency fund, a trip, a house." /></Card>
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          {goals.map((g) => {
            const hasTarget = g.target != null && g.target > 0;
            const pct = hasTarget ? (g.saved / g.target) * 100 : 0;
            const done = hasTarget && pct >= 100;
            return (
              <Card key={g.id}>
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

                {hasTarget ? (
                  <>
                    <JarBar pct={pct} height={16} />
                    <div className="flex items-center justify-between mt-2 font-body text-sm">
                      <div className="flex items-center gap-1" style={{ color: COLORS.inkSoft }}>
                        <input
                          key={`saved-${g.id}`}
                          type="number" min="0" step="0.01"
                          defaultValue={g.saved}
                          onBlur={(e) => updateSavedAmount(g.id, e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                          className="font-body text-sm rounded-lg px-1.5 py-0.5 outline-none text-right"
                          style={{ width: 76, color: COLORS.ink, border: `1.5px solid ${COLORS.border}` }}
                        />
                        <span>of {formatCurrency(g.target)}</span>
                      </div>
                      <span className="font-semibold" style={{ color: done ? COLORS.teal : COLORS.violet }}>{Math.min(pct, 100).toFixed(0)}%</span>
                    </div>
                  </>
                ) : (
                  <div className="flex items-center gap-1 mt-1">
                    <span className="font-display font-bold text-2xl" style={{ color: COLORS.ink }}>$</span>
                    <input
                      key={`saved-${g.id}`}
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
                )}

                <div className="flex gap-2 mt-3">
                  <TextInput
                    type="number" min="0" placeholder="Add funds"
                    value={deposits[g.id] || ''}
                    onChange={(e) => setDeposits({ ...deposits, [g.id]: e.target.value })}
                  />
                  <GhostButton onClick={() => addFunds(g.id)}><Plus size={14} /> Add</GhostButton>
                </div>
                <div className="mt-2">
                  <TextInput
                    type="number" min="0" placeholder="Set a target (optional)"
                    defaultValue={g.target || ''}
                    onBlur={(e) => updateTarget(g.id, e.target.value)}
                    style={{ fontSize: 12 }}
                  />
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------- Bills ---------------------------------- */

function BillsView({ bills, updateBills, month, budgets, hiddenCategories }) {
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

/* ---------------------------------- App ---------------------------------- */

const TABS = [
  { id: 'dashboard', label: 'Dashboard', icon: Wallet },
  { id: 'ledger', label: 'Ledger', icon: Receipt },
  { id: 'budgets', label: 'Budgets', icon: PiggyBank },
  { id: 'savings', label: 'Savings', icon: Coins },
  { id: 'bills', label: 'Bills', icon: CalendarClock },
];

export default function App() {
  const [familyCode, setFamilyCode] = useState(() => window.localStorage.getItem('finance:householdCode') || '');
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('dashboard');
  const [month, setMonth] = useState(currentMonthStr());
  const [transactions, setTransactions] = useState([]);
  const [budgets, setBudgets] = useState({});
  const [goals, setGoals] = useState([]);
  const [bills, setBills] = useState([]);
  const [categoryColors, setCategoryColors] = useState({});
  const [hiddenCategories, setHiddenCategories] = useState([]);
  const [categoryMemory, setCategoryMemory] = useState({ exact: {}, merchant: {} });

  useEffect(() => {
    if (!familyCode) return;
    setLoading(true);
    const ref = doc(db, 'households', familyCode);
    const unsub = onSnapshot(ref, (snap) => {
      const d = snap.data();
      setTransactions(d?.transactions || []);
      setBudgets(d?.budgets || {});
      setGoals(d?.goals || []);
      setBills(d?.bills || []);
      setCategoryColors(d?.categoryColors || {});
      setHiddenCategories(d?.hiddenCategories || []);
      setCategoryMemory(d?.categoryMemory || { exact: {}, merchant: {} });
      setLoading(false);
    }, (err) => {
      console.error('Sync failed', err);
      setLoading(false);
    });
    return unsub;
  }, [familyCode]);

  function syncField(field, value) {
    if (!familyCode) return;
    setDoc(doc(db, 'households', familyCode), { [field]: value }, { merge: true })
      .catch((e) => {
        console.error('Save failed', e);
        window.alert(`Couldn't save your change — it may not persist. (${e.message})`);
      });
  }

  function joinHousehold(code) {
    window.localStorage.setItem('finance:householdCode', code);
    setFamilyCode(code);
  }

  function leaveHousehold() {
    window.localStorage.removeItem('finance:householdCode');
    setFamilyCode('');
  }

  function updateTransactions(next) { setTransactions(next); syncField('transactions', next); }
  function updateBudgets(next) { setBudgets(next); syncField('budgets', next); }
  function updateGoals(next) { setGoals(next); syncField('goals', next); }
  function updateBills(next) { setBills(next); syncField('bills', next); }
  function updateCategoryColors(next) { setCategoryColors(next); syncField('categoryColors', next); }
  function updateHiddenCategories(next) { setHiddenCategories(next); syncField('hiddenCategories', next); }
  function updateCategoryMemory(next) { setCategoryMemory(next); syncField('categoryMemory', next); }

  if (!familyCode) {
    return <HouseholdGate onSubmit={joinHousehold} />;
  }

  return (
    <CategoryColorContext.Provider value={categoryColors}>
    <div className="min-h-screen font-body" style={{ background: COLORS.bg }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fredoka:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap');
        .font-display { font-family: 'Fredoka', sans-serif; }
        .font-body { font-family: 'Inter', sans-serif; }
      `}</style>

      <header className="px-5 sm:px-8 pt-6 pb-4 flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span style={{ fontSize: 26 }}>🫙</span>
            <h1 className="font-display font-bold text-2xl" style={{ color: COLORS.ink }}>Family Budget</h1>
          </div>
          <p className="font-body text-sm mt-0.5" style={{ color: COLORS.inkSoft }}>Your shared money, in one place.</p>
        </div>
        <button
          onClick={leaveHousehold}
          className="font-body text-xs font-semibold rounded-full px-3 py-1.5 flex-shrink-0"
          style={{ color: COLORS.inkSoft, background: COLORS.surface, border: `1px solid ${COLORS.border}` }}
          title="Switch to a different household code"
        >
          {familyCode}
        </button>
      </header>

      <nav className="px-5 sm:px-8">
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className="flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold font-body whitespace-nowrap transition-colors"
                style={active
                  ? { background: COLORS.violet, color: '#fff', boxShadow: '0 3px 10px rgba(124,92,252,0.35)' }
                  : { background: COLORS.surface, color: COLORS.inkSoft, border: `1px solid ${COLORS.border}` }}
              >
                <Icon size={15} /> {t.label}
              </button>
            );
          })}
        </div>
      </nav>

      <main className="px-5 sm:px-8 py-6 max-w-6xl mx-auto">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-24">
            <Loader2 size={26} className="animate-spin" style={{ color: COLORS.violet }} />
            <p className="font-body text-sm mt-3" style={{ color: COLORS.inkSoft }}>Loading your data...</p>
          </div>
        ) : (
          <>
            {tab === 'dashboard' && (
              <DashboardView transactions={transactions} budgets={budgets} bills={bills} goals={goals} month={month} setMonth={setMonth} setTab={setTab} />
            )}
            {tab === 'ledger' && (
              <LedgerView transactions={transactions} updateTransactions={updateTransactions} budgets={budgets} month={month} setMonth={setMonth} hiddenCategories={hiddenCategories} updateHiddenCategories={updateHiddenCategories} categoryMemory={categoryMemory} updateCategoryMemory={updateCategoryMemory} goals={goals} updateGoals={updateGoals} />
            )}
            {tab === 'budgets' && (
              <BudgetsView budgets={budgets} updateBudgets={updateBudgets} transactions={transactions} month={month} setMonth={setMonth} categoryColors={categoryColors} updateCategoryColors={updateCategoryColors} goals={goals} />
            )}
            {tab === 'savings' && (
              <SavingsView goals={goals} updateGoals={updateGoals} transactions={transactions} />
            )}
            {tab === 'bills' && (
              <BillsView bills={bills} updateBills={updateBills} month={month} budgets={budgets} hiddenCategories={hiddenCategories} />
            )}
          </>
        )}
      </main>
    </div>
    </CategoryColorContext.Provider>
  );
}

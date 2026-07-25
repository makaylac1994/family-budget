const SAVINGS_SUBTYPES = ['savings', 'money market', 'cd', 'hsa'];
export function isSavingsAccount(account) {
  return SAVINGS_SUBTYPES.includes((account.subtype || '').toLowerCase());
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function indexById(items) {
  return Object.fromEntries((items || []).map((item) => [item.id, item]));
}

export function generateInviteCode() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I, easy to read aloud
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

export function formatCurrency(n) {
  const num = Number(n) || 0;
  return num.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function currentMonthStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function monthLabel(monthStr) {
  const [y, m] = monthStr.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

export function shiftMonth(monthStr, delta) {
  const [y, m] = monthStr.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function normalizeDate(raw) {
  if (!raw) return todayStr();
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  return todayStr();
}

export function normalizeDescription(desc) {
  return String(desc || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\d+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function merchantToken(desc) {
  const parts = normalizeDescription(desc).split(' ').filter(Boolean);
  return parts.length ? parts[0] : '';
}

export function txSignature(t) {
  return `${t.date}|${Math.round(t.amount * 100)}|${t.type}|${normalizeDescription(t.description)}`;
}

// Which txMonths/{monthKey} bucket a transaction belongs to. Dates are always
// 'YYYY-MM-DD' (see todayStr/normalizeDate) but this falls back safely for
// any transaction that somehow doesn't have one, rather than throwing.
export function monthKeyOf(t) {
  const d = t && t.date;
  return typeof d === 'string' && /^\d{4}-\d{2}/.test(d) ? d.slice(0, 7) : 'unknown';
}

export function groupTransactionsByMonth(list) {
  const grouped = new Map();
  for (const t of list) {
    const key = monthKeyOf(t);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(t);
  }
  return grouped;
}

// Determines whether a transaction was paid from a bank account ('bank') or
// charged to a credit card ('card'). Explicit manual overrides win; otherwise
// it's inferred from the connected Plaid account's type; otherwise it falls
// back to a sensible default by transaction type.
export function paymentSourceFor(t, accountsById) {
  if (t.paymentSource) return t.paymentSource;
  if (t.plaidAccountId && accountsById && accountsById[t.plaidAccountId]) {
    return accountsById[t.plaidAccountId].type === 'credit' ? 'card' : 'bank';
  }
  return t.type === 'income' ? 'bank' : 'card';
}

// Amount to count toward spending totals, excluding any portion allocated to
// a savings bucket (splits or whole-transaction).
export function nonBucketAmount(t, bucketNameSet) {
  if (t.splits && t.splits.length) {
    return t.splits.reduce((sum, sp) => sum + (bucketNameSet.has(sp.category) ? 0 : sp.amount), 0);
  }
  return bucketNameSet.has(t.category) ? 0 : t.amount;
}

// How much a bucket needs saved per month to hit its target by its target
// date, based on what's left and how much time remains from today. Returns 0
// if there's no target/target date, or if the target's already been reached.
export function monthlySavingsNeeded(g) {
  if (!g.target || g.target <= 0 || !g.targetDate) return 0;
  const remaining = Math.max(0, g.target - (g.saved || 0));
  if (remaining <= 0) return 0;
  const today = new Date();
  const due = new Date(`${g.targetDate}T00:00:00`);
  const msRemaining = due - today;
  if (msRemaining <= 0) return remaining;
  const monthsRemaining = Math.max(1, Math.ceil(msRemaining / (1000 * 60 * 60 * 24 * 30.44)));
  return remaining / monthsRemaining;
}

export function detectHeaderMap(fields) {
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

export function rowToTransaction(row, map, memory) {
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

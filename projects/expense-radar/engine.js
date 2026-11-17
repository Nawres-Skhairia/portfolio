// Expense Radar engine: every figure on screen comes from here. Pure functions, no screen code.
// Money is always a whole number of cents (integers), so 0.1 + 0.2 never becomes 0.30000000000000004.
// Expenses are negative amounts, income is positive.

export const CATEGORIES = ['Housing', 'Groceries', 'Eating out', 'Transport', 'Subscriptions', 'Utilities', 'Health', 'Shopping', 'Leisure', 'Travel', 'Gifts', 'Other', 'Salary', 'Other income'];
export const INCOME_CATEGORIES = ['Salary', 'Other income'];
export const CURRENCIES = { EUR: '€', USD: '$', GBP: '£', CHF: 'CHF ' };

// ---------- money ----------
// "1 234,56", "1,234.56", "-12.5", "€ 9,99" → cents. Returns null when it is not a clear amount.
export function toCents(input) {
  if (typeof input === 'number') return Number.isFinite(input) ? Math.round(input * 100) : null;
  let s = String(input ?? '').trim().replace(/[\s  ']/g, '').replace(/^[€$£]|[€$£]$|^(EUR|USD|GBP|CHF)|(EUR|USD|GBP|CHF)$/gi, '');
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (s.startsWith('-')) { neg = !neg; s = s.slice(1); } else if (s.startsWith('+')) s = s.slice(1);
  if (s.endsWith('-')) { neg = !neg; s = s.slice(0, -1); }
  if (!/^[0-9.,]+$/.test(s) || !/[0-9]/.test(s)) return null;
  let whole = s; let frac = '';
  const dots = (s.match(/\./g) || []).length; const commas = (s.match(/,/g) || []).length;
  if (dots && commas) { const dec = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ','; const i = s.lastIndexOf(dec); whole = s.slice(0, i); frac = s.slice(i + 1); if (whole.includes(dec)) return null; }
  else if (dots + commas === 1) { const i = Math.max(s.indexOf('.'), s.indexOf(',')); const after = s.slice(i + 1); if (after.length === 3) whole = s; else { whole = s.slice(0, i); frac = after; } }
  // several of the same separator: thousands ("1.234.567")
  if (frac.length > 2 || /[.,]/.test(frac)) return null;
  whole = whole.replace(/[.,]/g, '');
  if (whole === '' && frac === '') return null;
  const cents = Number(whole || '0') * 100 + Number((frac + '00').slice(0, 2));
  if (!Number.isSafeInteger(cents)) return null;
  return neg ? -cents : cents;
}

export function formatMoney(cents, currency = 'EUR', { sign = false, round = false } = {}) {
  const neg = cents < 0; let abs = Math.abs(cents);
  if (round) abs = Math.round(abs / 100) * 100;
  const whole = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const frac = String(abs % 100).padStart(2, '0');
  const sym = CURRENCIES[currency] || currency + ' ';
  return (neg ? '−' : sign && cents > 0 ? '+' : '') + sym + whole + (round ? '' : '.' + frac);
}

// Split a total into n parts that add up exactly (largest remainder).
export function splitCents(total, n) {
  const base = Math.trunc(total / n); const rest = total - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < Math.abs(rest) ? Math.sign(rest) : 0));
}
export const sum = list => list.reduce((a, b) => a + b, 0);
export const pct = (part, whole) => whole === 0 ? 0 : Math.round((part / whole) * 1000) / 10;

// ---------- dates ----------
const pad = n => String(n).padStart(2, '0');
export const monthOf = date => String(date).slice(0, 7);
export const daysInMonth = month => { const [y, m] = month.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
export function addMonths(month, n) { const [y, m] = month.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1); }
export function addDays(date, n) { const d = new Date(date + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
export const dayDiff = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
export function isDate(s) { if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s))) return false; const d = new Date(s + 'T00:00:00Z'); return !isNaN(d) && d.toISOString().slice(0, 10) === s; }
export function monthName(month, short = false) { const [y, m] = month.split('-').map(Number); return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-GB', { month: short ? 'short' : 'long', year: 'numeric', timeZone: 'UTC' }); }

// ---------- validation ----------
export function validateTx(t) {
  const e = {};
  if (!isDate(t.date)) e.date = 'Enter a real date.';
  if (!String(t.payee || '').trim()) e.payee = 'Say who was paid or who paid you.';
  else if (String(t.payee).length > 80) e.payee = 'Use 80 characters or fewer.';
  if (!Number.isSafeInteger(t.amount) || t.amount === 0) e.amount = 'Enter an amount other than zero.';
  else if (Math.abs(t.amount) > 100_000_000_00) e.amount = 'This amount is too large.';
  if (!CATEGORIES.includes(t.category)) e.category = 'Choose a category.';
  if (String(t.note || '').length > 200) e.note = 'Use 200 characters or fewer.';
  return e;
}
export function isValidData(d) {
  return d && typeof d === 'object' && Array.isArray(d.transactions) && d.budgets && typeof d.budgets === 'object' && Array.isArray(d.subscriptions) &&
    d.transactions.every(t => t && typeof t.id === 'string' && !Object.keys(validateTx(t)).length);
}
export const emptyData = (currency = 'EUR') => ({ version: 1, currency, transactions: [], budgets: {}, subscriptions: [], dismissed: [] });

// ---------- totals ----------
export const inMonth = (txs, month) => txs.filter(t => monthOf(t.date) === month);
export function totals(txs) {
  const income = sum(txs.filter(t => t.amount > 0).map(t => t.amount));
  const spent = -sum(txs.filter(t => t.amount < 0).map(t => t.amount));
  return { income, spent, balance: income - spent, savingsRate: income > 0 ? pct(income - spent, income) : null };
}
export function trend(txs, lastMonth, n = 6) {
  return Array.from({ length: n }, (_, i) => { const m = addMonths(lastMonth, i - n + 1); return { month: m, ...totals(inMonth(txs, m)) }; });
}
export function byCategory(txs) {
  const map = new Map();
  for (const t of txs) if (t.amount < 0) map.set(t.category, (map.get(t.category) || 0) - t.amount);
  return [...map.entries()].map(([category, spent]) => ({ category, spent })).sort((a, b) => b.spent - a.spent || a.category.localeCompare(b.category));
}

// ---------- budgets ----------
// For each category with a limit: spent, what is left, and the pace (spent so far against the share of the month gone).
export function budgetStatus(data, month, today) {
  const spentBy = Object.fromEntries(byCategory(inMonth(data.transactions, month)).map(x => [x.category, x.spent]));
  const days = daysInMonth(month);
  const dayNow = monthOf(today) === month ? Number(today.slice(8, 10)) : (month < monthOf(today) ? days : 0);
  // Regular payments (rent, subscriptions) are paid once a month, so only the rest of the spending is projected forward.
  const fixed = recurringKeys(data.transactions, today);
  const txm = inMonth(data.transactions, month).filter(t => t.amount < 0);
  return Object.entries(data.budgets).filter(([, limit]) => limit > 0).map(([category, limit]) => {
    const spent = spentBy[category] || 0;
    const fixedSpent = -sum(txm.filter(t => t.category === category && fixed.has(normPayee(t.payee))).map(t => t.amount));
    const expected = fixedSpent + Math.round((limit - fixedSpent) * dayNow / days);
    const projected = dayNow > 0 ? fixedSpent + Math.round((spent - fixedSpent) * days / dayNow) : 0;
    const state = spent > limit ? 'over' : (dayNow < days && dayNow >= 7 && projected > limit && spent > expected) ? 'pace' : 'ok';
    return { category, limit, spent, left: limit - spent, used: pct(spent, limit), state, projected, expected };
  }).sort((a, b) => b.used - a.used);
}

// ---------- recurring payments ----------
export const normPayee = p => String(p || '').toLowerCase().replace(/\d{3,}/g, '').replace(/[^a-zÀ-ɏ]+/g, ' ').trim().split(' ').slice(0, 3).join(' ');
const median = list => { if (!list.length) return 0; const s = [...list].sort((a, b) => a - b); const h = s.length >> 1; return s.length % 2 ? s[h] : Math.round((s[h - 1] + s[h]) / 2); };
const CADENCES = [{ name: 'Weekly', days: 7, lo: 6, hi: 8, perYear: 52 }, { name: 'Monthly', days: 30, lo: 26, hi: 35, perYear: 12 }, { name: 'Yearly', days: 365, lo: 355, hi: 375, perYear: 1 }];
// Same payee, similar amount (within 15 % of the usual one), regular gap, at least 3 times.
export function detectRecurring(txs, today) {
  const groups = new Map();
  for (const t of txs) if (t.amount < 0) { const k = normPayee(t.payee); if (!k) continue; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(t); }
  const out = [];
  for (const [key, list] of groups) {
    if (list.length < 3) continue;
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
    const typical = median(sorted.map(t => -t.amount));
    // within 35 % of the usual amount, so a price rise is still the same subscription
    const similar = sorted.filter(t => Math.abs(-t.amount - typical) <= typical * 0.35);
    if (similar.length < 3) continue;
    const gaps = similar.slice(1).map((t, i) => dayDiff(similar[i].date, t.date));
    const g = median(gaps);
    const cad = CADENCES.find(c => g >= c.lo && g <= c.hi);
    if (!cad || gaps.filter(x => x >= cad.lo && x <= cad.hi).length < gaps.length * 0.7) continue;
    const last = similar[similar.length - 1];
    let next = cad.days === 30 ? addMonths(monthOf(last.date), 1) + '-' + pad(Math.min(Number(last.date.slice(8, 10)), daysInMonth(addMonths(monthOf(last.date), 1)))) : addDays(last.date, cad.days);
    const stale = dayDiff(next, today) > cad.days; // it stopped: the next one is long overdue
    // a price change among the last three payments: the newest amount against the one before it
    const amount = -last.amount;
    const prevIdx = similar.map(t => -t.amount).lastIndexOf(similar.map(t => -t.amount).reverse().find(v => v !== amount) ?? amount);
    // only for fixed prices: the two payments before the change were the same amount (a bill that varies is not a price rise)
    const changed = prevIdx >= 1 && -similar[prevIdx].amount !== amount && similar.length - 1 - prevIdx <= 3 && similar[prevIdx - 1].amount === similar[prevIdx].amount;
    const priceChange = changed ? amount - (-similar[prevIdx].amount) : 0;
    out.push({ key, payee: last.payee, category: last.category, amount, cadence: cad.name, count: similar.length, last: last.date, next, yearly: amount * cad.perYear, stopped: stale, priceChange, since: changed ? similar[prevIdx + 1].date : null });
  }
  return out.sort((a, b) => b.yearly - a.yearly);
}
export function subscriptionYearly(s) { return s.amount * ({ Weekly: 52, Monthly: 12, Yearly: 1 }[s.cadence] || 12); }

const recurringKeys = (txs, today) => new Set(detectRecurring(txs, today).filter(r => !r.stopped).map(r => r.key));

// ---------- unusual expenses ----------
// An expense is unusual when it is well above what this category usually costs: more than the usual
// amount plus three times the usual spread (median and median absolute deviation), and at least twice the usual.
// Needs at least 5 earlier expenses in the category, so a new category is never called unusual.
export function unusual(txs, month, today = month + '-28') {
  const out = []; const fixed = recurringKeys(txs, today);
  for (const t of inMonth(txs, month)) {
    if (t.amount >= 0 || fixed.has(normPayee(t.payee))) continue;
    const history = txs.filter(x => x.category === t.category && x.amount < 0 && x.date < t.date && x.id !== t.id && !fixed.has(normPayee(x.payee))).map(x => -x.amount);
    if (history.length < 5) continue;
    const med = median(history); const mad = Math.max(median(history.map(v => Math.abs(v - med))), Math.round(med * 0.1), 100);
    const v = -t.amount; const top = med + 3 * mad;
    if (v > top && v >= med * 2) out.push({ tx: t, usual: med, usualHigh: top, times: Math.round((v / med) * 10) / 10 });
  }
  return out.sort((a, b) => b.times - a.times);
}

// ---------- month on month, and the estimate ----------
export function monthOnMonth(txs, month) {
  const now = Object.fromEntries(byCategory(inMonth(txs, month)).map(x => [x.category, x.spent]));
  const before = Object.fromEntries(byCategory(inMonth(txs, addMonths(month, -1))).map(x => [x.category, x.spent]));
  const cats = [...new Set([...Object.keys(now), ...Object.keys(before)])];
  return cats.map(c => ({ category: c, now: now[c] || 0, before: before[c] || 0, change: (now[c] || 0) - (before[c] || 0), changePct: before[c] ? pct((now[c] || 0) - before[c], before[c]) : null }))
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
}
// Estimate for a month: the average of the 3 full months before it, per category. Always labelled an estimate.
export function forecast(txs, month) {
  const months = [1, 2, 3].map(i => addMonths(month, -i));
  const have = months.filter(m => inMonth(txs, m).length > 0);
  if (have.length < 3) return { ready: false, months, have: have.length };
  const cats = new Map();
  for (const m of months) for (const x of byCategory(inMonth(txs, m))) cats.set(x.category, (cats.get(x.category) || 0) + x.spent);
  const perCategory = [...cats.entries()].map(([category, s]) => ({ category, estimate: Math.round(s / 3) })).sort((a, b) => b.estimate - a.estimate);
  const income = Math.round(sum(months.map(m => totals(inMonth(txs, m)).income)) / 3);
  const spent = sum(perCategory.map(c => c.estimate));
  return { ready: true, months, perCategory, income, spent, balance: income - spent };
}

// ---------- insights in words, each with its evidence ----------
export function insights(data, today) {
  const month = monthOf(today); const prev = addMonths(month, -1); const cur = data.currency;
  const m = v => formatMoney(v, cur, { round: Math.abs(v) >= 10000 });
  const list = [];
  for (const b of budgetStatus(data, month, today)) {
    if (b.state === 'over') list.push({ id: 'over-' + b.category, level: 'high', title: b.category + ' is over budget', text: 'You spent ' + m(b.spent) + ' of ' + m(b.limit) + ' this month, ' + m(b.spent - b.limit) + ' more than planned.', link: '#/budgets' });
    else if (b.state === 'pace') list.push({ id: 'pace-' + b.category, level: 'mid', title: b.category + ' may go over', text: 'At this pace it ends the month near ' + m(b.projected) + ', for a budget of ' + m(b.limit) + '.', link: '#/budgets' });
  }
  for (const u of unusual(data.transactions, month, today).slice(0, 3)) list.push({ id: 'odd-' + u.tx.id, level: 'mid', title: 'An unusual ' + u.tx.category.toLowerCase() + ' expense', text: m(-u.tx.amount) + ' at ' + u.tx.payee + ' on ' + u.tx.date.slice(8, 10) + '/' + u.tx.date.slice(5, 7) + ' is ' + u.times + ' times your usual ' + u.tx.category.toLowerCase() + ' expense (' + m(u.usual) + ').', link: '#/transactions?q=' + encodeURIComponent(u.tx.payee) });
  const rec = detectRecurring(data.transactions, today);
  for (const r of rec.filter(r => r.priceChange > 0).slice(0, 2)) list.push({ id: 'price-' + r.key, level: 'mid', title: r.payee + ' costs more', text: 'Since ' + r.since.slice(8, 10) + '/' + r.since.slice(5, 7) + ' it is ' + m(r.amount) + ' instead of ' + m(r.amount - r.priceChange) + ', or ' + m(r.priceChange * ({ Weekly: 52, Monthly: 12, Yearly: 1 }[r.cadence])) + ' more a year.', link: '#/recurring' });
  const live = rec.filter(r => !r.stopped);
  if (live.length) list.push({ id: 'rec-total', level: 'low', title: 'Regular payments: ' + m(sum(live.map(r => r.yearly))) + ' a year', text: live.length + ' payments come back on their own. The largest is ' + live[0].payee + ' at ' + m(live[0].yearly) + ' a year.', link: '#/recurring' });
  const mom = monthOnMonth(data.transactions, prev).filter(x => x.before > 0 && Math.abs(x.change) >= 5000);
  if (mom[0]) list.push({ id: 'mom-' + mom[0].category, level: 'low', title: mom[0].category + (mom[0].change > 0 ? ' went up' : ' went down') + ' last month', text: m(mom[0].now) + ' in ' + monthName(prev) + ', against ' + m(mom[0].before) + ' the month before (' + (mom[0].change > 0 ? '+' : '') + mom[0].changePct + ' %).', link: '#/analysis' });
  const tPrev = totals(inMonth(data.transactions, prev));
  if (tPrev.savingsRate !== null) list.push({ id: 'save-' + prev, level: 'low', title: 'You kept ' + Math.max(0, tPrev.savingsRate) + ' % of your income in ' + monthName(prev).split(' ')[0], text: 'Income ' + m(tPrev.income) + ', spending ' + m(tPrev.spent) + '.', link: '#/analysis' });
  const dismissed = new Set(data.dismissed || []);
  return list.filter(i => !dismissed.has(i.id));
}

// ---------- CSV ----------
export function detectDelimiter(text) {
  const lines = String(text).split(/\r?\n/).filter(l => l.trim()).slice(0, 5);
  let best = ','; let bestScore = -1;
  for (const d of [',', ';', '\t', '|']) {
    const counts = lines.map(l => parseCsvLine(l, d).length);
    const score = counts.length && counts.every(c => c === counts[0]) ? counts[0] : 0;
    if (score > bestScore) { best = d; bestScore = score; }
  }
  return best;
}
function parseCsvLine(line, d) { return parseCsv(line, d)[0] || []; }
// RFC 4180: quotes, doubled quotes, delimiters and new lines inside quotes.
export function parseCsv(text, d = ',') {
  const rows = []; let row = []; let cell = ''; let q = false; const s = String(text).replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
    if (c === '"' && cell === '') q = true;
    else if (c === d) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some(x => x.trim() !== '')) rows.push(row); row = []; }
    else cell += c;
  }
  row.push(cell); if (row.some(x => x.trim() !== '')) rows.push(row);
  return rows;
}
// Guess which column is which from the header names.
export function guessMapping(header) {
  const h = header.map(x => String(x).toLowerCase().trim());
  const find = (...words) => h.findIndex(x => words.some(w => x.includes(w)));
  const map = { date: find('date', 'datum', 'booking', 'день', 'дата'), payee: find('payee', 'description', 'merchant', 'name', 'counterparty', 'details', 'описание'), amount: find('amount', 'sum', 'value', 'сума'), debit: find('debit', 'out', 'withdraw'), credit: find('credit', 'in ', 'deposit'), category: find('category', 'категория') };
  if (map.amount >= 0) { map.debit = -1; map.credit = -1; }
  return map;
}
export function parseDate(s, format) {
  const v = String(s || '').trim(); let m;
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(v))) return check(m[1], m[2], m[3]);
  if ((m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(v))) return format === 'MDY' ? check(m[3], m[1], m[2]) : check(m[3], m[2], m[1]);
  return null;
  function check(y, mo, d) { const iso = y + '-' + pad(Number(mo)) + '-' + pad(Number(d)); return isDate(iso) ? iso : null; }
}
// Turn CSV rows into transactions, row by row, with a reason for each row that cannot be used,
// and mark rows that are already there (same date, amount and payee) or repeated in the file.
export function prepareImport(rows, map, opts, existing) {
  const { hasHeader = true, dateFormat = 'DMY', defaultCategory = 'Other', signFlip = false } = opts || {};
  const body = hasHeader ? rows.slice(1) : rows;
  const seen = new Map();
  for (const t of existing) { const k = t.date + '|' + t.amount + '|' + normPayee(t.payee); seen.set(k, (seen.get(k) || 0) + 1); }
  const inFile = new Map();
  return body.map((r, i) => {
    const line = i + (hasHeader ? 2 : 1);
    const errors = [];
    const date = parseDate(r[map.date], dateFormat);
    if (!date) errors.push('the date "' + String(r[map.date] ?? '').slice(0, 20) + '" is not clear');
    let amount = null;
    if (map.amount >= 0) amount = toCents(r[map.amount]);
    else { const dv = map.debit >= 0 ? toCents(r[map.debit] || '0') : 0; const cv = map.credit >= 0 ? toCents(r[map.credit] || '0') : 0; amount = dv === null || cv === null ? null : (cv || 0) - Math.abs(dv || 0); }
    if (amount !== null && signFlip) amount = -amount;
    if (amount === null || amount === 0) errors.push('the amount "' + String(r[map.amount >= 0 ? map.amount : map.debit] ?? '').slice(0, 20) + '" is not a number');
    const payee = String(r[map.payee] ?? '').trim().slice(0, 80);
    if (!payee) errors.push('there is no payee');
    let category = map.category >= 0 ? String(r[map.category] || '').trim() : '';
    const known = CATEGORIES.find(c => c.toLowerCase() === category.toLowerCase());
    category = known || (amount > 0 ? 'Other income' : defaultCategory);
    const tx = { date, payee, amount, category, note: '' };
    let duplicate = '';
    if (!errors.length) {
      const k = date + '|' + amount + '|' + normPayee(payee);
      const n = inFile.get(k) || 0; inFile.set(k, n + 1);
      if ((seen.get(k) || 0) > n) duplicate = 'already in your transactions';
      else if (n > 0) duplicate = 'appears twice in this file';
    }
    return { line, tx, errors, duplicate };
  });
}
// Text cells that start with = + - @ are prefixed so a spreadsheet never runs them as formulas.
const safeCell = v => { const s = String(v ?? ''); const t = /^[=+\-@\t\r]/.test(s) ? "'" + s : s; return /[",\n\r;]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
export function toCsv(txs) {
  const head = ['Date', 'Payee', 'Category', 'Amount', 'Note'];
  const lines = txs.map(t => [t.date, safeCell(t.payee), safeCell(t.category), (t.amount < 0 ? '-' : '') + Math.floor(Math.abs(t.amount) / 100) + '.' + String(Math.abs(t.amount) % 100).padStart(2, '0'), safeCell(t.note)].join(','));
  return [head.join(','), ...lines].join('\r\n') + '\r\n';
}

// ---------- changes ----------
let n = 0;
export const newId = () => 't' + Date.now().toString(36) + (n++).toString(36) + Math.random().toString(36).slice(2, 6);
export function upsertTx(data, tx) {
  const errors = validateTx(tx); if (Object.keys(errors).length) return { errors, data };
  const clean = { id: tx.id || newId(), date: tx.date, payee: String(tx.payee).trim(), amount: tx.amount, category: tx.category, note: String(tx.note || '').trim() };
  const i = data.transactions.findIndex(t => t.id === clean.id);
  const transactions = i >= 0 ? data.transactions.map(t => t.id === clean.id ? clean : t) : [...data.transactions, clean];
  return { errors: {}, data: { ...data, transactions }, tx: clean };
}
export function removeTx(data, ids) { const s = new Set(ids); return { ...data, transactions: data.transactions.filter(t => !s.has(t.id)) }; }
export function setBudget(data, category, cents) {
  if (!CATEGORIES.includes(category) || INCOME_CATEGORIES.includes(category)) return { error: 'Choose a spending category.' };
  if (!Number.isSafeInteger(cents) || cents < 0 || cents > 10_000_000_00) return { error: 'Enter an amount of zero or more.' };
  const budgets = { ...data.budgets }; if (cents === 0) delete budgets[category]; else budgets[category] = cents;
  return { data: { ...data, budgets } };
}

// Expense Radar: screens and interactions. Every figure comes from engine.js; this file shows it and saves changes.
import * as E from './engine.js';
import { seed } from './seed.js';

const KEY = 'expense-radar-v1';
const pad = n => String(n).padStart(2, '0');
const now = new Date();
const TODAY = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
const THIS_MONTH = E.monthOf(TODAY);
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- storage: everything stays on this device (one key). Your own money or the sample, never both. ----------
let notice = ''; let firstVisit = false;
function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) { const d = JSON.parse(raw); if (E.isValidData(d)) return d; notice = 'The saved data could not be read. Restore a backup, or start again.'; }
    else firstVisit = true;
  } catch (e) { firstVisit = true; /* storage blocked: work in memory */ }
  return seed(TODAY);
}
let data = load();
// Ask the browser to keep this data even when space runs low (no prompt in most browsers).
function keepSafe() { try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().then(ok => { ui.persisted = ok; renderBand(); }); } catch (e) { /* not supported */ } }
if (data.own) { try { if (navigator.storage && navigator.storage.persisted) navigator.storage.persisted().then(ok => { ui.persisted = ok; if (!ok) keepSafe(); else renderBand(); }); } catch (e) { /* not supported */ } }
function save() { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { toast('This browser did not allow saving. Your changes last until you close the tab.'); } }
function commit(next, message, undoable = true) {
  const prev = data; data = next; save(); render();
  if (message) toast(message, undoable ? () => { data = prev; save(); render(); toast('Undone.'); } : null);
}

const ui = { month: THIS_MONTH, q: '', cat: '', type: 'all', tmonth: '', sort: { k: 'date', dir: -1 }, sel: new Set(), more: 0, imp: { step: 1 }, period: 'this', from: '', to: '' };
const money = (c, o) => E.formatMoney(c, data.currency, o);
const mnum = (c, o) => '<span class="money">' + esc(money(c, o)) + '</span>';
const dshort = d => Number(d.slice(8, 10)) + ' ' + new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });
const dlong = d => new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const firstMonth = () => data.transactions.reduce((m, t) => t.date < m ? t.date : m, TODAY).slice(0, 7);
const curSym = () => (E.CURRENCIES[data.currency] || '€').trim();
const SPEND = E.CATEGORIES.filter(c => !E.INCOME_CATEGORIES.includes(c));

// ---------- routing ----------
function route() { const h = location.hash.replace(/^#\/?/, ''); const [p, q] = h.split('?'); return { name: p || 'overview', params: new URLSearchParams(q || '') }; }
const VIEWS = { overview, transactions, budgets, recurring, analysis, import: importView, reports };
function render() {
  if (firstVisit) { $('#main').innerHTML = welcome(); $('#band').innerHTML = ''; document.title = 'Welcome · Expense Radar'; return; }
  const r = route(); const v = VIEWS[r.name] ? r.name : 'overview';
  if (v === 'transactions' && r.params.has('q')) { ui.q = r.params.get('q'); ui.tmonth = ''; history.replaceState(null, '', '#/transactions'); }
  $$('#tabs a').forEach(a => { if (a.dataset.nav === v) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  document.title = ({ overview: 'Overview', transactions: 'Transactions', budgets: 'Budgets', recurring: 'Regular payments', analysis: 'Analysis', import: 'Import', reports: 'Reports' })[v] + ' · Expense Radar';
  $('#main').innerHTML = VIEWS[v](r);
  renderBand();
}
let lastView = '';
window.addEventListener('hashchange', () => { const v = route().name; render(); if (v !== lastView) { $('#main').focus({ preventScroll: true }); scrollTo(0, 0); } lastView = v; });

function renderBand() {
  if (firstVisit) { $('#band').innerHTML = ''; return; }
  if (!data.own) { $('#band').innerHTML = '<div class="band-in"><span><b>Sample.</b> The made-up money of a fictional person, to look around.</span><span class="grow"></span><button type="button" class="lnk" data-act="reset">Reset the sample</button><button type="button" class="btn sm" data-act="start-own">Start with my own money</button></div>'; return; }
  const last = data.backupAt ? 'Last backup ' + dshort(data.backupAt.slice(0, 10)) + '.' : (data.transactions.length ? 'No backup yet.' : '');
  $('#band').innerHTML = '<div class="band-in own"><span><b>Saved on this device only.</b> ' + (ui.persisted ? 'Your browser keeps it safe. ' : '') + esc(last) + '</span><span class="grow"></span><button type="button" class="lnk" data-act="backup">Download a backup</button><button type="button" class="lnk" data-act="restore">Restore</button><button type="button" class="lnk" data-act="install">Install on your phone</button><input type="file" id="restoreFile" accept="application/json,.json" hidden></div>';
}
function welcome() {
  return '<section class="welcome"><p class="eyebrow">Expense Radar</p><h1>See where your money goes.</h1><p class="lede">Enter or import what you spend and earn. Budgets warn you before you go over, regular payments are found for you, and every figure is worked out by plain rules you can read.</p>' +
    '<div class="choices"><form class="choice main" data-form="start-own"><h2>Start with my own money</h2><p>An empty space for your own figures. It stays on this device, and you can download a backup at any time.</p><label for="cur">Currency</label><select id="cur" name="currency">' + Object.keys(E.CURRENCIES).map(c => '<option value="' + c + '">' + c + '</option>').join('') + '</select><button type="submit" class="btn">Start</button></form>' +
    '<div class="choice"><h2>Look around first</h2><p>Six months of made-up money of a fictional person. You can switch to your own at any time.</p><button type="button" class="btn ghost" data-act="start-sample">Show the sample</button></div></div>' +
    '<p class="small muted">Nothing is sent anywhere: no account, no bank connection, no tracking. Please don\'t write health, religion or politics details, or other people\'s names, in notes.</p></section>';
}
function startOwn(currency) {
  data = { ...E.emptyData(E.CURRENCIES[currency] ? currency : 'EUR'), own: true }; firstVisit = false; ui.sel.clear(); ui.imp = { step: 1 }; ui.month = THIS_MONTH;
  save(); keepSafe(); location.hash = '#/overview'; render(); toast('Your own space is ready. Add a transaction or import a CSV file.');
}
function backup() {
  const at = new Date().toISOString(); data = { ...data, backupAt: at }; save();
  download('expense-radar-backup-' + TODAY + '.json', JSON.stringify({ app: 'expense-radar', version: 1, exportedAt: at, data }, null, 1), 'application/json');
  renderBand(); toast('Backup downloaded. Keep the file somewhere safe.');
}
function restoreFrom(text) {
  let d; try { const j = JSON.parse(text); d = j && j.app === 'expense-radar' ? j.data : j; } catch (e) { toast('This file is not an Expense Radar backup.'); return; }
  if (!E.isValidData(d) || d.transactions.length > 50000) { toast('This backup could not be read. Nothing was changed.'); return; }
  confirmBox('Restore this backup?', 'It has ' + d.transactions.length + ' transactions. What is on this device now is replaced. You can undo it right after.', 'Restore', () => { commit({ ...d, own: true }, 'Backup restored.'); keepSafe(); });
}
let installEvent = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvent = e; });
function installHelp() {
  if (installEvent) { installEvent.prompt(); installEvent = null; return; }
  openForm('Install on your phone', '<p>Expense Radar works like an app: an icon on your home screen, full screen, and it opens without a connection.</p><h3>iPhone (Safari)</h3><ol><li>Open this page in Safari.</li><li>Tap the Share button.</li><li>Tap <b>Add to Home Screen</b>, then <b>Add</b>.</li></ol><h3>Android (Chrome)</h3><ol><li>Open this page in Chrome.</li><li>Tap the menu (three dots).</li><li>Tap <b>Install app</b> or <b>Add to Home screen</b>.</li></ol><p class="small muted">On an iPhone, Safari can clear a website\'s saved data after 7 days without a visit. Added to the home screen, it is kept. A backup is still a good idea.</p>', () => null, 'Done');
}

function monthPicker() {
  const min = firstMonth();
  return '<div class="month" role="group" aria-label="Month"><button type="button" data-act="month" data-n="-1" aria-label="Previous month"' + (ui.month <= min ? ' disabled' : '') + '>‹</button><span aria-live="polite">' + esc(E.monthName(ui.month)) + '</span><button type="button" data-act="month" data-n="1" aria-label="Next month"' + (ui.month >= THIS_MONTH ? ' disabled' : '') + '>›</button></div>';
}
function head(eyebrow, title, text, right = '') {
  return '<div class="ph"><div class="grow"><p class="eyebrow">' + esc(eyebrow) + '</p><h1>' + title + '</h1>' + (text ? '<p>' + text + '</p>' : '') + '</div>' + right + '</div>';
}

// ---------- charts (inline SVG, each with a table for screen readers) ----------
function trendChart(tr) {
  const W = 560; const H = 200; const top = 14; const bottom = 26; const left = 54;
  const max = Math.max(1, ...tr.map(x => Math.max(x.income, x.spent)));
  const step = niceStep(max); const ceil = Math.ceil(max / step) * step;
  const y = v => top + (H - top - bottom) * (1 - v / ceil);
  const col = (W - left) / tr.length; const bw = Math.min(18, col / 3.2);
  let g = '';
  for (let v = 0; v <= ceil; v += step) g += '<line class="grid-l" x1="' + left + '" x2="' + W + '" y1="' + y(v) + '" y2="' + y(v) + '"/><text x="' + (left - 8) + '" y="' + (y(v) + 4) + '" text-anchor="end">' + esc(short(v)) + '</text>';
  tr.forEach((x, i) => {
    const cx = left + col * i + col / 2;
    g += '<rect class="b-in" x="' + (cx - bw - 2) + '" y="' + y(x.income) + '" width="' + bw + '" height="' + (y(0) - y(x.income)) + '" rx="2"><title>Money in ' + esc(money(x.income)) + '</title></rect>';
    g += '<rect class="b-out" x="' + (cx + 2) + '" y="' + y(x.spent) + '" width="' + bw + '" height="' + (y(0) - y(x.spent)) + '" rx="2"><title>Money out ' + esc(money(x.spent)) + '</title></rect>';
    g += '<text class="lbl" x="' + cx + '" y="' + (H - 6) + '" text-anchor="middle">' + esc(E.monthName(x.month, true).split(' ')[0]) + (x.month === THIS_MONTH ? '*' : '') + '</text>';
  });
  const summary = tr.map(x => E.monthName(x.month) + ': in ' + money(x.income) + ', out ' + money(x.spent)).join('; ');
  return '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Money in and out, last six months. ' + esc(summary) + '">' + g + '</svg>' +
    '<div class="legend"><span><i class="l-in"></i>Money in</span><span><i class="l-out"></i>Money out</span>' + (tr.some(x => x.month === THIS_MONTH) ? '<span>* this month, so far</span>' : '') + '</div>' +
    '<details class="astable"><summary>Show as a table</summary><table class="tbl"><thead><tr><th>Month</th><th class="r">In</th><th class="r">Out</th><th class="r">Left</th></tr></thead><tbody>' + tr.map(x => '<tr><td>' + esc(E.monthName(x.month)) + '</td><td class="r money">' + esc(money(x.income)) + '</td><td class="r money">' + esc(money(x.spent)) + '</td><td class="r money">' + esc(money(x.balance)) + '</td></tr>').join('') + '</tbody></table></details>';
}
function niceStep(max) { const raw = max / 4; const p = Math.pow(10, Math.floor(Math.log10(raw))); return [1, 2, 2.5, 5, 10].map(m => m * p).find(s => s >= raw); }
function short(c) { const e = c / 100; return e >= 1000 ? (Math.round(e / 100) / 10) + 'k' : String(Math.round(e)); }

function catBars(list, total) {
  if (!list.length) return '<p class="muted">No spending in this month.</p>';
  const max = list[0].spent;
  return '<div class="bars">' + list.map(x => '<div class="brow"><span class="name">' + esc(x.category) + ' <small>' + E.pct(x.spent, total) + ' %</small></span><span class="amt">' + esc(money(x.spent)) + '</span><div class="track" aria-hidden="true"><span class="fill" style="width:' + (x.spent / max * 100).toFixed(1) + '%"></span></div></div>').join('') + '</div>';
}
function budgetRow(b, full) {
  const note = b.state === 'over' ? '<span class="note over">' + esc(money(b.spent - b.limit)) + ' over</span>'
    : b.state === 'pace' ? '<span class="note pace">At this pace, about ' + esc(money(b.projected, { round: true })) + ' by the end of the month</span>'
    : full ? '<span class="note">' + esc(money(b.left)) + ' left</span>' : '';
  const markAt = Math.min(100, b.expected / b.limit * 100);
  return '<div class="brow"><span class="name">' + esc(b.category) + (full ? ' <button type="button" class="lnk small" data-act="budget" data-cat="' + esc(b.category) + '">Change</button>' : '') + '</span><span class="amt">' + esc(money(b.spent)) + ' <span class="muted">of ' + esc(money(b.limit)) + '</span></span>' +
    '<div class="track" role="img" aria-label="' + esc(b.category + ': ' + b.used + ' % of the budget used') + '"><span class="fill ' + (b.state === 'ok' ? '' : b.state) + '" style="width:' + Math.min(100, b.used) + '%"></span>' + (ui.month === THIS_MONTH && b.expected > 0 && b.expected < b.limit ? '<span class="mark" style="left:' + markAt.toFixed(1) + '%" title="Where you would be on an even pace"></span>' : '') + '</div>' + note + '</div>';
}
function insightList(list, limit = 99) {
  if (!list.length) return '<p class="muted">Nothing stands out right now.</p>';
  return '<ul class="ins">' + list.slice(0, limit).map(i => '<li><span class="lv ' + i.level + '" aria-hidden="true"></span><div><b>' + esc(i.title) + '</b><p>' + esc(i.text) + '</p></div><div class="acts"><a class="lnk" href="' + esc(i.link) + '">See</a><button type="button" class="lnk" data-act="dismiss" data-id="' + esc(i.id) + '" aria-label="Hide: ' + esc(i.title) + '">Hide</button></div></li>').join('') + '</ul>';
}

// ---------- Overview ----------
// ---------- today: the reason to open the app (log in two taps, one useful number, a kind count) ----------
function quickCats() {
  const from = E.addDays(TODAY, -60); const n = {};
  for (const t of data.transactions) if (t.amount < 0 && t.date >= from && !['Housing', 'Utilities', 'Subscriptions'].includes(t.category)) n[t.category] = (n[t.category] || 0) + 1;
  const top = Object.keys(n).sort((a, b) => n[b] - n[a]);
  return [...new Set([...top, 'Groceries', 'Eating out', 'Transport', 'Shopping', 'Leisure', 'Other'])].slice(0, 6);
}
function todayBox() {
  const now = E.spentNow(data, TODAY); const pd = E.perDayLeft(data, TODAY); const lg = E.loggedDays(data, TODAY, 7); const due = E.dueNow(data, TODAY);
  const dow = new Date(TODAY + 'T00:00:00Z').getUTCDay(); const recap = [1, 2, 3].includes(dow) ? E.weekRecap(data, TODAY) : null;
  const big = pd ? '<p class="k">Left to spend today</p><p class="big money">' + esc(money(pd.perDay, { round: true })) + '</p><p class="small muted">From your budgets: ' + esc(money(pd.left, { round: true })) + ' left for ' + pd.daysLeft + (pd.daysLeft === 1 ? ' day.' : ' days.') + '</p>'
    : '<p class="k">Spent today</p><p class="big money">' + esc(money(now.today)) + '</p><p class="small muted">' + esc(money(now.week, { round: true })) + ' this week. <a href="#/budgets">Set a budget</a> to see what is left each day.</p>';
  const streak = lg.count ? 'You logged on ' + lg.count + ' of the last 7 days.' : 'A fresh start: log one thing today.';
  return '<section class="today" aria-labelledby="todayH"><h2 id="todayH" class="sr">Today</h2><div class="t-left">' + big + '</div>' +
    '<form class="quick" data-form="quick" novalidate><label for="qAmt">Log a spend</label><div class="q-row"><span class="q-cur" aria-hidden="true">' + esc(curSym()) + '</span><input id="qAmt" name="amount" inputmode="decimal" autocomplete="off" placeholder="0.00" aria-describedby="qHint"></div>' +
      '<p id="qHint" class="small muted">Type the amount, then tap what it was for.</p><div class="q-cats" role="group" aria-label="What it was for">' + quickCats().map(c => '<button type="submit" name="cat" value="' + esc(c) + '" class="chipbtn">' + esc(c) + '</button>').join('') + '</div><p class="err" id="qErr" role="alert" hidden></p></form>' +
    '<div class="t-foot"><p>' + esc(streak) + (lg.today ? '' : ' <button type="button" class="lnk" data-act="checkin">Nothing spent today</button>') + '</p><button type="button" class="lnk" data-act="reminder">Daily reminder</button></div>' +
    (due.length ? '<ul class="due">' + due.slice(0, 3).map(d => '<li><span><b>' + esc(d.payee) + '</b> ' + esc(money(d.amount)) + ' is usually paid around ' + esc(dshort(d.next)) + '.</span><span class="grow"></span><button type="button" class="btn sm" data-act="due-log" data-id="' + esc(d.id) + '">Log it</button><button type="button" class="lnk" data-act="dismiss" data-id="' + esc(d.id) + '">Not this time</button></li>').join('') + '</ul>' : '') +
    (recap ? '<p class="recap"><b>Last week</b> you spent ' + esc(money(recap.spent, { round: true })) + (recap.before ? ' (' + esc(money(Math.abs(recap.spent - recap.before), { round: true })) + (recap.spent <= recap.before ? ' less' : ' more') + ' than the week before)' : '') + '. Most went to ' + esc(recap.top.toLowerCase()) + '.</p>' : '') +
    '</section>';
}
function quickLog(form, cat) {
  const cents = E.toCents(form.amount.value); const err = $('#qErr');
  if (cents === null || cents <= 0) { err.textContent = 'Type the amount first, for example 12.50.'; err.hidden = false; form.amount.setAttribute('aria-invalid', 'true'); form.amount.focus(); return; }
  const tx = { id: 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), date: TODAY, payee: cat, amount: -cents, category: cat, note: '' };
  const r = E.upsertTx(data, tx); if (r.errors && Object.keys(r.errors).length) { err.textContent = Object.values(r.errors)[0]; err.hidden = false; return; }
  commit(r.data, 'Logged: ' + money(cents) + ' for ' + cat.toLowerCase() + '.'); const a = $('#qAmt'); if (a) a.focus();
}
function reminderForm() {
  openForm('A daily reminder', '<p>Pick a time. Your phone\'s calendar then reminds you every day to log what you spent. Nothing is sent anywhere, and you can delete the event at any time.</p>' + field('time', 'Time', '<input id="f-time" name="time" type="time" value="20:30" required>'), fd => {
    const url = location.href.split('#')[0] + '#/overview';
    download('expense-radar-reminder.ics', E.reminderIcs(String(fd.get('time') || '20:30'), url, TODAY, 'r' + Date.now().toString(36)), 'text/calendar');
    toast('Open the downloaded file to add the reminder to your calendar.'); return null;
  }, 'Add to my calendar');
}
function overview() {
  const m = ui.month; const prev = E.addMonths(m, -1);
  const t = E.totals(E.inMonth(data.transactions, m)); const p = E.totals(E.inMonth(data.transactions, prev));
  const isNow = m === THIS_MONTH;
  const delta = (a, b, goodUp) => { if (!b) return '<span class="muted">—</span>'; const d = a - b; const word = d === 0 ? 'same as' : d > 0 ? 'more than' : 'less than'; return esc(money(Math.abs(d), { round: true })) + ' ' + word + ' ' + esc(E.monthName(prev).split(' ')[0]); };
  const all = E.insights({ ...data }, isNow ? TODAY : E.addDays(E.addMonths(m, 1) + '-01', -1));
  const bs = E.budgetStatus(data, m, TODAY);
  const rec = E.detectRecurring(data.transactions, TODAY).filter(r => !r.stopped && r.next >= TODAY && E.dayDiff(TODAY, r.next) <= 14);
  const manual = data.subscriptions.filter(s => s.next >= TODAY && E.dayDiff(TODAY, s.next) <= 14).map(s => ({ payee: s.name, amount: s.amount, next: s.next }));
  const soon = [...rec, ...manual].sort((a, b) => a.next.localeCompare(b.next));
  const cats = E.byCategory(E.inMonth(data.transactions, m));
  const say = !data.transactions.length ? 'Add your first expense, or import a file from your bank.'
    : t.income === 0 && isNow ? 'So far ' + money(t.spent, { round: true }) + ' went out this month. Your income usually arrives later in the month.'
    : t.balance >= 0 ? 'You kept ' + money(t.balance, { round: true }) + ' of ' + money(t.income, { round: true }) + (isNow ? ' so far this month.' : '.')
    : 'You spent ' + money(-t.balance, { round: true }) + ' more than came in' + (isNow ? ' so far this month.' : '.');
  return (isNow ? todayBox() : '') + head(isNow ? 'This month' : 'Overview', esc(E.monthName(m)), esc(say), monthPicker()) +
    '<section class="figs" aria-label="This month in figures">' +
      '<div class="fig"><div class="k">Money in</div><div class="v' + (t.income > 0 ? ' pos' : '') + '">' + esc(money(t.income)) + '</div><div class="d">' + delta(t.income, p.income) + '</div></div>' +
      '<div class="fig"><div class="k">Money out</div><div class="v">' + esc(money(t.spent)) + '</div><div class="d">' + delta(t.spent, p.spent) + '</div></div>' +
      '<div class="fig"><div class="k">Left</div><div class="v">' + esc(money(t.balance)) + '</div><div class="d">In minus out</div></div>' +
      '<div class="fig"><div class="k">Kept</div><div class="v">' + (t.savingsRate === null ? '—' : Math.max(0, t.savingsRate) + ' %') + '</div><div class="d">' + (t.savingsRate === null ? 'No income yet this month' : 'of the money that came in') + '</div></div>' +
    '</section>' +
    '<div class="grid g2"><section class="card"><div class="ch"><h2>Six months</h2></div>' + trendChart(E.trend(data.transactions, m, 6)) + '</section>' +
      '<section class="card"><div class="ch"><h2>What stands out</h2><span class="sub">' + all.length + '</span></div>' + insightList(all, 5) + '</section></div>' +
    '<div class="grid g2e" style="margin-top:16px"><section class="card"><div class="ch"><h2>Budgets</h2><span class="grow"></span><a class="lnk small" href="#/budgets">All budgets</a></div>' + (bs.length ? '<div class="bars">' + bs.slice(0, 4).map(b => budgetRow(b, false)).join('') + '</div>' : '<p class="muted">No budgets yet. <a class="lnk" href="#/budgets">Set one</a>.</p>') + '</section>' +
      '<section class="card"><div class="ch"><h2>Coming up</h2><span class="sub">next 14 days</span></div>' + (soon.length ? '<table class="tbl"><tbody>' + soon.slice(0, 6).map(s => '<tr><td>' + esc(dshort(s.next)) + '</td><td>' + esc(s.payee) + '</td><td class="r money">' + esc(money(-s.amount)) + '</td></tr>').join('') + '</tbody></table>' : '<p class="muted">No regular payment is due in the next 14 days.</p>') + '</section></div>' +
    '<section class="card" style="margin-top:16px"><div class="ch"><h2>Where it went</h2><span class="sub">' + esc(money(t.spent)) + '</span><span class="grow"></span><a class="lnk small" href="#/analysis">Analysis</a></div>' + catBars(cats.slice(0, 8), t.spent) + '</section>';
}

// ---------- Transactions ----------
function filtered() {
  const q = ui.q.trim().toLowerCase();
  let list = data.transactions.filter(t => (!ui.tmonth || E.monthOf(t.date) === ui.tmonth) && (!ui.cat || t.category === ui.cat) && (ui.type === 'all' || (ui.type === 'out' ? t.amount < 0 : t.amount > 0)) &&
    (!q || (t.payee + ' ' + t.note + ' ' + t.category).toLowerCase().includes(q) || E.formatMoney(Math.abs(t.amount)).includes(q)));
  const { k, dir } = ui.sort;
  list = [...list].sort((a, b) => (k === 'amount' ? a.amount - b.amount : k === 'payee' ? a.payee.localeCompare(b.payee) : k === 'category' ? a.category.localeCompare(b.category) : a.date.localeCompare(b.date)) * dir || b.date.localeCompare(a.date));
  return list;
}
function transactions() {
  const list = filtered(); const shown = list.slice(0, 100 + ui.more);
  const months = [...new Set(data.transactions.map(t => E.monthOf(t.date)))].sort().reverse();
  const tt = E.totals(list);
  const th = (k, l, cls = '') => '<th class="' + cls + '" aria-sort="' + (ui.sort.k === k ? (ui.sort.dir > 0 ? 'ascending' : 'descending') : 'none') + '"><button type="button" data-act="sort" data-k="' + k + '">' + l + (ui.sort.k === k ? (ui.sort.dir > 0 ? ' ↑' : ' ↓') : '') + '</button></th>';
  const sel = [...ui.sel].filter(id => data.transactions.some(t => t.id === id));
  return head('Transactions', 'Every payment', data.transactions.length + ' transactions. Click one to change it.', '<div class="row"><button class="btn ghost" data-act="export">Download CSV</button><button class="btn" data-act="add">+ Add</button></div>') +
    '<div class="tools" role="search"><label class="sr" for="q">Search</label><input id="q" type="search" data-q placeholder="Search payee, note, category or amount" value="' + esc(ui.q) + '">' +
      '<label class="sr" for="fcat">Category</label><select id="fcat" data-f="cat"><option value="">All categories</option>' + E.CATEGORIES.map(c => '<option' + (ui.cat === c ? ' selected' : '') + '>' + esc(c) + '</option>').join('') + '</select>' +
      '<label class="sr" for="fmonth">Month</label><select id="fmonth" data-f="tmonth"><option value="">All months</option>' + months.map(mm => '<option value="' + mm + '"' + (ui.tmonth === mm ? ' selected' : '') + '>' + esc(E.monthName(mm)) + '</option>').join('') + '</select>' +
      '<div class="seg" role="group" aria-label="Kind">' + [['all', 'All'], ['out', 'Money out'], ['in', 'Money in']].map(([k, l]) => '<button type="button" data-act="type" data-k="' + k + '" aria-pressed="' + (ui.type === k) + '">' + l + '</button>').join('') + '</div>' +
      (ui.q || ui.cat || ui.tmonth || ui.type !== 'all' ? '<button type="button" class="lnk small" data-act="clear">Clear</button>' : '') + '</div>' +
    (sel.length ? '<div class="sel-bar" role="region" aria-label="Selected"><b>' + sel.length + ' selected</b><button class="lnk" data-act="bulk-cat">Change category</button><button class="lnk" data-act="bulk-del">Delete</button><span class="grow"></span><button class="lnk" data-act="sel-none">Unselect</button></div>' : '') +
    '<section class="card" style="padding:6px 14px">' + (list.length ? '<div class="tbl-wrap"><table class="tbl resp"><caption class="sr">Transactions, ' + list.length + ' shown</caption><thead><tr><th class="ck"><input type="checkbox" data-act="sel-all" aria-label="Select all shown"' + (shown.length && shown.every(t => ui.sel.has(t.id)) ? ' checked' : '') + '></th>' + th('date', 'Date') + th('payee', 'Payee') + th('category', 'Category') + th('amount', 'Amount', 'r') + '<th><span class="sr">Change</span></th></tr></thead><tbody>' +
      shown.map(t => '<tr><td class="ck"><input type="checkbox" data-act="sel" data-id="' + esc(t.id) + '" aria-label="Select ' + esc(t.payee + ', ' + t.date) + '"' + (ui.sel.has(t.id) ? ' checked' : '') + '></td><td class="date">' + esc(dshort(t.date)) + '</td><td class="payee"><b>' + esc(t.payee) + '</b>' + (t.note ? '<small>' + esc(t.note) + '</small>' : '') + '</td><td class="cat">' + esc(t.category) + '</td><td class="r money' + (t.amount > 0 ? ' pos' : '') + '">' + esc(money(t.amount, { sign: true })) + '</td><td class="acts r"><button type="button" class="lnk small" data-act="edit" data-id="' + esc(t.id) + '" aria-label="Change ' + esc(t.payee + ', ' + t.date) + '">Change</button></td></tr>').join('') +
      '</tbody><tfoot><tr><td></td><td colspan="3">' + list.length + ' shown · in ' + esc(money(tt.income)) + ' · out ' + esc(money(tt.spent)) + '</td><td class="r money">' + esc(money(tt.balance, { sign: true })) + '</td><td></td></tr></tfoot></table></div>' + (list.length > shown.length ? '<p class="row" style="padding:10px 0"><button class="btn ghost sm" data-act="more">Show ' + Math.min(100, list.length - shown.length) + ' more</button></p>' : '')
      : '<div class="empty"><h3>' + (data.transactions.length ? 'Nothing matches' : 'No transactions yet') + '</h3><p>' + (data.transactions.length ? 'Try another word, or clear the filters.' : 'Add one, or import a CSV file from your bank.') + '</p>' + (data.transactions.length ? '<button class="btn ghost" data-act="clear">Clear the filters</button>' : '<div class="row" style="justify-content:center"><button class="btn" data-act="add">+ Add</button><a class="btn ghost" href="#/import">Import a file</a></div>') + '</div>') + '</section>';
}

// ---------- Budgets ----------
function budgets() {
  const m = ui.month; const bs = E.budgetStatus(data, m, TODAY);
  const f = E.forecast(data.transactions, THIS_MONTH);
  const unset = SPEND.filter(c => !data.budgets[c]);
  const tot = { limit: E.sum(bs.map(b => b.limit)), spent: E.sum(bs.map(b => b.spent)) };
  const over = bs.filter(b => b.state === 'over').length; const pace = bs.filter(b => b.state === 'pace').length;
  return head('Budgets', 'Monthly budgets', esc(over ? over + (over === 1 ? ' budget is' : ' budgets are') + ' over in ' + E.monthName(m) + '.' : 'No budget is over in ' + E.monthName(m) + '.') + (pace ? ' ' + pace + ' may go over at this pace.' : '') + ' The line on a bar shows where an even pace would be today.', monthPicker()) +
    '<section class="figs f3" aria-label="Budgets in figures"><div class="fig"><div class="k">Planned</div><div class="v">' + esc(money(tot.limit)) + '</div></div><div class="fig"><div class="k">Spent in these categories</div><div class="v">' + esc(money(tot.spent)) + '</div></div><div class="fig"><div class="k">' + (tot.limit >= tot.spent ? 'Left' : 'Over') + '</div><div class="v' + (tot.limit < tot.spent ? ' neg-over' : '') + '">' + esc(money(Math.abs(tot.limit - tot.spent))) + '</div></div></section>' +
    '<div class="grid g2"><section class="card"><div class="ch"><h2>Your budgets</h2><span class="sub">' + bs.length + '</span></div>' + (bs.length ? '<div class="bars">' + bs.map(b => budgetRow(b, true)).join('') + '</div>' : '<p class="muted">No budgets yet. Pick a category on the right.</p>') + '</section>' +
    '<section class="card"><div class="ch"><h2>Add a budget</h2></div><p class="muted small">The suggestion is your average for the last three months, an estimate.</p><table class="tbl"><tbody>' + unset.map(c => { const e = f.ready ? (f.perCategory.find(x => x.category === c) || {}).estimate || 0 : 0; return '<tr><td>' + esc(c) + '</td><td class="r money muted">' + (e ? esc(money(e, { round: true })) : '—') + '</td><td class="r"><button type="button" class="lnk small" data-act="budget" data-cat="' + esc(c) + '">Set</button></td></tr>'; }).join('') + '</tbody></table></section></div>';
}

// ---------- Regular payments ----------
function recurring() {
  const rec = E.detectRecurring(data.transactions, TODAY); const live = rec.filter(r => !r.stopped);
  const yearly = E.sum(live.map(r => r.yearly)) + E.sum(data.subscriptions.map(E.subscriptionYearly));
  return head('Regular payments', 'What comes back on its own', 'Found in your history: the same payee, a similar amount, at a regular gap, at least three times. Add the ones that are paid rarely, like a yearly plan.', '<button class="btn" data-act="sub-add">+ Add a subscription</button>') +
    '<section class="figs f3"><div class="fig"><div class="k">Each month, on average</div><div class="v">' + esc(money(Math.round(yearly / 12))) + '</div></div><div class="fig"><div class="k">Each year</div><div class="v">' + esc(money(yearly)) + '</div></div><div class="fig"><div class="k">Payments</div><div class="v">' + (live.length + data.subscriptions.length) + '</div><div class="d">' + rec.filter(r => r.stopped).length + ' seem to have stopped</div></div></section>' +
    '<section class="card" style="padding:6px 14px"><div class="tbl-wrap"><table class="tbl"><caption class="sr">Regular payments found in your history</caption><thead><tr><th>Payee</th><th>How often</th><th class="r">Amount</th><th>Next</th><th class="r">A year</th><th><span class="sr">Note</span></th></tr></thead><tbody>' +
      rec.map(r => '<tr><td><b>' + esc(r.payee) + '</b><br><small class="muted">' + esc(r.category) + ' · seen ' + r.count + ' times</small></td><td>' + r.cadence + '</td><td class="r money">' + esc(money(r.amount)) + '</td><td>' + (r.stopped ? '<span class="chip">Stopped?</span>' : esc(dshort(r.next))) + '</td><td class="r money">' + (r.stopped ? '—' : esc(money(r.yearly))) + '</td><td>' + (r.priceChange > 0 ? '<span class="chip pace">Up ' + esc(money(r.priceChange)) + '</span>' : '') + '</td></tr>').join('') +
      data.subscriptions.map(s => '<tr><td><b>' + esc(s.name) + '</b><br><small class="muted">' + esc(s.category) + ' · added by you</small></td><td>' + s.cadence + '</td><td class="r money">' + esc(money(s.amount)) + '</td><td>' + esc(dshort(s.next)) + '</td><td class="r money">' + esc(money(E.subscriptionYearly(s))) + '</td><td class="r"><button type="button" class="lnk small" data-act="sub-del" data-id="' + esc(s.id) + '">Remove</button></td></tr>').join('') +
      (!rec.length && !data.subscriptions.length ? '<tr><td colspan="6" class="muted">Nothing yet. With a few months of history, regular payments show up here on their own.</td></tr>' : '') +
    '</tbody></table></div></section>';
}

// ---------- Analysis ----------
function analysis() {
  const m = ui.month; const prev = E.addMonths(m, -1);
  const mom = E.monthOnMonth(data.transactions, m);
  const odd = E.unusual(data.transactions, m, m === THIS_MONTH ? TODAY : m + '-28');
  const f = E.forecast(data.transactions, m);
  const sofar = E.totals(E.inMonth(data.transactions, m));
  return head('Analysis', 'Where the money goes', 'Categories against the month before, expenses that are far from usual, and an estimate.', monthPicker()) +
    '<div class="grid g2"><section class="card" style="padding-bottom:8px"><div class="ch"><h2>' + esc(E.monthName(m)) + ' against ' + esc(E.monthName(prev).split(' ')[0]) + '</h2></div>' + (mom.length ? '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Category</th><th class="r">' + esc(E.monthName(prev, true).split(' ')[0]) + '</th><th class="r">' + esc(E.monthName(m, true).split(' ')[0]) + '</th><th class="r">Change</th></tr></thead><tbody>' +
      mom.map(x => '<tr><td>' + esc(x.category) + '</td><td class="r money">' + esc(money(x.before)) + '</td><td class="r money">' + esc(money(x.now)) + '</td><td class="r money">' + (x.change === 0 ? '—' : esc(money(x.change, { sign: true })) + (x.changePct !== null ? ' <small class="muted">' + (x.changePct > 0 ? '+' : '') + x.changePct + ' %</small>' : '')) + '</td></tr>').join('') + '</tbody></table></div>' : '<p class="muted">No spending in these two months.</p>') + '</section>' +
    '<div class="grid" style="align-content:start"><section class="card"><div class="ch"><h2>Unusual expenses</h2><span class="sub">' + odd.length + '</span></div>' + (odd.length ? '<ul class="ins">' + odd.map(u => '<li><span class="lv mid" aria-hidden="true"></span><div><b>' + esc(money(-u.tx.amount)) + ' at ' + esc(u.tx.payee) + '</b><p>' + esc(dlong(u.tx.date)) + '. About ' + u.times + ' times a usual ' + esc(u.tx.category.toLowerCase()) + ' expense (' + esc(money(u.usual)) + ').</p></div><div class="acts"><a class="lnk" href="#/transactions?q=' + encodeURIComponent(u.tx.payee) + '">See</a></div></li>').join('') + '</ul>' : '<p class="muted">Nothing far from usual this month.</p>') +
      '<p class="muted small">The rule: more than twice the usual amount for the category, and above its usual range (median plus three times the typical spread). It needs five earlier expenses in the category; regular payments are left out.</p></section>' +
      '<section class="card"><div class="ch"><h2>' + esc(E.monthName(m)) + '</h2><span class="est">Estimate</span></div>' + (f.ready ? '<dl class="kv"><dt>Usual money in</dt><dd class="money">' + esc(money(f.income, { round: true })) + '</dd><dt>Usual money out</dt><dd class="money">' + esc(money(f.spent, { round: true })) + '</dd><dt>' + (m === THIS_MONTH ? 'Out so far' : 'Actually out') + '</dt><dd class="money">' + esc(money(sofar.spent, { round: true })) + '</dd></dl><p class="muted small">The average of ' + f.months.map(x => E.monthName(x).split(' ')[0]).reverse().join(', ') + ', per category. A guide, not a promise.</p>' : '<p class="muted">An estimate needs three months of history before this one (' + f.have + ' so far).</p>') + '</section></div></div>' +
    '<section class="card" style="margin-top:16px"><div class="ch"><h2>All that stands out</h2></div>' + insightList(E.insights(data, m === THIS_MONTH ? TODAY : E.addDays(E.addMonths(m, 1) + '-01', -1))) + '</section>';
}

// ---------- Import ----------
const EXAMPLE = 'Booking date;Description;Amount;Currency\n' + [[-2, 'FRESHMART 0042', '-64,30'], [-3, 'Olive & Thyme', '-27,80'], [-4, 'RideNow trip 88213', '-9,40'], [-5, 'Refund Threads & Co', '19,99'], [-6, 'Bookhouse', '-23,50'], [-6, 'Bookhouse', '-23,50'], [-8, 'Café Lumen', 'twelve'], [-9, 'Daily Fruit', '-6,20']]
  .map(([d, p, a]) => { const x = E.addDays(TODAY, d); return x.slice(8, 10) + '.' + x.slice(5, 7) + '.' + x.slice(0, 4) + ';' + p + ';' + a + ';EUR'; }).join('\n');
function importView() {
  const s = ui.imp; const steps = ['Choose a file', 'Match the columns', 'Check', 'Done'];
  const bar = '<ol class="steps">' + steps.map((x, i) => '<li' + (s.step === i + 1 ? ' aria-current="step"' : s.step > i + 1 ? ' class="done"' : '') + '>' + (i + 1) + '. ' + x + '</li>').join('') + '</ol>';
  let body = '';
  if (s.step === 1) body = '<section class="card"><div class="drop" id="drop"><p><b>Drop a CSV file from your bank here</b></p><p class="muted small">Or choose it. It is read in this browser only and never sent anywhere. Up to 2 MB.</p><p><label class="btn ghost" for="file">Choose a file</label><input id="file" type="file" accept=".csv,text/csv,text/plain" class="sr"></p></div>' +
    '<div class="fld" style="margin-top:16px"><label for="paste">Or paste the rows</label><textarea id="paste" class="paste" placeholder="Date;Description;Amount">' + esc(s.text || '') + '</textarea></div><div class="row"><button class="btn" data-act="imp-read">Next</button><button class="lnk" data-act="imp-example">Try an example file</button></div></section>';
  if (s.step === 2) {
    const hdr = s.rows[0] || []; const col = (k, label, optional) => '<div class="fld"><label for="m-' + k + '">' + label + '</label><select id="m-' + k + '" data-map="' + k + '">' + (optional ? '<option value="-1">None</option>' : '<option value="-1">Choose a column</option>') + hdr.map((h, i) => '<option value="' + i + '"' + (s.map[k] === i ? ' selected' : '') + '>' + esc(s.opts.hasHeader ? h || 'Column ' + (i + 1) : 'Column ' + (i + 1) + ' (' + String(h).slice(0, 16) + ')') + '</option>').join('') + '</select></div>';
    body = '<section class="card"><p class="muted">' + (s.rows.length - (s.opts.hasHeader ? 1 : 0)) + ' rows found, separated by “' + (s.delim === '\t' ? 'tab' : s.delim) + '”. Say which column holds what.</p><div class="map">' + col('date', 'Date') + col('payee', 'Payee or description') + col('amount', 'Amount (one column)', true) + col('debit', 'Or: money out column', true) + col('credit', 'And: money in column', true) + col('category', 'Category', true) + '</div>' +
      '<div class="map"><div class="fld"><label for="o-df">Dates are written</label><select id="o-df" data-opt="dateFormat"><option value="DMY"' + (s.opts.dateFormat === 'DMY' ? ' selected' : '') + '>Day first (17.11.2026)</option><option value="MDY"' + (s.opts.dateFormat === 'MDY' ? ' selected' : '') + '>Month first (11/17/2026)</option></select></div>' +
      '<div class="fld"><label for="o-dc">Category when there is none</label><select id="o-dc" data-opt="defaultCategory">' + SPEND.map(c => '<option' + (s.opts.defaultCategory === c ? ' selected' : '') + '>' + c + '</option>').join('') + '</select></div>' +
      '<div class="fld"><span class="lbl">This file</span><label class="row small"><input type="checkbox" data-opt="hasHeader"' + (s.opts.hasHeader ? ' checked' : '') + '> The first row holds column names</label><label class="row small"><input type="checkbox" data-opt="signFlip"' + (s.opts.signFlip ? ' checked' : '') + '> Spending is written as positive numbers</label></div></div>' +
      '<p class="err" id="mapErr" hidden></p><div class="row"><button class="btn ghost" data-act="imp-back">Back</button><button class="btn" data-act="imp-check">Check the rows</button></div></section>';
  }
  if (s.step === 3) {
    const ok = s.prep.filter(r => !r.errors.length && !r.duplicate); const dup = s.prep.filter(r => !r.errors.length && r.duplicate); const bad = s.prep.filter(r => r.errors.length);
    const add = ok.length + dup.filter(r => s.keepDup.has(r.line)).length;
    body = '<section class="figs f3"><div class="fig"><div class="k">Ready to add</div><div class="v pos">' + ok.length + '</div></div><div class="fig"><div class="k">Already there or twice</div><div class="v">' + dup.length + '</div><div class="d">Left out unless you tick them</div></div><div class="fig"><div class="k">Cannot be used</div><div class="v' + (bad.length ? ' neg-over' : '') + '">' + bad.length + '</div><div class="d">Each one says why</div></div></section>' +
      '<section class="card" style="padding:6px 14px"><div class="tbl-wrap"><table class="tbl pre"><caption class="sr">Rows of the file, checked</caption><thead><tr><th>Line</th><th>Date</th><th>Payee</th><th>Category</th><th class="r">Amount</th><th>Check</th></tr></thead><tbody>' +
      s.prep.map(r => '<tr class="' + (r.errors.length || (r.duplicate && !s.keepDup.has(r.line)) ? 'skip' : '') + '"><td class="num">' + r.line + '</td><td>' + esc(r.tx.date ? dshort(r.tx.date) : '—') + '</td><td>' + esc(r.tx.payee || '—') + '</td><td>' + esc(r.tx.category) + '</td><td class="r money">' + (r.tx.amount ? esc(money(r.tx.amount, { sign: true })) : '—') + '</td><td class="why">' + (r.errors.length ? '<span class="err">Not added: ' + esc(r.errors.join(', ')) + '</span>' : r.duplicate ? '<label class="row small"><input type="checkbox" data-act="imp-keep" data-line="' + r.line + '"' + (s.keepDup.has(r.line) ? ' checked' : '') + '> Add anyway (' + esc(r.duplicate) + ')</label>' : '<span class="chip in">Ready</span>') + '</td></tr>').join('') +
      '</tbody></table></div></section><div class="row" style="margin-top:14px"><button class="btn ghost" data-act="imp-back">Back</button><button class="btn" data-act="imp-go"' + (add ? '' : ' disabled') + '>Add ' + add + ' transaction' + (add === 1 ? '' : 's') + '</button></div>';
  }
  if (s.step === 4) body = '<section class="card"><div class="empty"><h3>' + s.added + ' transactions added</h3><p>They are in your transactions, budgets and analysis now.</p><div class="row" style="justify-content:center"><a class="btn" href="#/transactions">See transactions</a><button class="btn ghost" data-act="imp-undo">Undo the import</button><button class="lnk" data-act="imp-new">Import another file</button></div></div></section>';
  return head('Import', 'Bring in a bank file', 'A CSV file from any bank: you match the columns, every row is checked, rows that are already there are found, and nothing is added until you confirm.') + bar + body;
}
function readImport(text) {
  if (!text.trim()) { toast('Choose a file or paste some rows first.'); return; }
  if (text.length > 2_000_000) { toast('This file is larger than 2 MB.'); return; }
  const delim = E.detectDelimiter(text); const rows = E.parseCsv(text, delim);
  if (rows.length < 1) { toast('No rows were found.'); return; }
  if (rows.length > 5001) { toast('Up to 5,000 rows at a time.'); return; }
  const map = E.guessMapping(rows[0]); const hasHeader = map.date >= 0 || map.amount >= 0 || map.payee >= 0;
  if (!hasHeader) Object.assign(map, { date: 0, payee: 1, amount: 2, debit: -1, credit: -1, category: -1 });
  const sample = rows.slice(hasHeader ? 1 : 0, 20).map(r => r[map.date]).join(' ');
  ui.imp = { step: 2, text, rows, delim, map, opts: { hasHeader, dateFormat: /\b(1[3-9]|2\d|3[01])[./-]\d{1,2}[./-]\d{4}\b/.test(sample) || !/\b\d{1,2}\/(1[3-9]|2\d|3[01])\/\d{4}\b/.test(sample) ? 'DMY' : 'MDY', defaultCategory: 'Other', signFlip: false } };
  render();
}

// ---------- Reports ----------
function period() {
  const p = ui.period;
  if (p === 'this') return [THIS_MONTH + '-01', TODAY, E.monthName(THIS_MONTH) + ' so far'];
  if (p === 'last') { const m = E.addMonths(THIS_MONTH, -1); return [m + '-01', m + '-' + E.daysInMonth(m), E.monthName(m)]; }
  if (p === '3m') { const a = E.addMonths(THIS_MONTH, -3); const b = E.addMonths(THIS_MONTH, -1); return [a + '-01', b + '-' + E.daysInMonth(b), E.monthName(a) + ' to ' + E.monthName(b)]; }
  if (p === 'year') return [TODAY.slice(0, 4) + '-01-01', TODAY, TODAY.slice(0, 4) + ' so far'];
  const from = E.isDate(ui.from) ? ui.from : THIS_MONTH + '-01'; const to = E.isDate(ui.to) ? ui.to : TODAY;
  return [from, to, dlong(from) + ' to ' + dlong(to)];
}
function reports() {
  const [from, to, label] = period();
  const list = data.transactions.filter(t => t.date >= from && t.date <= to).sort((a, b) => a.date.localeCompare(b.date));
  const t = E.totals(list); const cats = E.byCategory(list);
  const incomes = new Map(); list.filter(x => x.amount > 0).forEach(x => incomes.set(x.category, (incomes.get(x.category) || 0) + x.amount));
  const top = [...list].filter(x => x.amount < 0).sort((a, b) => a.amount - b.amount).slice(0, 5);
  return head('Reports', 'Report: ' + esc(label), list.length + ' transactions from ' + esc(dlong(from)) + ' to ' + esc(dlong(to)) + '.', '<div class="row no-print"><button class="btn ghost" data-act="report-csv">Download CSV</button><button class="btn" data-act="print">Print or save as PDF</button></div>') +
    '<div class="tools no-print"><div class="seg" role="group" aria-label="Period">' + [['this', 'This month'], ['last', 'Last month'], ['3m', 'Last 3 months'], ['year', 'This year'], ['custom', 'Dates']].map(([k, l]) => '<button type="button" data-act="period" data-k="' + k + '" aria-pressed="' + (ui.period === k) + '">' + l + '</button>').join('') + '</div>' +
      (ui.period === 'custom' ? '<label class="sr" for="rf">From</label><input id="rf" type="date" data-r="from" value="' + esc(from) + '"><label class="sr" for="rt">To</label><input id="rt" type="date" data-r="to" value="' + esc(to) + '">' : '') + '</div>' +
    '<section class="figs"><div class="fig"><div class="k">Money in</div><div class="v pos">' + esc(money(t.income)) + '</div></div><div class="fig"><div class="k">Money out</div><div class="v">' + esc(money(t.spent)) + '</div></div><div class="fig"><div class="k">Left</div><div class="v">' + esc(money(t.balance)) + '</div></div><div class="fig"><div class="k">Kept</div><div class="v">' + (t.savingsRate === null ? '—' : Math.max(0, t.savingsRate) + ' %') + '</div></div></section>' +
    '<div class="grid g2"><section class="card" style="padding-bottom:8px"><div class="ch"><h2>Spending by category</h2></div><table class="tbl"><thead><tr><th>Category</th><th class="r">Amount</th><th class="r">Share</th></tr></thead><tbody>' + (cats.map(c => '<tr><td>' + esc(c.category) + '</td><td class="r money">' + esc(money(c.spent)) + '</td><td class="r num">' + E.pct(c.spent, t.spent) + ' %</td></tr>').join('') || '<tr><td colspan="3" class="muted">No spending in this period.</td></tr>') + '</tbody><tfoot><tr><td>Total</td><td class="r money">' + esc(money(t.spent)) + '</td><td class="r num">100 %</td></tr></tfoot></table></section>' +
    '<div class="grid" style="align-content:start"><section class="card"><div class="ch"><h2>Money in</h2></div><table class="tbl"><tbody>' + ([...incomes.entries()].map(([c, v]) => '<tr><td>' + esc(c) + '</td><td class="r money">' + esc(money(v)) + '</td></tr>').join('') || '<tr><td class="muted">Nothing came in during this period.</td></tr>') + '</tbody></table></section>' +
    '<section class="card"><div class="ch"><h2>Largest expenses</h2></div><table class="tbl"><tbody>' + (top.map(x => '<tr><td>' + esc(dshort(x.date)) + '</td><td>' + esc(x.payee) + '</td><td class="r money">' + esc(money(-x.amount)) + '</td></tr>').join('') || '<tr><td class="muted">None.</td></tr>') + '</tbody></table></section></div></div>';
}

// ---------- dialogs ----------
const dlg = $('#dlg');
function field(name, label, control, hint = '') { return '<div class="fld"><label for="f-' + name + '">' + label + '</label>' + control + (hint ? '<small class="hint">' + hint + '</small>' : '') + '<small class="err" id="e-' + name + '" hidden></small></div>'; }
function openForm(title, body, onSubmit, submitLabel = 'Save', extra = '') {
  dlg.innerHTML = '<form class="form" novalidate><header><h2 id="dlgTitle">' + esc(title) + '</h2></header><div class="body">' + body + '</div><footer>' + extra + '<span class="grow"></span><button type="button" class="btn ghost" data-close>Cancel</button><button type="submit" class="btn">' + esc(submitLabel) + '</button></footer></form>';
  const form = dlg.querySelector('form');
  form.addEventListener('submit', e => {
    e.preventDefault(); $$('.err', form).forEach(x => { x.hidden = true; }); $$('[aria-invalid]', form).forEach(x => x.removeAttribute('aria-invalid'));
    const errs = onSubmit(new FormData(form));
    if (errs && Object.keys(errs).length) { let first; for (const [k, v] of Object.entries(errs)) { const el = $('#e-' + k, form); const c = form.elements[k]; if (el) { el.textContent = v; el.hidden = false; } if (c && c.setAttribute) { c.setAttribute('aria-invalid', 'true'); c.setAttribute('aria-describedby', 'e-' + k); first = first || c; } } (first || form.querySelector('input,select')).focus(); return; }
    dlg.close();
  });
  $$('[data-close]', dlg).forEach(b => b.addEventListener('click', () => dlg.close()));
  dlg.showModal();
  const f = form.querySelector('[autofocus]') || form.querySelector('input:not([type=radio]),select'); if (f) f.focus();
}
function confirmBox(title, text, ok, onOk) { openForm(title, '<p>' + esc(text) + '</p>', () => { onOk(); return null; }, ok); }
function txForm(t) {
  const isNew = !t; t = t || { date: TODAY, payee: '', amount: -0, category: 'Groceries', note: '' };
  const out = !isNew ? t.amount < 0 : true;
  const amt = isNew ? '' : (Math.abs(t.amount) / 100).toFixed(2);
  const payees = [...new Set(data.transactions.map(x => x.payee))].slice(0, 200);
  const catOpts = list => list.map(c => '<option' + (t.category === c ? ' selected' : '') + '>' + esc(c) + '</option>').join('');
  openForm(isNew ? 'Add a transaction' : 'Change a transaction',
    '<fieldset class="kind" style="border:0;padding:0;margin:0 0 14px"><legend class="sr">Kind</legend><label><input type="radio" name="kind" value="out"' + (out ? ' checked' : '') + '>Money out</label><label><input type="radio" name="kind" value="in"' + (!out ? ' checked' : '') + '>Money in</label></fieldset>' +
    '<div class="two">' + field('amount', 'Amount (' + curSym() + ')', '<input id="f-amount" name="amount" inputmode="decimal" autocomplete="off" value="' + esc(amt) + '" placeholder="0.00" autofocus>') + field('date', 'Date', '<input id="f-date" name="date" type="date" value="' + esc(t.date) + '" max="' + E.addDays(TODAY, 366) + '">') + '</div>' +
    field('payee', 'Payee', '<input id="f-payee" name="payee" list="payees" maxlength="80" value="' + esc(t.payee) + '" autocomplete="off">', 'Who you paid, or who paid you.') + '<datalist id="payees">' + payees.map(p => '<option value="' + esc(p) + '">').join('') + '</datalist>' +
    field('category', 'Category', '<select id="f-category" name="category"><optgroup label="Spending">' + catOpts(SPEND) + '</optgroup><optgroup label="Income">' + catOpts(E.INCOME_CATEGORIES) + '</optgroup></select>') +
    field('note', 'Note', '<input id="f-note" name="note" maxlength="200" value="' + esc(t.note) + '">', 'Optional.'),
    fd => {
      const cents = E.toCents(fd.get('amount'));
      if (cents === null || cents === 0) return { amount: 'Enter an amount, like 12.50.' };
      const signed = (fd.get('kind') === 'in' ? 1 : -1) * Math.abs(cents);
      let category = String(fd.get('category'));
      if (signed > 0 && !E.INCOME_CATEGORIES.includes(category) && isNew) category = 'Other income';
      const r = E.upsertTx(data, { id: isNew ? undefined : t.id, date: String(fd.get('date')), payee: String(fd.get('payee')), amount: signed, category, note: String(fd.get('note') || '') });
      if (Object.keys(r.errors).length) return r.errors;
      commit(r.data, isNew ? 'Added: ' + r.tx.payee + ', ' + money(signed, { sign: true }) + '.' : 'Saved.');
      return null;
    }, isNew ? 'Add' : 'Save', isNew ? '' : '<button type="button" class="lnk" data-act="del-one" data-id="' + esc(t.id) + '">Delete</button>');
}

// ---------- toasts ----------
function toast(text, undo) {
  const el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'status');
  el.innerHTML = '<span>' + esc(text) + '</span>' + (undo ? '<button type="button" class="lnk">Undo</button>' : '');
  if (undo) el.querySelector('button').addEventListener('click', () => { el.remove(); undo(); });
  $('#toasts').append(el); setTimeout(() => el.remove(), undo ? 7000 : 3500);
  while ($('#toasts').children.length > 3) $('#toasts').firstChild.remove();
}
function download(name, text, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }

// ---------- events ----------
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const id = el.dataset.id;
  switch (el.dataset.act) {
    case 'add': txForm(); break;
    case 'edit': txForm(data.transactions.find(t => t.id === id)); break;
    case 'del-one': { dlg.close(); const t = data.transactions.find(x => x.id === id); commit(E.removeTx(data, [id]), 'Deleted: ' + t.payee + '.'); break; }
    case 'month': ui.month = E.addMonths(ui.month, Number(el.dataset.n)); render(); break;
    case 'dismiss': commit({ ...data, dismissed: [...(data.dismissed || []), id] }, 'Hidden.'); break;
    case 'sort': { const k = el.dataset.k; ui.sort = { k, dir: ui.sort.k === k ? -ui.sort.dir : (k === 'date' ? -1 : 1) }; render(); $('[data-act="sort"][data-k="' + k + '"]').focus(); break; }
    case 'type': ui.type = el.dataset.k; ui.more = 0; render(); break;
    case 'clear': ui.q = ''; ui.cat = ''; ui.tmonth = ''; ui.type = 'all'; render(); break;
    case 'more': ui.more += 100; render(); break;
    case 'sel': if (el.checked) ui.sel.add(id); else ui.sel.delete(id); render(); { const c = $('[data-act="sel"][data-id="' + CSS.escape(id) + '"]'); if (c) c.focus(); } break;
    case 'sel-all': { const shown = filtered().slice(0, 100 + ui.more); shown.forEach(t => el.checked ? ui.sel.add(t.id) : ui.sel.delete(t.id)); render(); $('[data-act="sel-all"]').focus(); break; }
    case 'sel-none': ui.sel.clear(); render(); break;
    case 'bulk-del': { const ids = [...ui.sel]; confirmBox('Delete ' + ids.length + ' transactions?', 'You can undo this right after.', 'Delete', () => { ui.sel.clear(); commit(E.removeTx(data, ids), ids.length + ' transactions deleted.'); }); break; }
    case 'bulk-cat': { const ids = new Set(ui.sel); openForm('Change the category of ' + ids.size + ' transactions', field('category', 'New category', '<select id="f-category" name="category">' + E.CATEGORIES.map(c => '<option>' + c + '</option>').join('') + '</select>'), fd => { const c = String(fd.get('category')); ui.sel.clear(); commit({ ...data, transactions: data.transactions.map(t => ids.has(t.id) ? { ...t, category: c } : t) }, ids.size + ' transactions moved to ' + c + '.'); return null; }); break; }
    case 'export': download('expense-radar-transactions-' + TODAY + '.csv', E.toCsv(filtered()), 'text/csv'); toast('The CSV file was downloaded.'); break;
    case 'budget': { const c = el.dataset.cat; const cur = data.budgets[c] || 0; const f = E.forecast(data.transactions, THIS_MONTH); const est = f.ready ? (f.perCategory.find(x => x.category === c) || {}).estimate : 0;
      openForm('Budget for ' + c, field('limit', 'Each month (€)', '<input id="f-limit" name="limit" inputmode="decimal" value="' + (cur ? (cur / 100).toFixed(2) : est ? (Math.ceil(est / 1000) * 10).toFixed(2) : '') + '" autofocus>', est ? 'Your average for the last three months is ' + money(est) + ' (an estimate). Enter 0 to remove the budget.' : 'Enter 0 to remove the budget.'),
        fd => { const v = E.toCents(String(fd.get('limit') || '0')); if (v === null || v < 0) return { limit: 'Enter an amount, like 150.' }; const r = E.setBudget(data, c, v); if (r.error) return { limit: r.error }; commit(r.data, v ? 'Budget for ' + c + ': ' + money(v) + ' a month.' : 'The budget for ' + c + ' was removed.'); return null; }); break; }
    case 'sub-add': openForm('Add a subscription', field('name', 'Name', '<input id="f-name" name="name" maxlength="60" autofocus>') + '<div class="two">' + field('amount', 'Amount (' + curSym() + ')', '<input id="f-amount" name="amount" inputmode="decimal">') + field('cadence', 'How often', '<select id="f-cadence" name="cadence"><option>Monthly</option><option>Yearly</option><option>Weekly</option></select>') + '</div>' + field('next', 'Next payment', '<input id="f-next" name="next" type="date" value="' + E.addDays(TODAY, 30) + '">'),
      fd => { const name = String(fd.get('name') || '').trim(); const amount = E.toCents(fd.get('amount')); const next = String(fd.get('next')); const errs = {}; if (!name) errs.name = 'Give it a name.'; if (!amount || amount <= 0) errs.amount = 'Enter an amount, like 9.99.'; if (!E.isDate(next)) errs.next = 'Enter a date.'; if (Object.keys(errs).length) return errs;
        commit({ ...data, subscriptions: [...data.subscriptions, { id: 'm' + Date.now().toString(36), name, amount, cadence: String(fd.get('cadence')), category: 'Subscriptions', next }] }, 'Added: ' + name + '.'); return null; }, 'Add'); break;
    case 'sub-del': commit({ ...data, subscriptions: data.subscriptions.filter(s => s.id !== id) }, 'Removed.'); break;
    case 'imp-example': $('#paste').value = EXAMPLE; readImport(EXAMPLE); break;
    case 'imp-read': readImport($('#paste').value); break;
    case 'imp-back': ui.imp.step--; render(); break;
    case 'imp-new': ui.imp = { step: 1 }; render(); break;
    case 'imp-check': { const s = ui.imp; const m = s.map; const er = $('#mapErr');
      const msg = m.date < 0 ? 'Choose the date column.' : m.payee < 0 ? 'Choose the payee column.' : m.amount < 0 && m.debit < 0 && m.credit < 0 ? 'Choose the amount column, or the money out and money in columns.' : '';
      if (msg) { er.textContent = msg; er.hidden = false; return; }
      s.prep = E.prepareImport(s.rows, m, s.opts, data.transactions); s.keepDup = new Set(); s.step = 3; render(); break; }
    case 'imp-keep': { const n = Number(el.dataset.line); if (el.checked) ui.imp.keepDup.add(n); else ui.imp.keepDup.delete(n); render(); const c = $('[data-act="imp-keep"][data-line="' + n + '"]'); if (c) c.focus(); break; }
    case 'imp-go': { const s = ui.imp; const rows = s.prep.filter(r => !r.errors.length && (!r.duplicate || s.keepDup.has(r.line)));
      let next = data; for (const r of rows) next = E.upsertTx(next, r.tx).data;
      s.before = data; s.added = rows.length; s.step = 4; data = next; save(); render(); break; }
    case 'imp-undo': if (ui.imp.before) { data = ui.imp.before; save(); ui.imp = { step: 1 }; render(); toast('The import was undone.'); } break;
    case 'period': ui.period = el.dataset.k; render(); break;
    case 'report-csv': { const [from, to] = period(); download('expense-radar-report-' + from + '-to-' + to + '.csv', E.toCsv(data.transactions.filter(t => t.date >= from && t.date <= to).sort((a, b) => a.date.localeCompare(b.date))), 'text/csv'); toast('The CSV file was downloaded.'); break; }
    case 'print': print(); break;
    case 'checkin': commit({ ...data, checkins: [...new Set([...(data.checkins || []), TODAY])].slice(-400) }, 'Noted: nothing spent today.'); break;
    case 'reminder': reminderForm(); break;
    case 'due-log': { const d = E.dueNow(data, TODAY).find(x => x.id === id); if (!d) break; const r = E.upsertTx(data, { id: 't' + Date.now().toString(36), date: TODAY, payee: d.payee, amount: -d.amount, category: d.category, note: '' }); commit({ ...r.data, dismissed: [...(r.data.dismissed || []), d.id] }, 'Logged: ' + d.payee + '.'); break; }
    case 'start-sample': firstVisit = false; data = seed(TODAY); save(); location.hash = '#/overview'; render(); break;
    case 'start-own': confirmBox('Start with your own money?', 'The sample is removed and you get an empty space for your own figures, saved on this device.', 'Start', () => startOwn(data.currency || 'EUR')); break;
    case 'backup': backup(); break;
    case 'restore': $('#restoreFile').click(); break;
    case 'install': installHelp(); break;
    case 'reset': confirmBox('Reset the sample?', 'Your changes to the sample are removed and the original made-up figures come back.', 'Reset', () => { try { localStorage.removeItem(KEY); } catch (err) { /* nothing saved */ } data = seed(TODAY); ui.sel.clear(); ui.imp = { step: 1 }; render(); toast('The demo was reset.'); }); break;
    case 'empty': confirmBox('Start empty?', 'Every transaction, budget and subscription in this browser is removed, so you can try it with your own made-up figures.', 'Start empty', () => { try { localStorage.removeItem(KEY); } catch (err) { /* nothing saved */ } data = E.emptyData(); ui.sel.clear(); save(); render(); toast('Empty. Add a transaction or import a file.'); }); break;
  }
});
let qTimer;
document.addEventListener('input', e => {
  const el = e.target;
  if (el.matches('[data-q]')) { clearTimeout(qTimer); qTimer = setTimeout(() => { ui.q = el.value; ui.more = 0; render(); const q = $('#q'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }, 150); }
});
document.addEventListener('change', e => {
  const el = e.target;
  if (el.matches('[data-f]')) { ui[el.dataset.f] = el.value; ui.more = 0; render(); $('#' + el.id).focus(); }
  if (el.matches('[data-map]')) ui.imp.map[el.dataset.map] = Number(el.value);
  if (el.matches('[data-opt]')) ui.imp.opts[el.dataset.opt] = el.type === 'checkbox' ? el.checked : el.value;
  if (el.matches('[data-opt="hasHeader"]')) render();
  if (el.matches('[data-r]')) { ui[el.dataset.r] = el.value; render(); }
  if (el.id === 'restoreFile' && el.files[0]) { const f = el.files[0]; el.value = ''; if (f.size > 20_000_000) { toast('This file is larger than 20 MB.'); return; } f.text().then(restoreFrom); return; }
  if (el.id === 'file' && el.files[0]) { const f = el.files[0]; if (f.size > 2_000_000) { toast('This file is larger than 2 MB.'); return; } f.text().then(readImport); }
});
document.addEventListener('dragover', e => { const d = e.target.closest && e.target.closest('#drop'); if (d) { e.preventDefault(); d.classList.add('on'); } });
document.addEventListener('dragleave', e => { const d = e.target.closest && e.target.closest('#drop'); if (d) d.classList.remove('on'); });
document.addEventListener('drop', e => { const d = e.target.closest && e.target.closest('#drop'); if (!d) return; e.preventDefault(); const f = e.dataTransfer.files[0]; if (!f) return; if (f.size > 2_000_000) { toast('This file is larger than 2 MB.'); return; } f.text().then(readImport); });
document.addEventListener('keydown', e => { if (e.key === 'n' && !e.ctrlKey && !e.metaKey && !dlg.open && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); txForm(); } });

document.addEventListener('submit', e => {
  if (e.target.matches('[data-form="start-own"]')) { e.preventDefault(); startOwn(e.target.currency.value); }
  if (e.target.matches('[data-form="quick"]')) { e.preventDefault(); const c = e.submitter && e.submitter.value; if (c) quickLog(e.target, c); else { const a = $('#qAmt'); if (a) { $('#qErr').textContent = 'Now tap what it was for.'; $('#qErr').hidden = false; } } }
});
if ('serviceWorker' in navigator) window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js', { scope: './' }).catch(() => { /* offline use is optional */ }); });
if (!location.hash) history.replaceState(null, '', '#/overview');
lastView = route().name;
render();
if (notice) toast(notice);

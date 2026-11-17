// Command Center: screens and interactions. Every figure comes from engine.js; this file shows it and saves changes.
import * as E from './engine.js';
import { seed } from './seed.js';
import { api, diff } from './cloud.js';
import { enhance, setToday } from './controls.js';

const KEY = 'command-center-v2';
const OLD_KEYS = ['command-center-v1'];
const pad = n => String(n).padStart(2, '0');
const now = new Date();
const TODAY = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
setToday(TODAY);
const stamp = () => { const d = new Date(); return TODAY + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()); };

// ---------- storage (Victoria's rule: one key, workspace only, Reset removes it) ----------
let startNotice = '';
function load() {
  try {
    OLD_KEYS.forEach(k => localStorage.removeItem(k));
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw);
      if (E.isValidData(d)) return { me: d.me || '', filters: d.filters || [], ...d };
      startNotice = 'The saved workspace could not be read, so the sample data was restored.';
    }
  } catch (e) { /* storage blocked: work in memory */ }
  return seed(TODAY);
}
let data = load();
let undoStack = null;
// Accounts: acct is null while working in this browser only; otherwise the signed-in person and the open workspace.
let acct = null; let serverOn = false; let signupMode = 'open'; let synced = null; let syncing = Promise.resolve(); let offeredCopy = false;
function save() {
  if (acct) { queueSync(); return; }
  try { localStorage.setItem(KEY, JSON.stringify(data)); }
  catch (e) { toast('This browser did not allow saving. Your changes last until you close the tab.', 'error'); }
}
function clearSaved() { try { localStorage.removeItem(KEY); } catch (e) { /* nothing saved */ } }
function commit(next, message, { undo = false, flip = true } = {}) {
  const prev = data;
  data = next; save();
  if (flip) flipRender(); else render();
  if (message) toast(message, 'ok', undo ? () => { data = prev; save(); flipRender(); toast('Undone.'); } : null);
}

// ---------- helpers ----------
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = x => Math.round(x * 100) + '%';
// Dates read "29 Nov 2026", or "29 Nov" in rows: never mm/dd.
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtDate = (iso, short) => { if (!iso) return ''; const [y, m, d] = iso.slice(0, 10).split('-').map(Number); return d + ' ' + MON[m - 1] + (short ? '' : ' ' + y); };
const fmtStamp = s => s ? fmtDate(s, true) + (s.length > 10 ? ' · ' + s.slice(11, 16) : '') : '';
const rel = iso => { const n = E.daysBetween(TODAY, iso); return n === 0 ? 'today' : n === 1 ? 'tomorrow' : n === -1 ? 'yesterday' : n > 0 ? 'in ' + n + ' days' : Math.abs(n) + ' days ago'; };
const proj = id => data.projects.find(p => p.id === id);
const task = id => data.tasks.find(t => t.id === id);
const people = () => [...new Set([data.me, ...((acct && acct.members) || []), ...data.projects.map(p => p.owner), ...data.tasks.map(t => t.owner), ...data.risks.map(r => r.owner)].filter(Boolean))].sort();
const healthTone = label => ({ 'On track': 'ok', 'At risk': 'warn', 'Critical': 'bad', 'Delivered': 'done', 'Not started': 'idle' }[label] || 'idle');
const slug = s => String(s).toLowerCase().replace(/\s+/g, '-');
function hue(name) { let h = 0; for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; }
const initials = n => String(n || '?').split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
const avatar = (name, size = '') => '<span class="av ' + size + '" style="--h:' + hue(name) + '" title="' + esc(name) + '" aria-hidden="true">' + esc(initials(name)) + '</span>';
const PRIO_N = { Low: 1, Medium: 2, High: 3, Critical: 4 };
const prioIcon = (p, word) => '<span class="prb prb-' + slug(p) + '" data-n="' + (PRIO_N[p] || 1) + '" role="img" title="' + esc(p) + ' priority" aria-label="' + esc(p) + ' priority"><i></i><i></i><i></i></span>' + (word ? '<span class="prb-w">' + esc(p) + '</span>' : '');
const typeOf = t => t.type || 'Task';
const TYPE_GLYPH = { Task: '<path d="M4.6 8.4l2.1 2.1 4.6-4.8"/>', Bug: '<circle cx="8" cy="8" r="2.4" class="fill"/>', Story: '<path d="M5.4 4h5.2v8.2L8 10.4l-2.6 1.8z"/>' };
const typeIcon = t => '<span class="ty ty-' + slug(typeOf(t)) + '" role="img" aria-label="' + typeOf(t) + '" title="' + typeOf(t) + '"><svg viewBox="0 0 16 16" aria-hidden="true">' + TYPE_GLYPH[typeOf(t)] + '</svg></span>';
const estPill = t => t.estimate ? '<span class="estp" title="Estimate: ' + t.estimate + (t.estimate === 1 ? ' day' : ' days') + '">' + t.estimate + 'd</span>' : '';
const LZ = { 'To do': 'todo', 'In progress': 'prog', 'In review': 'rev', 'On hold': 'pause', Done: 'done', Backlog: 'todo' };
const lozenge = st => '<span class="lz lz-' + (LZ[st] || 'todo') + '"><i></i>' + esc(stLabel(st)) + '</span>';
const dueSpan = t => '<span class="due' + (isPast(t) ? ' past' : '') + '" title="' + (isPast(t) ? 'Was due ' : 'Due ') + esc(fmtDate(t.due)) + '">' + esc(fmtDate(t.due, t.due.slice(0, 4) === TODAY.slice(0, 4))) + '</span>';
function opts(list, sel, blank) { return (blank !== undefined ? '<option value="">' + esc(blank) + '</option>' : '') + list.map(v => { const [val, lab] = Array.isArray(v) ? v : [v, v]; return '<option value="' + esc(val) + '"' + (String(val) === String(sel) ? ' selected' : '') + '>' + esc(lab) + '</option>'; }).join(''); }
function emptyState(title, text, action, icon = 'spark') { return '<div class="empty"><span class="empty-ic ic-' + icon + '" aria-hidden="true"></span><p class="empty-t">' + esc(title) + '</p><p>' + esc(text) + '</p>' + (action || '') + '</div>'; }
function ring(score, tone, size = 64, label = '') {
  const r = (size - 8) / 2, c = 2 * Math.PI * r, off = c * (1 - Math.max(0, Math.min(100, score)) / 100);
  return '<svg class="ring tone-' + tone + '" viewBox="0 0 ' + size + ' ' + size + '" width="' + size + '" height="' + size + '" role="img" aria-label="' + esc(label || 'Health ' + score + ' out of 100') + '"><circle class="ring-bg" cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '"/><circle class="ring-fg" cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" stroke-dasharray="' + c.toFixed(1) + '" style="--off:' + off.toFixed(1) + ';--full:' + c.toFixed(1) + '"/><text x="50%" y="50%" dy=".35em" text-anchor="middle">' + (tone === 'idle' ? '–' : score) + '</text></svg>';
}

// ---------- Still: small shared pieces ----------
const ic = (n, cls = '') => '<svg class="i' + (cls ? ' ' + cls : '') + '" aria-hidden="true"><use href="#i-' + n + '"/></svg>';
const stLabel = s => s === 'On hold' ? 'Paused' : s;
const stOpts = list => list.map(s => [s, stLabel(s)]);
const pcol = pid => { const i = data.projects.findIndex(p => p.id === pid); return 'var(--p' + ((i < 0 ? 0 : i) % 6 + 1) + ')'; };
const pcs = pid => ' style="--pc:' + pcol(pid) + '"';
const firstName = n => String(n || '').split(' ')[0];
const isPhone = () => matchMedia('(max-width: 900px)').matches;
const shortName = p => p ? p.name.split(' ')[0] : '';
const cut = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; };
const lowerFirst = s => s ? s[0].toLowerCase() + s.slice(1) : s;
const dayLong = iso => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }); };
const weekday = (iso, style = 'long') => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { weekday: style, timeZone: 'UTC' }); };
const dowOf = iso => new Date(E.toDate(iso)).getUTCDay(); // 0 Sunday
const pastChip = t => '<span class="chip2 c-past">' + ic('clock') + 'Was due ' + esc(fmtDate(t.due, true)) + '</span>';
const pausedChip = (label = 'Paused') => '<span class="chip2 c-pause">' + ic('pause') + esc(label) + '</span>';
const lastStatusAt = (t, to) => { const h = [...(t.history || [])].reverse().find(x => x.field === 'Status' && x.to === to); return h ? h.at : ''; };
const isOpen = t => t.status !== 'Done' && t.status !== 'Backlog';
const isPast = t => t.status !== 'Done' && t.status !== 'Backlog' && t.status !== 'On hold' && t.due < TODAY;
// A reminder lands two working days ahead, never on a weekend.
function nextRemind() { let d = E.addDays(TODAY, 2); while (dowOf(d) === 0 || dowOf(d) === 6) d = E.addDays(d, 1); return d; }
function pring(progress, size = 44) {
  const r = (size - 6) / 2, c = 2 * Math.PI * r, off = c * (1 - Math.max(0, Math.min(1, progress)));
  return '<svg class="pring" width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" aria-hidden="true"><circle class="bgc" cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '"/><circle class="fgc" cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" stroke-dasharray="' + c.toFixed(1) + '" stroke-dashoffset="' + off.toFixed(1) + '"/></svg>';
}
function calmEmpty(title, text, action = '') { return '<div class="calm-empty"><span class="ill" aria-hidden="true">' + ic('leaf') + '</span><b>' + esc(title) + '</b><span>' + esc(text) + '</span>' + action + '</div>'; }
// A task row with a check circle (Home, My tasks).
function taskRow(t, { when = false, proj: showProj = true } = {}) {
  const done = t.status === 'Done'; const p = proj(t.projectId);
  return '<div class="tr' + (done ? ' dn' : '') + '"' + pcs(t.projectId) + ' data-flip="row-' + esc(t.id) + '">' +
    '<button type="button" class="ck' + (done ? ' done' : '') + '" data-act="' + (done ? 'reopen' : 'complete') + '" data-id="' + esc(t.id) + '" aria-label="' + esc((done ? 'Reopen ' : 'Mark done: ') + t.title) + '" aria-pressed="' + done + '"></button>' +
    '<button type="button" class="tt" data-act="open" data-id="' + esc(t.id) + '">' + esc(t.title) + '</button>' +
    (t.status === 'On hold' ? pausedChip() : '') + (isPast(t) ? pastChip(t) : '') +
    (t.remindOn && t.remindOn <= TODAY && t.status === 'On hold' ? '<span class="chip2 c-acc">' + ic('bell') + 'Reminder</span>' : '') +
    (when && !isPast(t) && !done ? '<span class="when">' + esc(t.due === TODAY ? 'Today' : fmtDate(t.due, true)) + '</span>' : '') +
    (showProj ? '<span class="pj" title="' + esc(p ? p.name : '') + '"><span class="pd"></span>' + esc(shortName(p)) + '</span>' : '') + '</div>';
}


function toast(msg, kind = 'ok', undoFn = null) {
  const box = $('#toasts'); const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.innerHTML = '<span>' + esc(msg) + '</span>' + (undoFn ? '<button type="button" class="toast-undo">Undo</button>' : '');
  if (undoFn) el.querySelector('button').addEventListener('click', () => { el.remove(); undoFn(); });
  box.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, undoFn ? 7000 : kind === 'error' ? 6000 : 3000);
}

// ---------- state for filters and selection ----------
const ui = {
  q: { text: '', assignee: '', status: [], priority: [], label: '', project: '', overdue: false, onHold: false },
  group: 'none', // board: none | people
  sel: new Set(), // backlog selection
  backlogSort: 'rank',
  projSort: 'health', projStatus: '',
  risks: { project: '', status: 'open', cell: null },
  deps: { project: '' },
  reports: { type: 'portfolio', project: '' },
  panel: null, panelTab: 'all',
  mcol: 'To do', doneOpen: false, calMonth: '', calDay: '', calMine: false,
  moreFilters: false, // extra filters stay folded until asked for
};
const activeFilterCount = () => ['text', 'assignee', 'label', 'project'].filter(k => ui.q[k]).length + (ui.q.status.length ? 1 : 0) + (ui.q.priority.length ? 1 : 0) + (ui.q.overdue ? 1 : 0) + (ui.q.onHold ? 1 : 0);

// ---------- routing ----------
function route() {
  const h = location.hash.replace(/^#\/?/, '');
  const [path, query] = h.split('?');
  const parts = path.split('/');
  return { name: parts[0] || '', id: decodeURIComponent(parts[1] || ''), params: new URLSearchParams(query || '') };
}
const VIEWS = { overview: r => overview(r), mytasks: myTasks, calendar: calendarView, workspace: workspaceView, account: accountView, join: joinView, board, backlog, projects, project: projectView, dependencies, risks, insights: insightsView, reports, verify: verifyView, mailbox: mailboxView, reset: resetView, email: emailView, admin: adminView, lists: listsView, task: taskPage };
const NAV_OF = { backlog: 'board' };
let lastHash = null;

function render() {
  const r = route();
  const view = VIEWS[r.name];
  const main = $('#main');
  if (!view) { location.replace('#/overview'); return; }
  if (r.name === 'dependencies' && r.params.get('p')) ui.deps.project = r.params.get('p');
  if (lastHash !== location.hash) {
    if (['board', 'backlog'].includes(r.name)) ui.q.project = r.params.get('p') && proj(r.params.get('p')) ? r.params.get('p') : (lastHash && /[?&]p=/.test(lastHash) ? '' : ui.q.project);
    if (r.name === 'risks' && r.params.get('p')) ui.risks.project = r.params.get('p');
  }
  if (r.name === 'reports') { if (r.params.get('type')) ui.reports.type = r.params.get('type'); if (r.params.get('p')) ui.reports.project = r.params.get('p'); }
  if (r.name === 'task' && lastHash && !lastHash.startsWith('#/task/')) ui.fullFrom = lastHash;
  if (r.name !== 'task' && lastHash && lastHash.startsWith('#/task/')) ui.panel = null;
  const linked = r.params.get('task');
  if (linked && task(linked)) { ui.panel = linked; history.replaceState(null, '', '#/' + r.name + (r.id ? '/' + encodeURIComponent(r.id) : '')); }
  const ctx = projCtx(r);
  main.innerHTML = (ctx ? projHeader(ctx, r.name) : '') + view(r);
  main.classList.toggle('has-ph', !!ctx);
  main.dataset.view = r.name;
  document.body.classList.toggle('task-full', r.name === 'task' && !!ui.panel);
  if (r.name === 'task') { scrollTo(0, 0); const tb = $('.topbar'); if (tb) document.documentElement.style.setProperty('--top-h', Math.round(tb.getBoundingClientRect().bottom) + 'px'); }
  document.body.classList.toggle('on-board', r.name === 'board');
  renderSide();
  const navKey = r.name === 'project' ? (data.projects.filter(p => p.status !== 'Completed').slice(0, 8).some(p => p.id === r.id) ? 'p-' + r.id : 'projects') : (NAV_OF[r.name] || r.name);
  $$('[data-nav]').forEach(a => { if (a.dataset.nav === navKey) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  const high = E.insights(data, TODAY).filter(i => i.level === 'high').length;
  $$('.ins-count').forEach(c => { c.hidden = !high; c.textContent = high; });
  renderBand();
  renderPanel();
  animateIn(main);
  if (r.name === 'board') setupBoardDnD();
  if (lastHash !== null && lastHash !== location.hash) { const h = main.querySelector('h2'); if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); } }
  lastHash = location.hash;
}

// FLIP: elements with data-flip keep their place visually across a re-render, then glide.
function flipRender() {
  const before = new Map($$('[data-flip]').map(el => [el.dataset.flip, el.getBoundingClientRect()]));
  render();
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  $$('[data-flip]').forEach(el => {
    const b = before.get(el.dataset.flip); if (!b) { el.animate([{ opacity: 0, transform: 'scale(.96)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: 'cubic-bezier(.2,.7,.2,1)' }); return; }
    const a = el.getBoundingClientRect(); const dx = b.left - a.left, dy = b.top - a.top;
    if (dx || dy) el.animate([{ transform: 'translate(' + dx + 'px,' + dy + 'px)' }, { transform: 'none' }], { duration: 320, easing: 'cubic-bezier(.2,.7,.2,1)' });
  });
}
function navigate() {
  if (document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) document.startViewTransition(() => render());
  else render();
}

// Count-up numbers, rings and bars animate in when a view appears.
function animateIn(root) {
  requestAnimationFrame(() => {
    root.querySelectorAll('.ring, .grow-in').forEach(el => el.classList.add('in'));
  });
}

// ---------- shared pieces ----------
function filterBar(where) {
  const q = ui.q; const ppl = people();
  const extra = ['label', 'project'].filter(k => q[k]).length + (q.priority.length ? 1 : 0) + (q.overdue ? 1 : 0) + (q.onHold ? 1 : 0) + (q.assignee && q.assignee !== 'me' ? 1 : 0);
  const open = ui.moreFilters;
  const chip = (k, l, on) => '<button type="button" class="chip' + (on ? ' on' : '') + '" data-act="q-chip" data-k="' + k + '" aria-pressed="' + !!on + '">' + l + '</button>';
  return '<div class="fbar" role="search">' +
    '<label class="fsearch"><span class="sr">Search tasks</span>' + ic('search') + '<input type="search" data-q="text" value="' + esc(q.text) + '" placeholder="Search tasks"></label>' +
    chip('me', 'My tasks', q.assignee === 'me') +
    '<button type="button" class="chip more' + (open || extra ? ' on-soft' : '') + '" data-act="more-filters" aria-expanded="' + open + '" aria-controls="moreFilters">' + ic('filter') + 'Filter' + (extra ? ' <span class="pill-n">' + extra + '</span>' : '') + '</button>' +
    (activeFilterCount() ? '<button type="button" class="lnk" data-act="clear-q">Clear</button>' : '') +
    (where === 'board' ? '<div class="seg" role="group" aria-label="Group the board"><button type="button" data-act="group" data-g="none" aria-pressed="' + (ui.group === 'none') + '">Columns</button><button type="button" data-act="group" data-g="people" aria-pressed="' + (ui.group === 'people') + '">By person</button></div>' : '') +
    '</div>' +
    '<div class="fmore" id="moreFilters"' + (open ? '' : ' hidden') + '>' +
      '<div class="fm-row"><span class="fm-l">Person</span><div class="avstack" role="group" aria-label="Filter by assignee">' + ppl.map(n => '<button type="button" class="avbtn' + ((q.assignee === n || (q.assignee === 'me' && n === data.me)) ? ' on' : '') + '" data-act="q-assignee" data-name="' + esc(n) + '" aria-pressed="' + (q.assignee === n) + '" aria-label="Only ' + esc(n) + '" title="' + esc(n) + '">' + avatar(n) + '</button>').join('') + '</div></div>' +
      '<div class="fm-row"><span class="fm-l">Show</span>' + chip('overdue', 'Past date', q.overdue) + chip('onHold', 'Paused', q.onHold) + '</div>' +
      '<div class="fm-row"><span class="fm-l">Narrow</span>' +
        '<label class="fsel"><span class="sr">Project</span><select data-q="project">' + opts(data.projects.map(p => [p.id, p.name]), q.project, 'All projects') + '</select></label>' +
        '<label class="fsel"><span class="sr">Label</span><select data-q="label">' + opts(E.allLabels(data), q.label, 'All labels') + '</select></label>' +
        '<label class="fsel"><span class="sr">Priority</span><select data-q="priority">' + opts(E.PRIORITIES, q.priority[0] || '', 'Any priority') + '</select></label></div>' +
      '<div class="fm-row"><span class="fm-l">Saved</span><label class="fsel"><span class="sr">Saved filters</span><select data-act="load-filter"><option value="">Saved filters</option>' + (data.filters || []).map(f => '<option value="' + esc(f.id) + '">' + esc(f.name) + '</option>').join('') + '</select></label>' +
        (activeFilterCount() ? '<button type="button" class="lnk" data-act="save-filter">Save this filter</button>' : '') + '</div>' +
    '</div>';
}

function card(t) {
  const all = data.tasks; const cl = t.checklist || [];
  const blocks = t.status !== 'Done' ? E.dependents(all, t.id).filter(x => x.status !== 'Done').length : 0;
  const waits = E.isWaiting(t, all); const past = isPast(t); const paused = t.status === 'On hold';
  return '<article class="card' + (t.status === 'Done' ? ' is-done' : '') + (paused ? ' is-hold' : '') + (ui.panel === t.id ? ' sel' : '') + '" data-task="' + esc(t.id) + '" data-flip="' + esc(t.id) + '"' + pcs(t.projectId) + ' tabindex="0" aria-label="' + esc(typeOf(t) + ' ' + t.key + ': ' + t.title + ', ' + stLabel(t.status) + ', ' + t.priority + ' priority, ' + t.owner + ', ' + (past ? 'was due ' : 'due ') + fmtDate(t.due) + (cl.length ? ', checklist ' + cl.filter(c => c.done).length + ' of ' + cl.length + ' done' : '') + (waits ? ', waits for another task' : '') + (blocks ? ', ' + blocks + ' waiting for it' : '')) + '">' +
    '<div class="qa"><button type="button" data-act="qa-me" data-id="' + esc(t.id) + '" aria-label="Assign to me" title="Assign to me · I">' + ic('user') + '</button><button type="button" data-act="qa-date" data-id="' + esc(t.id) + '" aria-label="Change the date" title="Change the date · D">' + ic('cal') + '</button></div>' +
    '<p class="c-title">' + esc(t.title) + '</p>' +
    (paused ? '<p class="c-wait">' + ic('pause') + '<span title="' + esc(t.holdReason) + '">' + esc(t.holdReason) + '</span></p>' : '') +
    '<div class="c-meta">' + typeIcon(t) + '<span class="key">' + esc(t.key) + '</span>' + prioIcon(t.priority) + estPill(t) +
      (t.status === 'Done' ? '' : dueSpan(t)) + '<span class="grow"></span>' + avatar(t.owner, 'xs') + '</div>' +
  '</article>';
}

// ---------- views ----------
// Lists pinned to Home: each one shows its first tasks, in its own order.
function pinnedLists() {
  const pins = (data.filters || []).filter(f => f.query && f.query.view && f.query.view.pin);
  const tip = '<p class="pin-tip"><a href="#/lists">' + ic('list') + (pins.length ? 'Change your lists' : 'Make Home yours: pin a list of tasks') + '</a></p>';
  if (!pins.length) return tip;
  return '<div class="pins">' + pins.map(f => { const { view, ...q } = f.query; const all = sortTasks(E.applyFilter(data.tasks, { ...Q0, ...q }, data.me, TODAY), view.sort); const rows = all.slice(0, 6);
    return '<section class="card2 pin"><div class="ch"><h3>' + esc(f.name) + '</h3><span>' + all.length + '</span><span class="grow"></span><button type="button" class="lnk" data-act="list-open" data-id="' + esc(f.id) + '">Open the list</button></div>' + (rows.length ? rows.map(t => taskRow(t, { when: true, proj: true })).join('') : '<p class="soft">Nothing here right now.</p>') + '</section>'; }).join('') + '</div>' + tip;
}
function wrow(t) {
  const done = t.status === 'Done';
  return '<li class="wr' + (done ? ' dn' : '') + '"' + pcs(t.projectId) + ' data-flip="row-' + esc(t.id) + '">' +
    '<button type="button" class="ck' + (done ? ' done' : '') + '" data-act="' + (done ? 'reopen' : 'complete') + '" data-id="' + esc(t.id) + '" aria-label="' + esc((done ? 'Reopen ' : 'Mark done: ') + t.title) + '" aria-pressed="' + done + '"></button>' +
    typeIcon(t) + '<span class="key">' + esc(t.key) + '</span><button type="button" class="tt" data-act="open" data-id="' + esc(t.id) + '">' + esc(t.title) + '</button>' +
    (t.status === 'On hold' && t.holdReason ? '<span class="wr-why" title="' + esc(t.holdReason) + '">' + esc(cut(t.holdReason, 60)) + '</span>' : '') +
    '<span class="wr-r">' + lozenge(t.status) + prioIcon(t.priority) + (done ? '' : dueSpan(t)) + '</span></li>';
}
function overview() {
  const hour = new Date().getHours();
  const hello = (hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening') + ', ' + esc(firstName(data.me)) + '.';
  const head = (sum) => '<div class="fy-head"><p class="fy-date">' + esc(dayLong(TODAY)) + '</p><div class="fy-line"><h2>For you</h2><p class="fy-sum">' + hello + (sum ? ' ' + sum : '') + '</p></div></div>';
  if (!data.projects.length) return head('This workspace is empty.') + '<p class="muted">Create a first project, or load the sample data to look around.</p><div class="row" style="margin-top:16px"><button class="btn" data-act="new-project">' + ic('plus') + 'New project</button>' + (canWipe() ? '<button class="btn ghost" data-act="reset">Load sample data</button>' : '') + '</div>';
  const live = t => !t.archivedAt;
  const mine = data.tasks.filter(t => t.owner === data.me && live(t));
  const watching = data.tasks.filter(t => live(t) && (t.watchers || []).includes(data.me) && t.owner !== data.me);
  const recent = (ui.recent || []).map(task).filter(Boolean);
  const tabs = [['mine', 'Assigned to me', mine.filter(t => t.status !== 'Done').length], ['watching', 'Watching', watching.filter(t => t.status !== 'Done').length], ['recent', 'Recently viewed', recent.length]];
  const tab = ui.fyTab || 'mine';
  const src = tab === 'watching' ? watching : tab === 'recent' ? recent : mine;
  const doneToday = src.filter(t => t.status === 'Done' && (lastStatusAt(t, 'Done') || '').slice(0, 10) === TODAY);
  const open = src.filter(t => t.status !== 'Done');
  const endWeek = E.addDays(TODAY, (7 - dowOf(TODAY)) % 7);
  const byDue = (a, b) => a.due.localeCompare(b.due) || a.key.localeCompare(b.key, 'en', { numeric: true });
  const groups = tab === 'recent' ? [['recent', 'Recently viewed', recent, true]] : [
    ['past', 'Past their date', open.filter(isPast).sort(byDue), true],
    ['today', 'Today', [...open.filter(t => t.status !== 'On hold' && t.status !== 'Backlog' && (t.due === TODAY || (t.remindOn && t.remindOn <= TODAY))), ...doneToday].sort(byDue), true],
    ['week', 'Later this week', open.filter(t => t.status !== 'On hold' && t.status !== 'Backlog' && t.due > TODAY && t.due <= endWeek).sort(byDue), true],
    ['paused', 'Paused', open.filter(t => t.status === 'On hold').sort(byDue), true],
    ['later', 'Later', open.filter(t => t.status !== 'On hold' && (t.status === 'Backlog' || t.due > endWeek)).sort(byDue), false],
  ];
  const nPast = groups[0][2].length, nToday = tab === 'recent' ? 0 : groups[1][2].filter(t => t.status !== 'Done').length, nPaused = data.tasks.filter(t => t.status === 'On hold' && t.owner === data.me).length;
  const myPast = mine.filter(isPast).length, myToday = mine.filter(t => isOpen(t) && t.status !== 'On hold' && t.due === TODAY).length;
  const bits = [myPast ? myPast + (myPast === 1 ? ' item' : ' items') + ' past their date' : '', myToday ? myToday + ' due today' : '', nPaused ? nPaused + ' paused' : ''].filter(Boolean);
  const sum = bits.length ? bits.join(', ').replace(/^./, c => c.toUpperCase()) + '.' : 'Nothing is late and nothing is waiting. A calm day.';
  const fold = ui.fyFold || {};
  const work = '<section class="fy-work" aria-labelledby="fyWorkH"><h3 id="fyWorkH" class="sr">Your work</h3><div class="fy-tabs" role="tablist" aria-label="Your work">' + tabs.map(([k, l, n]) => '<button type="button" role="tab" data-act="fy-tab" data-k="' + k + '" aria-selected="' + (tab === k) + '">' + l + (n ? ' <span class="n">' + n + '</span>' : '') + '</button>').join('') + '<span class="grow"></span><span class="fy-grp">Group: due date</span></div>' +
    (groups.some(g => g[2].length) ? groups.filter(g => g[2].length).map(([k, l, list, openByDefault]) => { const isOpenG = fold[k] === undefined ? openByDefault : fold[k];
      return '<details class="fy-g"' + (isOpenG ? ' open' : '') + ' data-g="' + k + '"><summary>' + ic('down') + '<span>' + l + '</span><span class="n">' + list.length + '</span></summary><ul class="wrows">' + list.slice(0, 30).map(wrow).join('') + '</ul></details>'; }).join('')
      : '<div class="fy-empty">' + ic('leaf') + '<p>' + (tab === 'watching' ? 'You are not watching any task. Open a task and choose Watch.' : tab === 'recent' ? 'Tasks you open show up here.' : 'Nothing assigned to you. Enjoy the space.') + '</p></div>') + '</section>';
  // Projects that need a look come first
  const lv = data.projects.filter(p => !p.archivedAt && (p.status === 'Active' || p.status === 'On hold'));
  const rows = lv.map(p => { const h = E.health(data, p, TODAY); const pts = E.projectTasks(data, p.id); const look = h.label !== 'On track' || pts.some(t => t.status === 'On hold') || pts.some(isPast); return { p, h, look, open: pts.filter(t => t.status !== 'Done' && !t.archivedAt).length }; }).sort((x, y) => (y.look - x.look) || x.h.score - y.h.score);
  const shown = rows.slice(0, 5);
  const projTbl = '<section class="fy-box" aria-labelledby="fyProjH"><div class="fy-bh"><h3 id="fyProjH">Projects</h3><span class="muted small">' + shown.length + ' of ' + rows.length + ' shown</span><span class="grow"></span><a class="lnk small" href="#/projects">Portfolio</a></div>' +
    (shown.length ? '<table class="fy-pt"><thead><tr><th>Project</th><th>Progress</th><th class="r">Open</th><th>Health</th></tr></thead><tbody>' + shown.map(({ p, h, look, open }) => '<tr class="' + (look ? '' : 'phone-hide') + '"><td><a href="#/project/' + esc(p.id) + '"' + pcs(p.id) + '><span class="pdot" aria-hidden="true">' + pletter(p) + '</span>' + esc(p.name) + '</a></td><td><span class="fy-bar" aria-hidden="true"><i style="width:' + Math.round(h.progress * 100) + '%"></i></span><span class="pc">' + pct(h.progress) + '</span></td><td class="r">' + open + '</td><td><span class="lz lz-' + (p.status === 'On hold' ? 'pause' : look ? 'pause' : 'done') + '"><i></i>' + (p.status === 'On hold' ? 'Paused' : look ? 'Needs a look' : 'On track') + '</span></td></tr>').join('') + '</tbody></table>' : '<p class="muted small pad">No active project right now.</p>') + '</section>';
  // Activity of today (or the latest, when today is quiet)
  const evs = data.tasks.flatMap(t => (t.history || []).map(h => ({ t, h }))).concat(data.tasks.flatMap(t => (t.comments || []).map(c => ({ t, h: { at: c.at, by: c.by, field: 'Comment' } })))).sort((x, y) => String(y.h.at).localeCompare(String(x.h.at)));
  const todays = evs.filter(e => String(e.h.at).slice(0, 10) === TODAY); const list = (todays.length ? todays : evs).slice(0, 7);
  const verb = h => h.field === 'Created' ? 'created' : h.field === 'Comment' ? 'commented on' : h.field === 'Status' ? 'moved ' : 'changed the ' + h.field.toLowerCase() + ' of';
  const act = '<section class="fy-box phone-hide" aria-labelledby="fyActH"><div class="fy-bh"><h3 id="fyActH">' + (todays.length ? 'Activity today' : 'Latest activity') + '</h3></div><ul class="fy-act">' + list.map(({ t, h }) => '<li>' + avatar(h.by, 'xs') + '<p><b>' + esc(firstName(h.by)) + '</b> ' + (h.field === 'Status' ? 'moved <button type="button" class="tt" data-act="open" data-id="' + esc(t.id) + '">' + esc(t.key) + '</button> to ' + esc(stLabel(h.to)) : verb(h) + ' <button type="button" class="tt" data-act="open" data-id="' + esc(t.id) + '">' + esc(t.key) + '</button>') + '</p><small>' + esc(todays.length ? String(h.at).slice(11, 16) : fmtDate(String(h.at).slice(0, 10), true)) + '</small></li>').join('') + '</ul></section>';
  return head(sum) + '<div class="fy-cols"><div class="fy-left">' + work + '</div><div class="fy-right">' + projTbl + act + pinnedLists() + '</div></div>';
}

// ---------- My tasks ----------
function myTasks() {
  const mine = data.tasks.filter(t => t.owner === data.me && !t.archivedAt);
  const head = '<div class="vh"><div><h2>My tasks</h2><p class="lede">' + (mine.length ? 'Everything assigned to ' + esc(data.me) + ', by when it is due.' : 'Nothing is assigned to ' + esc(data.me) + ' yet.') + '</p></div><div class="row"><button class="btn" data-act="new-task">' + ic('plus') + 'Create task</button></div></div>';
  if (!mine.length) return head + calmEmpty('A clear list', 'When a task is assigned to you, it shows here.');
  const week = E.addDays(TODAY, 7);
  const planned = mine.filter(t => isOpen(t) && t.status !== 'On hold');
  const groups = [
    ['Could use a new date', planned.filter(t => t.due < TODAY)],
    ['Today', planned.filter(t => t.due === TODAY)],
    ['Next 7 days', planned.filter(t => t.due > TODAY && t.due <= week)],
    ['Later', planned.filter(t => t.due > week)],
    ['Paused', mine.filter(t => t.status === 'On hold')],
    ['Not planned yet', mine.filter(t => t.status === 'Backlog')],
    ['Done recently', mine.filter(t => t.status === 'Done').sort((a, b) => lastStatusAt(b, 'Done').localeCompare(lastStatusAt(a, 'Done'))).slice(0, 5)],
  ].filter(g => g[1].length);
  return head + groups.map(([name, list]) => '<section class="card2 list-card"><div class="ch"><h3>' + esc(name) + '</h3><span>' + list.length + '</span></div>' + list.sort((a, b) => name === 'Done recently' ? 0 : a.due.localeCompare(b.due)).map(t => taskRow(t, { when: true })).join('') + '</section>').join('');
}

// ---------- Calendar ----------
function calendarView(r) {
  const d0 = r.params.get('d'); if (d0 && E.isIso(d0)) { ui.calMonth = d0.slice(0, 7); ui.calDay = d0; history.replaceState(null, '', '#/calendar'); }
  const ym = ui.calMonth || TODAY.slice(0, 7); const [y, m] = ym.split('-').map(Number);
  const first = ym + '-01'; const lead = (dowOf(first) + 6) % 7; const start = E.addDays(first, -lead);
  const len = new Date(Date.UTC(y, m, 0)).getUTCDate(); const weeks = Math.ceil((lead + len) / 7);
  const title = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const tasks = data.tasks.filter(t => !t.archivedAt && t.status !== 'Backlog' && (!ui.calMine || t.owner === data.me));
  const ms = ui.calMine ? [] : data.milestones;
  const ev = t => '<button type="button" class="ev' + (t.status === 'Done' ? ' dn' : '') + (t.status === 'On hold' ? ' ps' : '') + '"' + pcs(t.projectId) + ' data-act="open" data-id="' + esc(t.id) + '" title="' + esc(t.key + ' · ' + t.title + ' · ' + stLabel(t.status)) + '"><span class="pd"></span><span>' + esc(t.title) + '</span></button>';
  const mev = x => '<button type="button" class="ev ms"' + pcs(x.projectId) + ' data-act="edit-milestone" data-id="' + esc(x.id) + '" title="' + esc('Milestone · ' + x.name) + '">' + ic('flag') + '<span>' + esc(x.name) + '</span></button>';
  let cells = '';
  for (let i = 0; i < weeks * 7; i++) {
    const day = E.addDays(start, i); const out = day.slice(0, 7) !== ym;
    const items = [...ms.filter(x => x.target === day).map(mev), ...tasks.filter(t => t.due === day).sort(E.byRank).map(ev)];
    cells += '<div class="cell' + (out ? ' out' : '') + (day === TODAY ? ' today' : '') + (day === ui.calDay ? ' picked' : '') + '" data-act="cal-day" data-d="' + day + '" role="group" aria-label="' + esc(dayLong(day) + (items.length ? ', ' + items.length + ' item' + (items.length > 1 ? 's' : '') : '')) + '"><span class="num">' + Number(day.slice(8)) + '</span>' + items.slice(0, 3).join('') + (items.length > 3 ? '<span class="more">+' + (items.length - 3) + ' more</span>' : '') + '</div>';
  }
  const pick = ui.calDay && ui.calDay.slice(0, 7) === ym ? ui.calDay : (TODAY.slice(0, 7) === ym ? TODAY : '');
  const dayList = pick ? (() => { const ts = tasks.filter(t => t.due === pick); const mm = ms.filter(x => x.target === pick); return '<section class="card2 cal-list"><div class="ch"><h3>' + esc(dayLong(pick)) + '</h3><span>' + (ts.length + mm.length || '') + '</span></div>' + (ts.length || mm.length ? mm.map(x => '<div class="tr"' + pcs(x.projectId) + '>' + ic('flag') + '<button type="button" class="tt" data-act="edit-milestone" data-id="' + esc(x.id) + '">' + esc(x.name) + '</button><span class="pj"><span class="pd"></span>' + esc(shortName(proj(x.projectId))) + '</span></div>').join('') + ts.map(t => taskRow(t)).join('') : '<p class="soft">Nothing due on this day.</p>') + '</section>'; })() : '';
  return boardHead('calendar') +
    '<div class="cal-head"><h3>' + esc(title) + '</h3><button type="button" class="icon-btn" data-act="cal-move" data-n="-1" aria-label="Previous month">' + ic('left') + '</button><button type="button" class="icon-btn" data-act="cal-move" data-n="1" aria-label="Next month">' + ic('right') + '</button><button type="button" class="btn ghost sm" data-act="cal-today">Today</button><span class="grow"></span><button type="button" class="chip' + (ui.calMine ? ' on' : '') + '" data-act="cal-mine" aria-pressed="' + !!ui.calMine + '">Only my tasks</button></div>' +
    '<div class="cal" role="group" aria-label="' + esc(title) + '">' + ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(x => '<span class="dow" aria-hidden="true">' + x + '</span>').join('') + cells + '</div>' + dayList;
}

// Board, List and Calendar share one header with a segmented switch.
function boardHead(active) {
  const names = { board: 'Board', backlog: 'List', calendar: 'Calendar' };
  const sort = active === 'backlog' ? '<label class="fsel"><span class="sr">Sort</span><select data-act="bl-sort">' + opts([['rank', 'Board order'], ['priority', 'Priority'], ['due', 'Due date'], ['key', 'Key']], ui.backlogSort) + '</select></label>' : '';
  const create = '<button class="btn sm create" data-act="new-task"' + (active === 'backlog' ? ' data-status="Backlog"' : '') + '>' + ic('plus') + 'Create task</button>';
  if (active !== 'calendar' && projCtx(route())) return '<h2 class="sr">' + names[active] + '</h2><div class="tbar">' + filterBar(active) + '<div class="tbar-r">' + sort + create + '</div></div>';
  const seg = [['board', 'Board'], ['backlog', 'List'], ['calendar', 'Calendar']].map(([k, l]) => '<a href="#/' + k + '"' + (k === active ? ' aria-current="page"' : '') + '>' + l + '</a>').join('');
  return '<div class="bh"><h2>' + names[active] + '</h2><nav class="seg" aria-label="View">' + seg + '</nav>' + (active === 'calendar' ? '' : '<div class="bh-f">' + filterBar(active) + '</div>') + '<span class="grow"></span>' + sort + create + '</div>';
}

// ---------- the shell: top bar, sidebar with project views, menus ----------
const pletter = p => esc((p.code || p.name || '?').replace(/[^A-Za-z]/g, '').slice(0, 1).toUpperCase() || '?');
const PVIEWS = [['summary', 'Summary', 'summary'], ['board', 'Board', 'board'], ['backlog', 'List', 'list'], ['dependencies', 'Dependencies', 'graph'], ['risks', 'Risks', 'shield']];
const pviewHref = (pid, v) => v === 'summary' ? '#/project/' + encodeURIComponent(pid) : '#/' + v + '?p=' + encodeURIComponent(pid);
// The project this screen is about: the project page itself, or a board, list, map or register narrowed to one project.
function projCtx(r) {
  if (r.name === 'project') return proj(r.id) ? r.id : '';
  if (['board', 'backlog'].includes(r.name)) return ui.q.project && proj(ui.q.project) ? ui.q.project : '';
  if (r.name === 'dependencies') return ui.deps.project && proj(ui.deps.project) ? ui.deps.project : '';
  if (r.name === 'risks') return ui.risks.project && proj(ui.risks.project) ? ui.risks.project : '';
  return '';
}
function projHeader(pid, view) {
  const p = proj(pid); const h = E.health(data, p, TODAY);
  const tone = healthTone(h.label); const lz = { ok: 'done', warn: 'pause', bad: 'pause', done: 'done', idle: 'todo' }[tone] || 'todo';
  const who = [...new Set([p.owner, ...E.projectTasks(data, p.id).map(t => t.owner)].filter(Boolean))];
  const stack = '<span class="avstack" title="' + esc(who.join(', ')) + '">' + who.slice(0, 4).map(n => avatar(n, 'xs')).join('') + (who.length > 4 ? '<span class="av xs more">+' + (who.length - 4) + '</span>' : '') + '</span>';
  return '<div class="phead"' + pcs(p.id) + '><nav class="crumbs" aria-label="Breadcrumb"><a href="#/projects">Projects</a><span aria-hidden="true">›</span><span>' + esc(p.name) + '</span></nav>' +
    '<div class="ph-title"><span class="pdot lg" aria-hidden="true">' + pletter(p) + '</span><p class="ph-name">' + esc(p.name) + '</p><span class="lz lz-' + lz + '"><i></i>' + esc(h.label === 'Critical' ? 'Needs a look' : h.label) + '</span><span class="grow"></span>' + stack +
      '<a class="btn2" href="' + esc('#/reports?type=project&p=' + encodeURIComponent(p.id)) + '">' + ic('chart') + 'Report</a></div>' +
    '<nav class="ptabs" aria-label="Project views">' + PVIEWS.map(([v, l, icn]) => '<a href="' + pviewHref(p.id, v) + '"' + ((view === 'project' ? 'summary' : view) === v ? ' aria-current="page"' : '') + '>' + ic(icn) + l + '</a>').join('') + '</nav></div>';
}
function renderSide() {
  const name = acct ? acct.wsName || 'My workspace' : 'Orbis Studio';
  $('#wsBox').textContent = name;
  const my = data.tasks.filter(t => t.owner === data.me && isOpen(t) && !t.archivedAt).length;
  const wsRow = acct && acct.workspaces.find(w => w.id === acct.wsId);
  const nPeople = wsInfo && acct && wsInfo._for === acct.wsId ? wsInfo.members.length : wsRow ? wsRow.members : 0;
  if (wsRow && nPeople) wsRow.members = nPeople;
  $('#pplCount').textContent = nPeople > 1 ? nPeople : '';
  $('#myCount').textContent = my || '';
  const r = route(); const ctx = projCtx(r); const view = r.name === 'project' ? 'summary' : r.name;
  $('#projNav').innerHTML = data.projects.filter(p => !p.archivedAt && (p.status !== 'Completed' || p.id === ctx)).slice(0, 12).map(p => {
    const open = p.id === ctx;
    return '<a class="nv pj' + (open ? ' open' : '') + '" href="#/project/' + esc(p.id) + '"' + pcs(p.id) + '><span class="pdot" aria-hidden="true">' + pletter(p) + '</span><span class="nv-t">' + esc(p.name) + '</span></a>' +
      (open ? '<div class="pviews">' + PVIEWS.map(([v, l, icn]) => '<a class="nv sub" href="' + pviewHref(p.id, v) + '"' + (view === v ? ' aria-current="page"' : '') + '>' + ic(icn) + l + '</a>').join('') + '</div>' : '');
  }).join('');
  $('#adminNav').hidden = !(acct && acct.user.admin);
  $('#meBtn').innerHTML = avatar(acct ? acct.user.displayName : data.me, 'sm');
  $('#meBtn').setAttribute('aria-label', 'Your menu: ' + (acct ? acct.user.displayName : data.me));
  $('#topSave').textContent = acct ? (acct.saveState || 'Saved') : '';
  const high = E.insights(data, TODAY).filter(i => i.level === 'high').length;
  const theme = '<button class="theme-switch" type="button" aria-label="Dark theme" aria-pressed="false" title="Light or dark">' + ic('sun', 'i-sun') + ic('moon', 'i-moon') + '</button>';
  $('#moreSheet').innerHTML = [['projects', 'Portfolio'], ['lists', 'Saved views'], ['calendar', 'Calendar'], ['backlog', 'List of all tasks'], ['dependencies', 'Dependencies'], ['risks', 'Risks'], ['insights', 'Insights' + (high ? ' · ' + high : '')], ['reports', 'Reports'], ['workspace', acct ? 'People' : 'Share'], ...(acct ? [['account', 'Your account']] : []), ...(acct && acct.user.admin ? [['admin', 'Admin']] : [])].map(([k, l]) => '<a href="#/' + k + '" data-nav="' + k + '">' + esc(l) + '</a>').join('') +
    '<div class="wide">' + (acct ? '<span>' + esc(acct.user.displayName) + '</span><button type="button" class="lnk" data-act="signout">Sign out</button>' : '<button type="button" class="lnk" data-menu="me" aria-haspopup="menu" aria-expanded="false">Viewing as ' + esc(data.me) + '</button>') + theme + '</div><a class="wide" href="/#work">← Nawres Skhairia</a>';
  if (window.ccThemeSync) window.ccThemeSync();
}
// Our own menus: a button with data-menu opens a list of actions; arrows move, Esc closes and returns focus.
let menuFrom = null;
// On a shared workspace only the owner and admins may replace or empty it (the server enforces the same rule).
const myRole = () => { const w = acct && acct.workspaces.find(x => x.id === acct.wsId); return w ? w.role : 'owner'; };
const canWipe = () => !acct || ['owner', 'admin'].includes(myRole());
function menuItems(kind) {
  const item = (label, attrs, extra = '') => '<button type="button" role="menuitem" ' + attrs + '>' + label + extra + '</button>';
  const tick = on => on ? '<svg class="i tick" aria-hidden="true"><use href="#i-check"/></svg>' : '';
  if (kind === 'status') {
    const t = task(ui.panel); if (!t) return '';
    const flow = E.TASK_STATUSES.filter(x => x !== 'On hold');
    return '<p class="m-h">Move ' + esc(t.key) + ' to</p>' + flow.map(st => '<button type="button" role="menuitemradio" aria-checked="' + (t.status === st) + '" data-act="set-status" data-s="' + esc(st) + '">' + lozenge(st) + tick(t.status === st) + '</button>').join('') +
      (t.status !== 'On hold' ? '<hr>' + item(ic('pause') + 'Pause…', 'data-act="ask-hold" data-id="' + esc(t.id) + '"') : '<hr>' + item('Resume', 'data-act="resume" data-id="' + esc(t.id) + '"'));
  }
  if (kind === 'ws') {
    const list = acct ? acct.workspaces.map(w => item(esc(w.name), 'data-act="ws-go" data-id="' + esc(w.id) + '"' + (w.id === acct.wsId ? ' aria-current="true"' : ''), tick(w.id === acct.wsId))) : [item('Orbis Studio', 'aria-current="true"', tick(true))];
    return '<p class="m-h">Workspaces</p>' + list.join('') + '<hr>' + item('People and sharing', 'data-href="#/workspace"') +
      (acct ? (canWipe() ? item('Load sample data', 'data-act="reset"') + item('Empty workspace', 'data-act="start-empty"') : '') : item('Reset sample', 'data-act="reset"') + item('Start empty', 'data-act="start-empty"'));
  }
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  const themeItem = '<button type="button" role="menuitemcheckbox" aria-checked="' + dark + '" data-act="theme-toggle">' + ic('moon') + 'Dark theme' + tick(dark) + '</button>';
  if (acct) return '<p class="m-h">' + esc(acct.user.displayName) + '<small>' + esc(acct.user.email || '') + '</small></p>' + item(ic('user') + 'Your account', 'data-href="#/account"') + themeItem + '<hr>' + item('Sign out', 'data-act="signout"');
  return '<p class="m-h">Switch person<small>The sample has made-up people.</small></p>' + people().map(n => '<button type="button" role="menuitemradio" aria-checked="' + (n === data.me) + '" data-act="me-go" data-name="' + esc(n) + '">' + avatar(n, 'xs') + esc(n) + tick(n === data.me) + '</button>').join('') + '<hr>' + themeItem + (serverOn ? item('Sign in', 'data-act="signin"') : '');
}
function openMenu(btn) {
  const pop = $('#menuPop'); if (menuFrom === btn && !pop.hidden) { closeMenu(); return; }
  closeMenu(); menuFrom = btn; btn.setAttribute('aria-expanded', 'true');
  pop.innerHTML = menuItems(btn.dataset.menu); pop.hidden = false; try { pop.showPopover(); } catch (e) {}
  pop.setAttribute('aria-label', { ws: 'Workspace', status: 'Status' }[btn.dataset.menu] || 'Your menu');
  const b = btn.getBoundingClientRect(); const w = pop.offsetWidth;
  pop.style.top = Math.max(8, Math.min(innerHeight - pop.offsetHeight - 8, b.bottom + 4)) + 'px';
  pop.style.left = Math.max(8, Math.min(innerWidth - w - 8, btn.dataset.menu === 'ws' ? b.left : b.right - w)) + 'px';
  if (window.ccThemeSync) window.ccThemeSync();
  const first = pop.querySelector('[role^="menuitem"]'); if (first) first.focus();
}
function closeMenu(back) { const pop = $('#menuPop'); if (pop.hidden) return; try { pop.hidePopover(); } catch (e) {} pop.hidden = true; if (menuFrom) { menuFrom.setAttribute('aria-expanded', 'false'); if (back) menuFrom.focus(); } menuFrom = null; }
document.addEventListener('click', e => {
  const btn = e.target.closest('[data-menu]'); if (btn) { e.preventDefault(); openMenu(btn); return; }
  const it = e.target.closest('#menuPop [role^="menuitem"]');
  if (it) { if (it.dataset.href) { closeMenu(); location.hash = it.dataset.href; } else setTimeout(() => closeMenu(), 0); return; }
  if (!e.target.closest('#menuPop')) closeMenu();
}, true);
document.addEventListener('keydown', e => {
  const pop = $('#menuPop'); if (pop.hidden) return;
  const items = $$('[role^="menuitem"]', pop); const i = items.indexOf(document.activeElement);
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(true); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
  else if (e.key === 'Home') { e.preventDefault(); items[0].focus(); }
  else if (e.key === 'End') { e.preventDefault(); items[items.length - 1].focus(); }
  else if (e.key === 'Tab') closeMenu();
}, true);

function board() {
  const list = E.applyFilter(data.tasks.filter(t => t.status !== 'Backlog'), ui.q, data.me, TODAY);
  const head = boardHead('board');
  if (!data.projects.length) return head + calmEmpty('No projects yet', 'Tasks belong to a project. Create one to start.', '<button class="btn" data-act="new-project">' + ic('plus') + 'New project</button>');
  const phone = isPhone();
  if (!E.BOARD_COLUMNS.includes(ui.mcol)) ui.mcol = 'To do';
  const mtabs = '<div class="mtabs" role="tablist" aria-label="Status">' + E.BOARD_COLUMNS.map(st => '<button type="button" role="tab" data-act="mcol" data-s="' + esc(st) + '" aria-selected="' + (ui.mcol === st) + '">' + esc(stLabel(st)) + ' <span class="n">' + list.filter(t => t.status === st).length + '</span></button>').join('') + '</div>';
  const col = (status, items, lane) => {
    const ln = lane ? ' data-lane="' + esc(lane) + '"' : '';
    if (status === 'Done' && !ui.doneOpen && !phone) { const recent = [...items].sort((a, b) => String(b.doneAt || b.due).localeCompare(String(a.doneAt || a.due))).slice(0, 8);
      return '<section class="col col-done slim" data-col="Done"' + ln + ' aria-label="Done, ' + items.length + ' tasks"><header><h3>' + lozenge('Done') + '</h3><span class="n">' + items.length + '</span></header><div class="col-body">' + recent.map(t => '<button type="button" class="drow" data-act="open" data-id="' + esc(t.id) + '">' + typeIcon(t) + '<span class="key">' + esc(t.key) + '</span><span class="dt">' + esc(t.title) + '</span></button>').join('') + (items.length ? '<button type="button" class="lnk small" data-act="done-open" aria-expanded="false">Show all ' + items.length + '</button>' : '<p class="col-empty">Finished tasks land here.</p>') + '</div></section>'; }
    const empty = status === 'On hold' ? '<div class="col-empty calm">' + ic('leaf') + '<b>Nothing paused</b><span>Everything is moving. Paused tasks wait here with their reason.</span></div>' : '<p class="col-empty">' + (status === 'Done' ? 'Finished tasks land here.' : 'Drop a task here') + '</p>';
    const tool = status === 'Done' ? (phone ? '' : '<button type="button" class="plus" data-act="done-close" aria-label="Fold the done column" title="Fold">' + ic('right') + '</button>') : status === 'On hold' ? '' : '<button type="button" class="plus" data-act="new-task" data-status="' + esc(status) + '" aria-label="Create a task in ' + esc(status) + '" title="Create a task here">' + ic('plus') + '</button>';
    return '<section class="col col-' + slug(status) + (ui.mcol === status ? ' m-on' : '') + '" data-col="' + esc(status) + '"' + ln + ' aria-label="' + esc(stLabel(status)) + '"><header><h3>' + lozenge(status) + '</h3><span class="n">' + items.length + '</span>' + tool + '</header><div class="col-body">' + items.sort(E.byRank).map(card).join('') + (items.length ? '' : empty) + '</div></section>';
  };
  const cls = 'board' + (ui.doneOpen ? ' done-open' : '');
  if (ui.group === 'people') {
    const ppl = [...new Set(list.map(t => t.owner))].sort();
    if (!ppl.length) return head + calmEmpty('No match', 'Try a person, a project or a label, or clear the filters.', '<button class="btn ghost" data-act="clear-q">Clear filters</button>');
    return head + mtabs + '<div class="lanes">' + ppl.map(p => { const mine = list.filter(t => t.owner === p); return '<div class="lane"><div class="lane-h">' + avatar(p) + '<b>' + esc(p) + '</b><span class="muted small">' + mine.length + ' tasks · ' + mine.filter(t => t.status !== 'Done').reduce((s, t) => s + t.estimate, 0) + ' days open</span></div><div class="' + cls + '">' + E.BOARD_COLUMNS.map(st => col(st, mine.filter(t => t.status === st), p)).join('') + '</div></div>'; }).join('') + '</div>';
  }
  return head + (list.length || !activeFilterCount() ? '' : '<p class="note">No match' + (ui.q.text ? ' for "' + esc(ui.q.text) + '"' : '') + '. Try a person, a project or a label. <button class="lnk" data-act="clear-q">Clear filters</button></p>') + mtabs + '<div class="' + cls + '">' + E.BOARD_COLUMNS.map(st => col(st, list.filter(t => t.status === st))).join('') + '</div>';
}

function backlog() {
  const list = E.applyFilter(data.tasks, ui.q, data.me, TODAY);
  const rank = { Critical: 0, High: 1, Medium: 2, Low: 3 };
  const sorters = { rank: E.byRank, due: (a, b) => a.due.localeCompare(b.due), priority: (a, b) => rank[a.priority] - rank[b.priority] || a.due.localeCompare(b.due), key: (a, b) => a.key.localeCompare(b.key, 'en', { numeric: true }) };
  const sorted = list.sort(sorters[ui.backlogSort] || E.byRank);
  for (const id of [...ui.sel]) if (!data.tasks.some(t => t.id === id)) ui.sel.delete(id);
  const groups = [['Not planned yet', 'Backlog', sorted.filter(t => t.status === 'Backlog')], ['Planned', 'On the board', sorted.filter(t => t.status !== 'Backlog' && t.status !== 'Done')], ['Done', 'Finished', sorted.filter(t => t.status === 'Done')]];
  const row = t => { const p = proj(t.projectId); return '<tr class="' + (ui.sel.has(t.id) ? 'sel' : '') + '" data-flip="' + esc(t.id) + '"><td class="selc"><input type="checkbox" data-act="sel" data-id="' + esc(t.id) + '"' + (ui.sel.has(t.id) ? ' checked' : '') + ' aria-label="Select ' + esc(t.key) + '"></td><td class="c-ty">' + typeIcon(t) + '</td><td class="key">' + esc(t.key) + '</td>' +
    '<td class="sum"><button type="button" class="bl-title" data-act="open" data-id="' + esc(t.id) + '">' + esc(t.title) + '</button>' + (t.status === 'On hold' && t.holdReason ? '<span class="wait"> · ' + esc(/^waiting\b/i.test(t.holdReason) ? lowerFirst(cut(t.holdReason, 50)) : 'waiting for ' + lowerFirst(cut(t.holdReason, 50))) + '</span>' : '') + '</td>' +
    '<td>' + lozenge(t.status) + '</td><td class="who">' + avatar(t.owner, 'xs') + '<span>' + esc(t.owner) + '</span></td><td class="c-pr">' + prioIcon(t.priority, true) + '</td><td>' + dueSpan(t) + '</td><td class="r">' + estPill(t) + '</td><td class="c-pj">' + (p ? '<span class="pdot"' + pcs(p.id) + ' aria-hidden="true">' + pletter(p) + '</span><span>' + esc(p.name) + '</span>' : '') + '</td></tr>'; };
  const n = ui.sel.size;
  return boardHead('backlog') +
    (sorted.length ? '<div class="ltbl-wrap"><table class="ltbl"><thead><tr><th class="selc"><input type="checkbox" data-act="sel-all"' + (n && n === sorted.length ? ' checked' : '') + ' aria-label="Select all ' + sorted.length + '"></th><th class="c-ty"><span class="sr">Type</span></th><th>Key</th><th>Summary</th><th>Status</th><th>Assignee</th><th>Priority</th><th>Due</th><th class="r">Estimate</th><th>Project</th></tr></thead>' +
      groups.filter(g => g[2].length).map(([name, sub, items]) => '<tbody><tr class="grp-h"><th colspan="10" scope="rowgroup">' + esc(name) + ' <span class="n">' + items.length + '</span><span class="gsub">' + esc(sub) + '</span></th></tr>' + items.map(row).join('') + '</tbody>').join('') + '</table></div>' : calmEmpty('No match' + (ui.q.text ? ' for "' + ui.q.text + '"' : ''), 'Try a person, a project or a label.', '<button class="btn ghost" data-act="clear-q">Clear filters</button>')) +
    '<div class="bulk' + (n ? ' show' : '') + '" role="region" aria-label="Change selected tasks"' + (n ? '' : ' hidden') + '><b>' + n + ' selected</b>' +
      '<label><span class="sr">Status</span><select data-act="bulk" data-field="status">' + opts(stOpts(E.TASK_STATUSES), '', 'Status…') + '</select></label>' +
      '<label><span class="sr">Assignee</span><select data-act="bulk" data-field="owner">' + opts(people(), '', 'Assign to…') + '</select></label>' +
      '<label><span class="sr">Priority</span><select data-act="bulk" data-field="priority">' + opts(E.PRIORITIES, '', 'Priority…') + '</select></label>' +
      '<button type="button" class="lnk" data-act="bulk-label">Add label</button><button type="button" class="lnk" data-act="sel-none">Clear</button></div>';
}

function projects() {
  const prioRank = { Critical: 0, High: 1, Medium: 2, Low: 3 };
  let list = data.projects.filter(p => ui.projStatus === 'Archived' ? !!p.archivedAt : !p.archivedAt && (!ui.projStatus || p.status === ui.projStatus));
  const sorters = { deadline: (a, b) => a.deadline.localeCompare(b.deadline), name: (a, b) => a.name.localeCompare(b.name), health: (a, b) => E.health(data, a, TODAY).score - E.health(data, b, TODAY).score, priority: (a, b) => prioRank[a.priority] - prioRank[b.priority] };
  list = list.sort(sorters[ui.projSort]);
  return '<div class="vh"><div><h2>Projects</h2><p class="lede">' + data.projects.length + ' projects, sorted ' + ({ health: 'by health, weakest first', deadline: 'by deadline', name: 'by name', priority: 'by priority' }[ui.projSort]) + '.</p></div><div class="row"><label class="fsel"><span class="sr">Status</span><select data-act="proj-status">' + opts(stOpts(E.PROJECT_STATUSES).concat([['Archived', 'Archived']]), ui.projStatus, 'All statuses') + '</select></label><label class="fsel"><span class="sr">Sort</span><select data-act="proj-sort">' + opts([['health', 'Health'], ['deadline', 'Deadline'], ['priority', 'Priority'], ['name', 'Name']], ui.projSort) + '</select></label><button class="btn" data-act="new-project">New project</button></div></div>' +
    (list.length ? '<div class="pgrid">' + list.map(p => { const h = E.health(data, p, TODAY); const tasks = E.projectTasks(data, p.id); const live = p.status === 'Active' || p.status === 'On hold';
      return '<a class="pcard" href="#/project/' + esc(p.id) + '" data-flip="' + esc(p.id) + '"><div class="pc-top"><span class="key">' + esc(p.code) + '</span><span class="st st-' + slug(p.status) + '">' + esc(stLabel(p.status)) + '</span></div><div class="pc-mid">' + ring(live ? h.score : (p.status === 'Completed' ? 100 : 0), live ? healthTone(h.label) : (p.status === 'Completed' ? 'done' : 'idle'), 64) + '<div><h3>' + esc(p.name) + '</h3><p>' + esc(p.objective) + '</p></div></div><div class="pc-bar"><span class="fill grow-in tone-' + healthTone(h.label) + '" style="--w:' + (h.progress * 100).toFixed(1) + '%"></span></div><div class="pc-foot">' + avatar(p.owner, 'sm') + '<span>' + esc(p.owner) + '</span><span class="grow"></span><span class="' + (h.pastDeadline ? 'late' : 'muted') + '">' + esc(fmtDate(p.deadline, true)) + '</span><span class="muted">' + tasks.length + ' tasks</span></div></a>'; }).join('') + '</div>' : emptyState('No project here', 'Change the filter or create one.', '<button class="btn" data-act="new-project">New project</button>'));
}

function projectView(r) {
  const p = proj(r.id);
  if (!p) return '<div class="vh"><h2>Project not found</h2></div>' + emptyState('This project does not exist', 'It may have been deleted, or the demo was reset.', '<a class="btn" href="#/projects">Back to projects</a>');
  const h = E.health(data, p, TODAY); const live = p.status === 'Active' || p.status === 'On hold';
  const ms = E.projectMilestones(data, p.id); const tasks = E.projectTasks(data, p.id);
  const risks = E.projectRisks(data, p.id).sort((a, b) => E.riskScore(b) - E.riskScore(a));
  const pen = h.penalties;
  const reasons = [['Schedule', pen.schedule, h.pastDeadline ? 'Deadline passed ' + rel(p.deadline) + '.' : pct(h.progress) + ' done, ' + pct(h.expected) + ' expected by today.'], ['Milestones', pen.milestones, h.overdueMilestones.length + ' with a passed date.'], ['Risks', pen.risks, h.highRisks.length + ' high or critical, ' + (h.openRisks.length - h.highRisks.length) + ' other open.'], ['Paused and stuck', pen.blockers, h.blocked.length + ' task' + (h.blocked.length === 1 ? '' : 's') + '.']];
  const span = Math.max(1, E.daysBetween(p.start, p.deadline));
  const posOf = iso => Math.max(0, Math.min(100, E.daysBetween(p.start, iso) / span * 100));
  const counts = E.TASK_STATUSES.map(s => [s, tasks.filter(t => t.status === s).length]).filter(x => x[1]);
  return '<div class="sum-bar"><h2 class="sr">' + esc(p.name) + ' summary</h2><div class="sum-t"><p class="sum-meta">' + esc(p.code) + ' · ' + esc(p.priority) + ' priority · ' + esc(stLabel(p.status)) + ' · ' + esc(fmtDate(p.start)) + ' to ' + esc(fmtDate(p.deadline)) + '</p><p class="sum-obj">' + esc(p.objective) + '</p></div><div class="row"><button class="btn2" data-act="edit-project" data-id="' + esc(p.id) + '">Edit</button>' + (p.archivedAt ? '<button class="btn2" data-act="restore-project" data-id="' + esc(p.id) + '">Restore</button>' : p.status === 'Completed' ? '<button class="btn2" data-act="archive-project" data-id="' + esc(p.id) + '">Archive</button>' : '') + '<button class="btn2 danger" data-act="del-project" data-id="' + esc(p.id) + '">Delete</button></div></div>' +
    '<div class="grid g21">' +
      '<section class="panel"><div class="ph"><h3>Timeline</h3><span class="muted small">' + esc(fmtDate(p.start)) + ' → ' + esc(fmtDate(p.deadline)) + '</span></div>' +
        '<div class="ptl"><div class="ptl-track"><span class="ptl-done grow-in" style="--w:' + (h.progress * 100).toFixed(1) + '%"></span>' + (TODAY >= p.start && TODAY <= p.deadline ? '<span class="ptl-today" style="left:' + posOf(TODAY) + '%"><i>Today</i></span>' : '') + ms.map(m => '<button type="button" class="ptl-ms' + (m.done ? ' done' : E.isMilestoneOverdue(m, TODAY) ? ' late' : '') + '" style="left:' + posOf(m.target) + '%" data-act="edit-milestone" data-id="' + esc(m.id) + '" title="' + esc(m.name + ' · ' + fmtDate(m.target)) + '"><span class="sr">' + esc(m.name) + '</span></button>').join('') + '</div></div>' +
        '<ol class="msl">' + ms.map(m => { const od = E.isMilestoneOverdue(m, TODAY); return '<li class="' + (m.done ? 'done' : od ? 'late' : '') + '"><label class="ckb"><input type="checkbox" data-act="toggle-ms" data-id="' + esc(m.id) + '"' + (m.done ? ' checked' : '') + '><span class="sr">Mark ' + esc(m.name) + ' reached</span></label><span class="grow"><b>' + esc(m.name) + '</b><small>' + esc(fmtDate(m.target)) + ' · ' + (m.done ? 'reached' : od ? 'date passed, ' + rel(m.target) : rel(m.target)) + '</small></span><button class="lnk" data-act="edit-milestone" data-id="' + esc(m.id) + '">Edit</button></li>'; }).join('') + '</ol><button class="btn ghost sm" data-act="new-milestone" data-project="' + esc(p.id) + '">Add milestone</button>' +
        '<div class="summary"><p id="sumText">' + esc(E.statusSummary(data, p, TODAY)) + '</p><button class="lnk" data-act="copy-summary">Copy status summary</button></div></section>' +
      '<section class="panel hcard">' + ring(live ? h.score : 0, live ? healthTone(h.label) : 'idle', 120) + '<p class="hlabel tone-' + healthTone(h.label) + '">' + esc(h.label) + '</p>' +
        (live ? '<p class="small muted">Health starts at 100. Points come off for:</p><ul class="reasons">' + reasons.map(([k, v, why]) => '<li><span>' + k + '</span><b class="' + (v ? 'minus' : '') + '">' + (v ? '−' + v : '0') + '</b><small>' + esc(why) + '</small></li>').join('') + '</ul>' : '<p class="small muted">' + (p.status === 'Completed' ? 'Delivered projects are not scored.' : 'Scoring starts when the project is active.') + '</p>') +
        '<dl class="facts"><div><dt>Owner</dt><dd>' + avatar(p.owner, 'sm') + ' ' + esc(p.owner) + '</dd></div><div><dt>Risk exposure</dt><dd>' + h.exposure + '</dd></div></dl></section>' +
    '</div>' +
    '<section class="panel"><div class="ph"><h3>Tasks <small class="muted">' + tasks.length + '</small></h3><div class="row"><a class="lnk" href="#/dependencies?p=' + esc(p.id) + '">Dependency map</a><button class="btn sm" data-act="new-task" data-project="' + esc(p.id) + '">Create task</button></div></div>' +
      '<div class="stack-bar" role="img" aria-label="' + esc(counts.map(c => c[1] + ' ' + stLabel(c[0])).join(', ')) + '">' + counts.map(([s, n]) => '<span class="sb sb-' + slug(s) + '" style="flex:' + n + '" title="' + esc(stLabel(s) + ': ' + n) + '"></span>').join('') + '</div><p class="sb-legend">' + counts.map(([s, n]) => '<span><i class="sb-' + slug(s) + '"></i>' + esc(stLabel(s)) + ' ' + n + '</span>').join('') + '</p>' +
      (tasks.length ? '<ul class="bl-list">' + tasks.sort(E.byRank).map(t => '<li class="bl-row" data-flip="' + esc(t.id) + '">' + prioIcon(t.priority) + '<span class="key">' + esc(t.key) + '</span><button type="button" class="bl-title" data-act="open" data-id="' + esc(t.id) + '">' + esc(t.title) + '</button><span class="bl-labels"></span><span class="st st-' + slug(t.status) + '">' + esc(stLabel(t.status)) + '</span><span class="due' + (E.isTaskOverdue(t, TODAY) ? ' late' : '') + '">' + esc(fmtDate(t.due, true)) + '</span><span class="est">' + t.estimate + ' d</span>' + avatar(t.owner, 'sm') + '</li>').join('') + '</ul>' : emptyState('No tasks yet', 'Break the project into tasks to track it.')) + '</section>' +
    '<section class="panel"><div class="ph"><h3>Risks <small class="muted">' + risks.length + '</small></h3><button class="btn sm" data-act="new-risk" data-project="' + esc(p.id) + '">Add risk</button></div>' + riskList(risks) + '</section>';
}

function riskList(list) {
  if (!list.length) return emptyState('No risks here', 'Register what could go wrong before it does.', '', 'shield');
  return '<ul class="rlist">' + list.map(r => { const s = E.riskScore(r); return '<li class="' + (r.status === 'Closed' ? 'is-done' : '') + '"><span class="score rk-' + slug(E.riskLevel(s)) + '">' + s + '</span><div class="grow"><button type="button" class="bl-title" data-act="edit-risk" data-id="' + esc(r.id) + '">' + esc(r.title) + '</button><small>' + esc(proj(r.projectId)?.name) + ' · impact ' + r.impact + ' × probability ' + r.probability + ' · ' + esc(r.status) + '</small><p class="' + (r.mitigation ? '' : 'missing') + '">' + (r.mitigation ? esc(r.mitigation) : 'No mitigation yet') + '</p></div>' + (r.owner ? avatar(r.owner, 'sm') : '') + '</li>'; }).join('') + '</ul>';
}

function risks() {
  const f = ui.risks;
  const base = data.risks.filter(r => (!f.project || r.projectId === f.project) && (f.status === 'all' || (f.status === 'open' ? r.status !== 'Closed' : r.status === f.status)));
  const list = base.filter(r => !f.cell || (r.impact === f.cell[0] && r.probability === f.cell[1])).sort((a, b) => E.riskScore(b) - E.riskScore(a));
  let grid = '';
  for (let i = 5; i >= 1; i--) {
    grid += '<div class="mx-l" aria-hidden="true">' + i + '</div>';
    for (let pr = 1; pr <= 5; pr++) {
      const n = base.filter(r => r.impact === i && r.probability === pr).length; const s = i * pr; const on = f.cell && f.cell[0] === i && f.cell[1] === pr;
      grid += '<button class="mx-c rk-' + slug(E.riskLevel(s)) + (on ? ' on' : '') + (n ? ' has' : '') + '" style="--i:' + ((5 - i) * 5 + pr) + '" data-act="cell" data-i="' + i + '" data-p="' + pr + '" aria-pressed="' + !!on + '" aria-label="Impact ' + i + ', probability ' + pr + ': ' + n + ' risk' + (n === 1 ? '' : 's') + '">' + (n ? '<b>' + n + '</b>' : '') + '</button>';
    }
  }
  grid += '<div></div>' + [1, 2, 3, 4, 5].map(n => '<div class="mx-l" aria-hidden="true">' + n + '</div>').join('');
  return '<div class="vh"><div><h2>Risk register</h2><p class="lede">' + base.length + ' risks shown. Select a square to see the risks in it.</p></div><div class="row"><button class="btn" data-act="new-risk">New risk</button></div></div>' +
    '<div class="grid g12"><section class="panel"><div class="ph"><h3>Impact × probability</h3>' + (f.cell ? '<button class="lnk" data-act="cell-clear">Show all</button>' : '') + '</div><div class="mx-wrap"><span class="ax-y">Impact</span><div class="mx">' + grid + '</div><span class="ax-x">Probability</span></div><p class="small muted">Score = impact × probability. 15 and above is critical, 10 to 14 high.</p></section>' +
    '<section class="panel"><div class="fbar"><label class="fsel"><span class="sr">Project</span><select data-act="risk-project">' + opts(data.projects.map(p => [p.id, p.name]), f.project, 'All projects') + '</select></label><label class="fsel"><span class="sr">Status</span><select data-act="risk-status">' + opts([['open', 'Open and mitigating'], ['all', 'All'], ...E.RISK_STATUSES.map(s => [s, s])], f.status) + '</select></label></div>' + riskList(list) + '</section></div>';
}

function dependencies() {
  if (!data.projects.length) return '<div class="vh"><h2>Dependencies</h2></div>' + emptyState('No projects yet', 'Create a project and tasks to see how they depend on each other.');
  const f = ui.deps;
  if (!proj(f.project)) f.project = (data.projects.find(p => p.status === 'Active') || data.projects[0]).id;
  const p = proj(f.project); const tasks = E.projectTasks(data, p.id).filter(t => t.status !== 'Backlog');
  const head = '<div class="vh"><div><h2>Dependencies</h2><p class="lede">What waits for what in ' + esc(p.name) + ', and the chain that decides the end date.</p></div><div class="row"><label class="fsel"><span class="sr">Project</span><select data-act="dep-project">' + opts(data.projects.map(x => [x.id, x.name]), f.project) + '</select></label></div></div>';
  if (!tasks.length) return head + emptyState('No planned tasks in ' + p.name, 'Add tasks and link them with "Waits for".', '<button class="btn" data-act="new-task" data-project="' + esc(p.id) + '">Create task</button>');
  const lv = E.levels(tasks); const cp = E.criticalPath(tasks); const cpSet = new Set(cp.ids);
  const cols = {}; for (const t of tasks) (cols[lv[t.id]] = cols[lv[t.id]] || []).push(t);
  Object.values(cols).forEach(c => c.sort((a, b) => a.due.localeCompare(b.due)));
  const W = 200, H = 70, GX = 70, GY = 22, PAD = 16; const pos = {}; let maxRows = 0;
  Object.entries(cols).forEach(([l, c]) => { maxRows = Math.max(maxRows, c.length); c.forEach((t, i) => { pos[t.id] = { x: PAD + Number(l) * (W + GX), y: PAD + i * (H + GY) }; }); });
  const width = PAD * 2 + (Math.max(...Object.keys(cols).map(Number)) + 1) * (W + GX) - GX, height = PAD * 2 + maxRows * (H + GY) - GY;
  let edges = ''; let k = 0;
  for (const t of tasks) for (const d of t.deps) { if (!pos[d]) continue; const a = pos[d], b = pos[t.id]; const x1 = a.x + W, y1 = a.y + H / 2, x2 = b.x - 6, y2 = b.y + H / 2; const crit = cpSet.has(t.id) && cp.ids.indexOf(t.id) === cp.ids.indexOf(d) + 1; const met = (task(d) || {}).status === 'Done';
    edges += '<path class="edge' + (crit ? ' crit' : '') + (met ? ' met' : '') + '" style="--d:' + (k++ * 60) + 'ms" pathLength="1" d="M' + x1 + ',' + y1 + ' C' + (x1 + GX / 2) + ',' + y1 + ' ' + (x2 - GX / 2) + ',' + y2 + ' ' + x2 + ',' + y2 + '" marker-end="url(#' + (crit ? 'arrC' : 'arr') + ')"/>'; }
  const short = s => s.length > 24 ? s.slice(0, 23) + '…' : s;
  const nodes = tasks.map(t => { const o = pos[t.id]; const waits = E.isWaiting(t, tasks); const od = E.isTaskOverdue(t, TODAY); const cls = t.status === 'Done' ? 'done' : t.status === 'On hold' ? 'hold' : od ? 'late' : waits ? 'waiting' : 'ready';
    return '<g class="node ' + cls + (cpSet.has(t.id) ? ' crit' : '') + '" transform="translate(' + o.x + ',' + o.y + ')" tabindex="0" role="button" data-act="open" data-id="' + esc(t.id) + '" aria-label="' + esc(t.key + ' ' + t.title + ', ' + stLabel(t.status) + (cpSet.has(t.id) ? ', on the critical path' : '')) + '"><rect width="' + W + '" height="' + H + '" rx="12"/><text x="14" y="22" class="n-k">' + esc(t.key) + '</text><text x="14" y="42" class="n-t">' + esc(short(t.title)) + '</text><text x="14" y="59" class="n-s">' + esc(t.owner.split(' ')[0] + ' · ' + stLabel(t.status) + ' · ' + fmtDate(t.due, true)) + '</text></g>'; }).join('');
  const blockers = tasks.filter(t => t.status !== 'Done' && E.dependents(tasks, t.id).length).map(t => ({ t, n: E.downstream(tasks, t.id).length })).sort((a, b) => b.n - a.n);
  return head + '<div class="legend-row"><span><i class="lg n-ready"></i>Ready</span><span><i class="lg n-waiting"></i>Waiting</span><span><i class="lg n-late"></i>Past date</span><span><i class="lg n-hold"></i>Paused</span><span><i class="lg n-done"></i>Done</span><span><i class="lg n-crit"></i>Critical path</span></div>' +
    '<section class="panel graph-panel"><div class="graph-scroll"><svg class="graph" viewBox="0 0 ' + width + ' ' + height + '" width="' + width + '" height="' + height + '" role="group" aria-label="Dependency map of ' + esc(p.name) + '"><defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0L10,5L0,10z" class="ah"/></marker><marker id="arrC" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0L10,5L0,10z" class="ahc"/></marker></defs>' + edges + nodes + '</svg></div></section>' +
    '<div class="grid g11"><section class="panel"><h3>Critical path · ' + cp.days + ' days</h3>' + (cp.ids.length ? '<p class="small muted">The longest chain of unfinished work. A delay here delays the project.</p><ol class="cpath">' + cp.ids.map(id => { const t = task(id); return '<li><button type="button" class="bl-title" data-act="open" data-id="' + esc(id) + '"><span class="key">' + esc(t.key) + '</span> ' + esc(t.title) + '</button><small>' + esc(t.owner) + ' · ' + t.estimate + ' d · due ' + esc(fmtDate(t.due, true)) + '</small></li>'; }).join('') + '</ol>' : '<p class="muted">All tasks are done.</p>') + '</section>' +
    '<section class="panel"><h3>What holds up the most</h3>' + (blockers.length ? '<ul class="rl">' + blockers.slice(0, 6).map(({ t, n }) => '<li><span class="score ' + (E.isTaskOverdue(t, TODAY) || t.status === 'On hold' ? 'rk-critical' : 'rk-low') + '">' + n + '</span><span><button type="button" class="bl-title" data-act="open" data-id="' + esc(t.id) + '">' + esc(t.key + ' ' + t.title) + '</button><small>' + n + ' task' + (n === 1 ? '' : 's') + ' wait · ' + esc(stLabel(t.status)) + (E.isTaskOverdue(t, TODAY) ? ' · date passed' : '') + '</small></span></li>').join('') + '</ul>' : '<p class="muted">No unfinished task holds up another.</p>') + '</section></div>' + crossDeps(p, tasks);
}
function crossDeps(p, tasks) {
  const ids = new Set(E.projectTasks(data, p.id).map(t => t.id));
  const waitsOut = tasks.flatMap(t => (t.deps || []).filter(d => !ids.has(d)).map(d => ({ t, o: task(d) }))).filter(x => x.o);
  const waitedOn = data.tasks.filter(x => !ids.has(x.id)).flatMap(x => (x.deps || []).filter(d => ids.has(d)).map(d => ({ t: x, o: task(d) })));
  if (!waitsOut.length && !waitedOn.length) return '';
  const row = (a, b) => '<li><button type="button" class="bl-title" data-act="open" data-id="' + esc(a.id) + '"><span class="key">' + esc(a.key) + '</span> ' + esc(a.title) + '</button><span class="muted small"> waits for </span><button type="button" class="bl-title" data-act="open" data-id="' + esc(b.id) + '"><span class="key">' + esc(b.key) + '</span> ' + esc(b.title) + '</button><span class="st st-' + slug(b.status) + '">' + esc(stLabel(b.status)) + '</span></li>';
  return '<section class="panel xdeps"><h3>Links with other projects</h3><p class="small muted">The map above shows this project only. These tasks wait for work in another project, or another project waits for them.</p><ul class="rl">' + waitsOut.map(x => row(x.t, x.o)).join('') + waitedOn.map(x => row(x.t, x.o)).join('') + '</ul></section>';
}

function evidenceLink(ev) {
  if (ev.type === 'project') { const p = proj(ev.id); return p ? '<a class="ev" href="#/project/' + esc(p.id) + '">' + esc(p.name) + '</a>' : ''; }
  if (ev.type === 'task') { const t = task(ev.id); return t ? '<button class="ev" data-act="open" data-id="' + esc(t.id) + '">' + esc(t.key) + '</button>' : ''; }
  if (ev.type === 'risk') { const r = data.risks.find(x => x.id === ev.id); return r ? '<button class="ev" data-act="edit-risk" data-id="' + esc(r.id) + '">Risk: ' + esc(r.title.slice(0, 32)) + '</button>' : ''; }
  if (ev.type === 'milestone') { const m = data.milestones.find(x => x.id === ev.id); return m ? '<button class="ev" data-act="edit-milestone" data-id="' + esc(m.id) + '">' + esc(m.name) + '</button>' : ''; }
  return '';
}
function insightsView() {
  const list = E.insights(data, TODAY);
  return '<div class="vh"><div><h2>Insights</h2><p class="lede">Clear rules applied to the records in this workspace: dates, dependencies, scores and owners. Each insight shows the records it comes from.</p></div></div>' +
    (list.length ? '<ul class="ins-list">' + list.map((i, n) => '<li class="ins lv-' + i.level + '" style="--n:' + n + '"><div class="ins-h"><span class="lvl">' + (i.level === 'high' ? 'Act now' : 'Keep an eye') + '</span><h3>' + esc(i.title) + '</h3></div><p>' + esc(i.text) + '</p><p class="act"><b>Suggested:</b> ' + esc(i.action) + '</p><p class="evs"><span>Based on</span>' + i.evidence.slice(0, 8).map(evidenceLink).join('') + (i.evidence.length > 8 ? '<span class="muted">+' + (i.evidence.length - 8) + '</span>' : '') + '</p></li>').join('') + '</ul>' : emptyState('Nothing to flag', data.projects.length ? 'No late milestone, stuck task, unmitigated risk or overloaded person.' : 'Add projects and tasks first.'));
}

function reportData(type, pid) {
  const s = E.portfolioSummary(data, TODAY);
  if (type === 'project') {
    const p = proj(pid) || data.projects[0]; if (!p) return null; const h = E.health(data, p, TODAY);
    return { title: 'Project status: ' + p.name, intro: E.statusSummary(data, p, TODAY), sections: [
      { h: 'Milestones', head: ['Milestone', 'Target', 'State'], rows: E.projectMilestones(data, p.id).map(m => [m.name, m.target, m.done ? 'Reached' : E.isMilestoneOverdue(m, TODAY) ? 'Date passed' : 'Planned']) },
      { h: 'Open tasks', head: ['Key', 'Task', 'Assignee', 'Priority', 'Status', 'Due'], rows: E.projectTasks(data, p.id).filter(t => t.status !== 'Done').sort((a, b) => a.due.localeCompare(b.due)).map(t => [t.key, t.title, t.owner, t.priority, stLabel(t.status) + (t.status === 'On hold' ? ': ' + t.holdReason : '') + (E.isTaskOverdue(t, TODAY) ? ' (date passed)' : ''), t.due]) },
      { h: 'Open risks', head: ['Risk', 'Score', 'Owner', 'Mitigation'], rows: h.openRisks.sort((a, b) => E.riskScore(b) - E.riskScore(a)).map(r => [r.title, String(E.riskScore(r)), r.owner || '', r.mitigation || 'None yet']) }] };
  }
  if (type === 'milestones') return { title: 'Milestone report', intro: s.upcoming.length + ' milestone(s) due in the next 30 days; ' + data.milestones.filter(m => E.isMilestoneOverdue(m, TODAY)).length + ' with a passed date.', sections: [{ h: 'Open milestones', head: ['Project', 'Milestone', 'Target', 'State'], rows: data.milestones.filter(m => !m.done).sort((a, b) => a.target.localeCompare(b.target)).map(m => [proj(m.projectId)?.name || '', m.name, m.target, E.isMilestoneOverdue(m, TODAY) ? 'Date passed' : 'Planned']) }] };
  if (type === 'risks') { const open = data.risks.filter(r => r.status !== 'Closed'); return { title: 'Risk report', intro: open.length + ' open risk(s); ' + open.filter(r => E.riskScore(r) >= 10).length + ' high or critical; ' + open.filter(r => !String(r.mitigation || '').trim()).length + ' without a mitigation.', sections: [{ h: 'Open risks by score', head: ['Project', 'Risk', 'Impact', 'Probability', 'Score', 'Level', 'Owner', 'Mitigation'], rows: open.sort((a, b) => E.riskScore(b) - E.riskScore(a)).map(r => [proj(r.projectId)?.name || '', r.title, String(r.impact), String(r.probability), String(E.riskScore(r)), E.riskLevel(E.riskScore(r)), r.owner || '', r.mitigation || 'None yet']) }] }; }
  if (type === 'hold') { const h = data.tasks.filter(t => t.status === 'On hold'); return { title: 'Paused tasks', intro: h.length + ' task(s) paused.', sections: [{ h: 'Paused', head: ['Key', 'Task', 'Project', 'Assignee', 'Reason', 'Due'], rows: h.map(t => [t.key, t.title, proj(t.projectId)?.name || '', t.owner, t.holdReason, t.due]) }] }; }
  return { title: 'Portfolio overview', intro: s.total + ' projects: ' + s.active + ' active, ' + s.completed + ' completed, ' + s.delayed + ' delayed. ' + s.openTasks + ' open tasks, ' + s.overdueTasks + ' past their date.', sections: [{ h: 'Projects', head: ['Project', 'Owner', 'Status', 'Deadline', 'Progress', 'Expected', 'Health', 'Score'], rows: s.health.map(({ project: p, h }) => [p.name, p.owner, stLabel(p.status), p.deadline, pct(h.progress), p.status === 'Completed' ? '' : pct(h.expected), h.label, p.status === 'Active' || p.status === 'On hold' ? String(h.score) : '']) }] };
}
function reports() {
  const f = ui.reports;
  if (!data.projects.length) return '<div class="vh"><h2>Reports</h2></div>' + emptyState('Nothing to report yet', 'Reports are made from the projects in this workspace.');
  if (!proj(f.project)) f.project = data.projects[0].id;
  const r = reportData(f.type, f.project);
  return '<div class="vh no-print"><div><h2>Reports</h2><p class="lede">Made from the live records, ready to print, save as PDF or open in a spreadsheet.</p></div><div class="row"><button class="btn ghost" data-act="print">Print or PDF</button><button class="btn" data-act="csv">Download CSV</button></div></div>' +
    '<div class="seg no-print rep-tabs" role="group" aria-label="Report">' + [['portfolio', 'Portfolio'], ['project', 'Project'], ['milestones', 'Milestones'], ['risks', 'Risks'], ['hold', 'Paused']].map(([k, l]) => '<button type="button" data-act="rep" data-k="' + k + '" aria-pressed="' + (f.type === k) + '">' + l + '</button>').join('') + '</div>' +
    (f.type === 'project' ? '<label class="fsel no-print"><span class="sr">Project</span><select data-act="rep-project">' + opts(data.projects.map(p => [p.id, p.name]), f.project) + '</select></label>' : '') +
    '<article class="report" id="report"><header><p class="r-brand">Command Center · Orbis Studio · sample data</p><h3>' + esc(r.title) + '</h3><p class="r-date">Made on ' + esc(fmtDate(TODAY)) + ' from the records in this workspace.</p></header><p class="r-intro">' + esc(r.intro) + '</p>' +
      r.sections.map(sec => '<h4>' + esc(sec.h) + '</h4>' + (sec.rows.length ? '<div class="tbl-wrap"><table class="tbl"><thead><tr>' + sec.head.map(x => '<th scope="col">' + esc(x) + '</th>').join('') + '</tr></thead><tbody>' + sec.rows.map(row => '<tr>' + row.map((c, i) => '<td data-label="' + esc(sec.head[i]) + '">' + esc(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>' : '<p class="muted">None.</p>')).join('') + '</article>';
}
function downloadCsv() {
  const f = ui.reports; const r = reportData(f.type, f.project); if (!r) return;
  const rows = [[r.title], ['Made on', TODAY], []];
  for (const s of r.sections) { rows.push([s.h]); rows.push(s.head); s.rows.forEach(x => rows.push(x)); rows.push([]); }
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + E.toCsv(rows)], { type: 'text/csv;charset=utf-8' }));
  a.download = 'command-center-' + f.type + '-' + TODAY + '.csv'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('CSV downloaded.');
}

// ---------- task panel (side drawer, bottom sheet on phones) ----------
function openTask(id) { if (dlg.open) dlg.close(); if (route().name === 'task') { location.hash = '#/task/' + encodeURIComponent(id); return; } ui.panel = id; renderPanel(true); $$('.card').forEach(c => c.classList.toggle('sel', c.dataset.task === id)); }
function closePanel() { if (route().name === 'task') { ui.panel = null; location.hash = ui.fullFrom || '#/board'; return; } const had = ui.panel; ui.panel = null; renderPanel(); $$('.card.sel').forEach(c => c.classList.remove('sel')); if (had) { const c = document.querySelector('[data-task="' + had + '"]'); if (c) c.focus(); } }
function activityLine(h) {
  const v = x => E.isIso(x) ? fmtDate(x) : x;
  if (h.field === 'Created') return 'created the task';
  if (h.field === 'Status') return 'moved it to <b>' + esc(stLabel(h.to)) + '</b>';
  if (h.field === 'Hold reason') return h.to && h.to !== 'none' ? 'gave the reason “' + esc(h.to) + '”' : 'cleared the reason';
  if (h.field === 'Due date') return 'moved the date to <b>' + esc(v(h.to)) + '</b>';
  return 'changed ' + esc(h.field.toLowerCase()) + ' to <b>' + esc(v(h.to)) + '</b>';
}
function fitText(ta) { if (!ta) return; ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; }
function checklistBox(t) {
  const cl = t.checklist || []; const done = cl.filter(c => c.done).length;
  return '<section class="chk" aria-labelledby="chkH"><div class="chk-h"><h2 id="chkH">Checklist</h2>' + (cl.length ? '<span class="muted small">' + done + ' of ' + cl.length + ' done</span>' : '') + '</div>' +
    (cl.length ? '<div class="chk-bar" aria-hidden="true"><i style="width:' + Math.round(done / cl.length * 100) + '%"></i></div><ul class="chk-list">' + cl.map(c => '<li' + (c.done ? ' class="done"' : '') + '><label><input type="checkbox" data-act="chk-toggle" data-c="' + esc(c.id) + '"' + (c.done ? ' checked' : '') + '><span>' + esc(c.text) + '</span></label><button type="button" class="icon" data-act="chk-del" data-c="' + esc(c.id) + '" aria-label="Remove ' + esc(c.text) + '" title="Remove">' + ic('x') + '</button></li>').join('') + '</ul>' : '') +
    (cl.length < 30 ? '<form class="chk-add" data-form="chk-add"><label class="sr" for="chkNew">Add a checklist item</label><input id="chkNew" name="text" maxlength="120" placeholder="Add an item" autocomplete="off"><button type="submit" class="btn ghost">Add</button></form>' : '<p class="muted small">30 items is the most a task can hold.</p>') + '</section>';
}
function renderPanel(focus) {
  const el = $('#panel'); const t = ui.panel && task(ui.panel);
  document.body.classList.toggle('panel-open', !!t);
  if (t && route().name === 'task') el.setAttribute('role', 'main'); else el.setAttribute('role', 'complementary');
  if (!t) { el.hidden = true; el.innerHTML = ''; return; }
  const p = proj(t.projectId); const all = E.projectTasks(data, t.projectId);
  ui.recent = [t.id, ...(ui.recent || []).filter(x => x !== t.id)].slice(0, 12);
  const waitsFor = (t.deps || []).map(task).filter(Boolean); const blocks = E.dependents(data.tasks, t.id);
  const paused = t.status === 'On hold'; const since = paused ? lastStatusAt(t, 'On hold') : '';
  const remindSet = t.remindOn && t.remindOn >= TODAY;
  el.hidden = false;
  const scrollTop = el.querySelector('.pn-body') ? el.querySelector('.pn-body').scrollTop : 0;
  const draft = $('#cText') ? $('#cText').value : '';
  const full = route().name === 'task';
  const ms = data.milestones.find(m => m.id === t.milestoneId);
  const subs = E.subTasks(data, t.id); const subsDone = subs.filter(x => x.status === 'Done').length;
  const parent = t.parentId && task(t.parentId);
  const reporter = t.reporter || ((t.history || [])[0] || {}).by || p.owner;
  const watchers = t.watchers || []; const iWatch = watchers.includes(data.me);
  const created = (t.history || [])[0]; const updated = (t.history || []).slice(-1)[0];
  const stBtn = '<button type="button" class="stbtn lz-' + (LZ[t.status] || 'todo') + '" data-menu="status" aria-haspopup="menu" aria-expanded="false" aria-label="Status: ' + esc(stLabel(t.status)) + '. Change">' + esc(stLabel(t.status)) + ic('down') + '</button>';
  const linkRow = (verb, d) => '<li><span class="lk-v">' + verb + '</span>' + typeIcon(d) + '<span class="key">' + esc(d.key) + '</span><button type="button" class="bl-title" data-act="open" data-id="' + esc(d.id) + '">' + esc(d.title) + '</button>' + lozenge(d.status) + '</li>';
  const rail = '<section class="pn-rail" aria-label="Details"><section class="rbox"><h2 class="rbox-h">Details</h2><dl class="pn-grid">' +
      '<dt>Assignee</dt><dd><div class="who">' + avatar(t.owner, 'xs') + '<select data-field="owner" aria-label="Assignee">' + opts(people(), t.owner) + '</select></div>' + (t.owner !== data.me ? '<button type="button" class="lnk small" data-act="assign-me">Assign to me</button>' : '') + '</dd>' +
      '<dt>Reporter</dt><dd><div class="who plain">' + avatar(reporter, 'xs') + '<span>' + esc(reporter) + '</span></div></dd>' +
      '<dt>Priority</dt><dd class="pr-dd">' + prioIcon(t.priority) + '<select data-field="priority" aria-label="Priority">' + opts(E.PRIORITIES, t.priority) + '</select></dd>' +
      '<dt>Due date</dt><dd><input type="date" data-field="due" value="' + esc(t.due) + '" aria-label="Due date"' + (isPast(t) ? ' class="late"' : '') + '>' + (isPast(t) ? '<button type="button" class="lnk small" data-act="new-date" data-id="' + esc(t.id) + '">Give it a new date</button>' : '') + '</dd>' +
      '<dt>Estimate</dt><dd><label class="est-in"><input type="number" min="1" max="60" step="1" data-field="estimate" value="' + t.estimate + '" aria-label="Estimate in days of work"><span>days</span></label></dd>' +
      '<dt>Milestone</dt><dd><select data-field="milestoneId" aria-label="Milestone">' + opts(data.milestones.filter(m => m.projectId === t.projectId).map(m => [m.id, m.name]), t.milestoneId, 'None') + '</select></dd>' +
      '<dt>Labels</dt><dd><div class="lbls">' + (t.labels || []).map(l => '<span class="lbl">' + esc(l) + '<button type="button" data-act="rm-label" data-l="' + esc(l) + '" aria-label="Remove label ' + esc(l) + '">×</button></span>').join('') + '<input list="labelList" class="lbl-in" placeholder="Add label" aria-label="Add a label" maxlength="20" data-act="add-label"></div><datalist id="labelList">' + E.allLabels(data).map(l => '<option value="' + esc(l) + '">').join('') + '</datalist></dd>' +
      '<dt>Watchers</dt><dd><div class="who plain">' + (watchers.length ? '<span class="avstack" title="' + esc(watchers.join(', ')) + '">' + watchers.slice(0, 4).map(n => avatar(n, 'xs')).join('') + '</span><span>' + watchers.length + '</span>' : '<span class="muted">Nobody yet</span>') + '</div><button type="button" class="lnk small" data-act="watch" aria-pressed="' + iWatch + '">' + (iWatch ? 'Stop watching' : 'Watch') + '</button></dd>' +
    '</dl></section>' +
    '<section class="rbox"><h2 class="rbox-h">Attachments</h2><p class="muted small">Files are coming later.</p></section>' +
    '<p class="pn-stamp">' + (created ? 'Created ' + esc(fmtStamp(created.at)) + ' by ' + esc(firstName(created.by)) : '') + (updated && updated !== created ? ' · Updated ' + esc(fmtStamp(updated.at)) : '') + '</p></section>';
  const tabs = [['all', 'All'], ['comments', 'Comments ' + ((t.comments || []).length || '')], ['activity', 'History']];
  if (!tabs.some(x => x[0] === ui.panelTab)) ui.panelTab = 'all';
  const feed = [...(t.history || []).map(h => ({ at: h.at, h })), ...(t.comments || []).map(c => ({ at: c.at, c }))].filter(x => ui.panelTab === 'all' || (ui.panelTab === 'comments' ? x.c : x.h)).sort((x, y) => String(y.at).localeCompare(String(x.at)));
  const entry = x => x.c ? '<li class="ev-c">' + avatar(x.c.by, 'sm') + '<div><p class="ev-h"><b>' + esc(x.c.by) + '</b> <small>' + esc(fmtStamp(x.c.at)) + '</small></p><p class="ev-t">' + esc(x.c.text) + '</p></div></li>' : '<li>' + avatar(x.h.by, 'sm') + '<p><b>' + esc(firstName(x.h.by)) + '</b> ' + activityLine(x.h) + ' <small>' + esc(fmtStamp(x.h.at)) + '</small></p></li>';
  const top = '<div class="pn-top">' +
    '<label class="sr" for="pnTitle">Title</label><textarea id="pnTitle" class="pn-title" rows="1" maxlength="100" data-field="title">' + esc(t.title) + '</textarea>' +
    '<div class="pn-acts">' + stBtn + (!paused && t.status !== 'Done' ? '<button type="button" class="btn2" data-act="ask-hold" data-id="' + esc(t.id) + '">' + ic('pause') + 'Pause</button>' : '') +
      (!t.parentId ? '<button type="button" class="btn2" data-act="sub-focus">' + ic('plus') + 'Sub-task</button>' : '') + '<button type="button" class="btn2" data-act="edit-deps">' + ic('link') + 'Link work</button>' +
      (isPast(t) ? pastChip(t) : '') + (t.archivedAt ? '<span class="chip2 c-n">Archived ' + esc(fmtDate(t.archivedAt, true)) + '</span><button type="button" class="lnk" data-act="restore-task">Restore</button>' : t.status === 'Done' ? '<button type="button" class="lnk" data-act="archive-task">Archive</button>' : '') + '</div>' +
    (paused ? '<div class="why"><b>Why it\'s paused</b><p>' + esc(t.holdReason) + (since ? ' <small>Since ' + esc(fmtDate(since, true)) + '</small>' : '') + '</p><div class="acts"><button type="button" class="btn" data-act="resume" data-id="' + esc(t.id) + '">Resume</button><button type="button" class="btn ghost" data-act="remind" data-id="' + esc(t.id) + '" aria-pressed="' + !!remindSet + '">' + ic('bell') + (remindSet ? 'Reminder on ' + esc(weekday(t.remindOn)) : 'Remind me ' + esc(weekday(nextRemind()))) + '</button></div></div>' : '') + '</div>';
  const main = '<div class="pn-main">' +
    '<section class="pn-sec"><h2 class="pn-h" id="descH">Description</h2><textarea id="pnDesc" class="pn-desc" data-field="description" rows="3" maxlength="4000" aria-labelledby="descH" placeholder="Add a description…">' + esc(t.description || '') + '</textarea></section>' +
    (t.parentId ? '' : '<section class="pn-sec"><div class="pn-hrow"><h2 class="pn-h">Sub-tasks</h2>' + (subs.length ? '<span class="muted small">' + subsDone + ' of ' + subs.length + ' done</span>' : '') + '</div>' +
      (subs.length ? '<div class="chk-bar" aria-hidden="true"><i style="width:' + Math.round(subsDone / subs.length * 100) + '%"></i></div><ul class="subs">' + subs.map(x => '<li><input type="checkbox" data-act="sub-done" data-id="' + esc(x.id) + '"' + (x.status === 'Done' ? ' checked' : '') + ' aria-label="' + esc(x.key) + ' done"' + (x.status === 'On hold' ? ' disabled' : '') + '>' + typeIcon(x) + '<span class="key">' + esc(x.key) + '</span><button type="button" class="bl-title' + (x.status === 'Done' ? ' done' : '') + '" data-act="open" data-id="' + esc(x.id) + '">' + esc(x.title) + '</button>' + lozenge(x.status) + avatar(x.owner, 'xs') + '</li>').join('') + '</ul>' : '') +
      '<form class="sub-add" data-form="sub-add"><label class="sr" for="subNew">Add a sub-task</label><input id="subNew" name="title" maxlength="100" placeholder="+ Add sub-task" autocomplete="off"></form></section>') +
    checklistBox(t) +
    '<section class="pn-sec"><div class="pn-hrow"><h2 class="pn-h">Linked work</h2></div>' + (waitsFor.length || blocks.length || parent ? '<ul class="links">' + (parent ? linkRow('sub-task of', parent) : '') + waitsFor.map(d => linkRow('waits for', d)).join('') + blocks.map(d => linkRow('blocks', d)).join('') + '</ul>' : '<p class="muted small">Nothing linked. It can start any time.</p>') + '</section>' +
    '<section class="pn-sec"><h2 class="pn-h">Activity</h2><div class="atabs" role="tablist" aria-label="Activity">' + tabs.map(([k, l]) => '<button type="button" role="tab" data-act="ptab" data-k="' + k + '" aria-selected="' + (ui.panelTab === k) + '">' + l + '</button>').join('') + '</div>' +
      '<form class="composer top" data-form="comment"><label class="sr" for="cText">Write a note for the team</label><textarea id="cText" name="text" rows="1" maxlength="1000" placeholder="Write a note for the team…"></textarea><button type="submit" class="icon send" aria-label="Post the note" title="Post · Ctrl+Enter">' + ic('send') + '</button><small class="err" hidden></small></form>' +
      (feed.length ? '<ol class="history">' + feed.map(entry).join('') + '</ol>' : '<p class="muted small pad">No comments yet. Write the first note above.</p>') + '</section>' +
    '</div>';
  el.innerHTML = '<div class="pn-head"><nav class="crumb" aria-label="Where this task is"' + pcs(t.projectId) + '><a href="#/projects">Projects</a><span aria-hidden="true">›</span><a href="#/project/' + esc(p.id) + '">' + esc(p.name) + '</a>' + (ms ? '<span aria-hidden="true">›</span><span>' + esc(ms.name) + '</span>' : '') + (parent ? '<span aria-hidden="true">›</span><a href="#/task/' + esc(parent.id) + '">' + esc(parent.key) + '</a>' : '') + '<span aria-hidden="true">›</span><span class="crumb-k">' + typeIcon(t) + esc(t.key) + '</span></nav><span class="grow"></span>' +
      (full ? '' : '<button type="button" class="icon" data-act="full-page" aria-label="Open as a full page" title="Open as a full page">' + ic('expand') + '</button>') +
      '<button type="button" class="icon" data-act="copy-link" aria-label="Copy a link to this task" title="Copy link">' + ic('link') + '</button>' +
      '<button type="button" class="icon" data-act="del-task" data-id="' + esc(t.id) + '" aria-label="Delete task" title="Delete">' + ic('trash') + '</button>' +
      '<button type="button" class="icon" data-act="close-panel" aria-label="Close" title="Close (Esc)">' + ic('x') + '</button></div>' +
    '<div class="pn-body' + (full ? ' two-col' : '') + '">' + top + rail + main + '</div>';
  if (draft) $('#cText').value = draft;
  fitText($('#pnTitle'));
  if (scrollTop) el.querySelector('.pn-body').scrollTop = scrollTop;
  if (focus) el.querySelector('[data-act="close-panel"]').focus({ preventScroll: true });
}
function panelUpdate(patch, message) {
  const r = E.updateTask(data, ui.panel, patch, data.me, stamp());
  if (Object.keys(r.errors).length) { toast(Object.values(r.errors)[0], 'error'); renderPanel(); return false; }
  commit(r.data, message, { undo: true });
  return true;
}

// ---------- dialogs ----------
const dlg = $('#dlg');
function field(name, label, control, hint) { return '<div class="fld" data-field="' + name + '"><label for="f-' + name + '">' + label + '</label>' + control + (hint ? '<small class="hint">' + hint + '</small>' : '') + '<small class="err" id="e-' + name + '" hidden></small></div>'; }
const input = (name, val, type = 'text', extra = '') => '<input id="f-' + name + '" name="' + name + '" type="' + type + '" value="' + esc(val ?? '') + '" ' + extra + '>';
const select = (name, list, val, blank) => '<select id="f-' + name + '" name="' + name + '">' + opts(list, val, blank) + '</select>';
const peopleList = () => '<datalist id="peopleList">' + people().map(o => '<option value="' + esc(o) + '">').join('') + '</datalist>';
function openForm(title, body, onSubmit, extraBtn = '', submitLabel = 'Save') {
  dlg.innerHTML = '<form method="dialog" novalidate class="form"><header><h2 id="dlgTitle">' + esc(title) + '</h2><button type="button" class="icon-btn" data-close aria-label="Close">' + ic('x') + '</button></header><div class="form-body">' + body + '</div><footer>' + extraBtn + '<span class="grow"></span><button type="button" class="btn ghost" data-close>Cancel</button><button type="submit" class="btn">' + esc(submitLabel) + '</button></footer></form>';
  enhance(dlg);
  const form = dlg.querySelector('form');
  form.addEventListener('submit', e => {
    e.preventDefault();
    form.querySelectorAll('.err').forEach(x => { x.hidden = true; x.textContent = ''; });
    form.querySelectorAll('[aria-invalid]').forEach(x => x.removeAttribute('aria-invalid'));
    const result = onSubmit(new FormData(form), form);
    if (result && typeof result.then === 'function') {
      const btn = form.querySelector('[type=submit]'); btn.disabled = true; btn.setAttribute('aria-busy', 'true');
      result.then(errs => { btn.disabled = false; btn.removeAttribute('aria-busy'); showErrors(errs); });
      return;
    }
    showErrors(result);
  });
  function showErrors(errors) {
    if (errors === false) return; // keep the dialog open, the handler has replaced it
    if (errors && Object.keys(errors).length) {
      let first = null;
      for (const [k, msg] of Object.entries(errors)) { const el = form.querySelector('#e-' + k); const ctl0 = form.querySelector('[name="' + k + '"]'); const ctl = ctl0 && ctl0.type === 'hidden' ? ctl0.nextElementSibling : ctl0; if (el) { el.textContent = msg; el.hidden = false; } if (ctl) { ctl.setAttribute('aria-invalid', 'true'); ctl.setAttribute('aria-describedby', 'e-' + k); first = first || ctl; } }
      if (!first) toast(Object.values(errors)[0], 'error');
      (first || form.querySelector('input:not([type=hidden]),.osel,.odate,textarea')).focus();
      form.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(0)' }], { duration: 240 });
      return;
    }
    if (dlg.querySelector('form') === form) dlg.close();
  }
  dlg.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => dlg.close()));
  if (!dlg.open) dlg.showModal();
  const f = form.querySelector('input:not([type=hidden]),.osel,.odate,textarea'); if (f) f.focus();
}
function confirmBox(title, text, okLabel, onOk) {
  dlg.innerHTML = '<form method="dialog" class="form confirm"><header><h2 id="dlgTitle">' + esc(title) + '</h2></header><div class="form-body"><p>' + esc(text) + '</p></div><footer><span class="grow"></span><button type="button" class="btn ghost" data-close>Cancel</button><button type="submit" class="btn danger">' + esc(okLabel) + '</button></footer></form>';
  dlg.querySelector('form').addEventListener('submit', e => { e.preventDefault(); dlg.close(); onOk(); });
  dlg.querySelector('[data-close]').addEventListener('click', () => dlg.close());
  if (!dlg.open) dlg.showModal(); dlg.querySelector('[data-close]').focus();
}
function askHold(id, onDone, onCancel) {
  const t = task(id);
  openForm('Pause ' + t.key, '<p class="muted">' + esc(t.title) + '</p>' + field('holdReason', 'Why is it paused?', '<textarea id="f-holdReason" name="holdReason" rows="3" maxlength="200" placeholder="For example: waiting for access from the finance team"></textarea>', 'Everyone sees this on the card until the task resumes.'),
    fd => { const reason = String(fd.get('holdReason') || '').trim(); if (!reason) return { holdReason: 'Say why the task is paused.' }; onDone(reason); }, '', 'Pause');
  dlg.addEventListener('close', function c() { dlg.removeEventListener('close', c); if (onCancel && task(id) && task(id).status !== 'On hold') onCancel(); });
}

function projectForm(p) {
  const isNew = !p; p = p || { id: E.uid('p'), name: '', code: '', objective: '', description: '', owner: data.me, start: TODAY, deadline: E.addDays(TODAY, 60), status: 'Planned', priority: 'Medium' };
  openForm(isNew ? 'New project' : 'Edit project',
    '<div class="two">' + field('name', 'Name', input('name', p.name, 'text', 'maxlength="60" required autocomplete="off"')) + field('code', 'Key', input('code', p.code, 'text', 'maxlength="5" required autocomplete="off" style="text-transform:uppercase"' + (isNew ? '' : ' readonly')), isNew ? '2 to 5 letters. Task keys start with it.' : 'Fixed: task keys use it.') + '</div>' +
    field('owner', 'Owner', input('owner', p.owner, 'text', 'list="peopleList" maxlength="40" required autocomplete="off"')) + peopleList() +
    field('objective', 'Objective', '<textarea id="f-objective" name="objective" rows="2" maxlength="240">' + esc(p.objective) + '</textarea>') +
    field('description', 'Description', '<textarea id="f-description" name="description" rows="2" maxlength="1000">' + esc(p.description) + '</textarea>') +
    '<div class="two">' + field('start', 'Start', input('start', p.start, 'date', 'required')) + field('deadline', 'Deadline', input('deadline', p.deadline, 'date', 'required')) + '</div>' +
    '<div class="two">' + field('status', 'Status', select('status', stOpts(E.PROJECT_STATUSES), p.status)) + field('priority', 'Priority', select('priority', E.PRIORITIES, p.priority)) + '</div>',
    fd => {
      const next = { ...p, name: fd.get('name').trim(), code: fd.get('code').trim().toUpperCase(), owner: fd.get('owner').trim(), objective: fd.get('objective').trim(), description: fd.get('description').trim(), start: fd.get('start'), deadline: fd.get('deadline'), status: fd.get('status'), priority: fd.get('priority') };
      const errors = E.validateProject(next, data.projects); if (Object.keys(errors).length) return errors;
      commit({ ...data, projects: isNew ? [...data.projects, next] : data.projects.map(x => x.id === next.id ? next : x) }, isNew ? 'Project ' + next.name + ' created.' : 'Project saved.');
      if (isNew) location.hash = '#/project/' + next.id;
    });
}
function milestoneForm(m, projectId) {
  const isNew = !m; m = m || { id: E.uid('m'), projectId: projectId || (data.projects[0] || {}).id, name: '', target: E.addDays(TODAY, 14), done: false };
  openForm(isNew ? 'New milestone' : 'Edit milestone',
    field('name', 'Name', input('name', m.name, 'text', 'maxlength="80" required autocomplete="off"')) +
    '<div class="two">' + field('projectId', 'Project', select('projectId', data.projects.map(p => [p.id, p.name]), m.projectId)) + field('target', 'Target date', input('target', m.target, 'date', 'required')) + '</div>' +
    '<label class="ckline"><input type="checkbox" name="done"' + (m.done ? ' checked' : '') + '> Reached</label>',
    fd => {
      const next = { ...m, name: fd.get('name').trim(), projectId: fd.get('projectId'), target: fd.get('target'), done: fd.get('done') === 'on' };
      const errors = E.validateMilestone(next, proj(next.projectId)); if (Object.keys(errors).length) return errors;
      commit({ ...data, milestones: isNew ? [...data.milestones, next] : data.milestones.map(x => x.id === next.id ? next : x) }, isNew ? 'Milestone added.' : 'Milestone saved.', { undo: true });
    }, isNew ? '' : '<button type="button" class="btn ghost danger" id="delMs">Delete</button>');
  const del = $('#delMs', dlg); if (del) del.addEventListener('click', () => { dlg.close(); commit(E.deleteMilestone(data, m.id), 'Milestone deleted.', { undo: true }); });
}
function taskForm(projectId, status) {
  const pid = projectId || ui.q.project || (data.projects.find(p => p.status === 'Active') || data.projects[0] || {}).id;
  if (!pid) { toast('Create a project first.', 'error'); return; }
  openForm('Create task',
    field('title', 'What needs to be done', input('title', '', 'text', 'maxlength="100" required autocomplete="off"')) +
    '<div class="three">' + field('type', 'Type', select('type', E.WORK_TYPES, 'Task')) + field('projectId', 'Project', select('projectId', data.projects.map(p => [p.id, p.name + ' · ' + p.code]), pid)) + field('owner', 'Assignee', input('owner', data.me, 'text', 'list="peopleList" maxlength="40" required autocomplete="off"')) + '</div>' + peopleList() +
    '<div class="three">' + field('status', 'Status', select('status', E.TASK_STATUSES.filter(s => s !== 'On hold').map(s => [s, s === 'Backlog' ? 'Not planned yet' : s]), status || 'To do')) + field('priority', 'Priority', select('priority', E.PRIORITIES, 'Medium')) + field('estimate', 'Days of work', input('estimate', 2, 'number', 'min="1" max="60" step="1" inputmode="numeric" required')) + '</div>' +
    '<div class="two">' + field('due', 'Due date', input('due', E.addDays(TODAY, 7), 'date', 'required')) + field('labels', 'Labels', input('labels', '', 'text', 'placeholder="for example: frontend, release" autocomplete="off"'), 'Separate with commas') + '</div>',
    fd => {
      const projectId = fd.get('projectId');
      const col = data.tasks.filter(t => t.status === fd.get('status'));
      const next = { id: E.uid('t'), key: E.nextKey(data, projectId), projectId, type: fd.get('type') || 'Task', reporter: data.me, watchers: [data.me], title: fd.get('title').trim(), owner: fd.get('owner').trim(), priority: fd.get('priority'), status: fd.get('status'), estimate: Number(fd.get('estimate')), due: fd.get('due'), labels: [...new Set(String(fd.get('labels') || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean))], deps: [], milestoneId: '', holdReason: '', heldFrom: '', rank: (col.length ? Math.min(...col.map(t => t.rank)) : 1) - 1, comments: [], history: [{ at: stamp(), by: data.me, field: 'Created', from: '', to: '' }] };
      next.history[0].to = next.key;
      const errors = E.validateTask(next, data); if (Object.keys(errors).length) return errors;
      commit({ ...data, tasks: [...data.tasks, next] }, next.key + ' created.', { undo: true });
      openTask(next.id);
    }, '', 'Create');
}
function dateForm(id) {
  const t = task(id); const opt = [['Tomorrow', E.addDays(TODAY, 1)], ['Next Monday', E.addDays(TODAY, ((8 - dowOf(TODAY)) % 7) || 7)], ['In a week', E.addDays(TODAY, 7)]];
  openForm('A new date for ' + t.key, '<p class="muted">' + esc(t.title) + '</p><div class="row quick-dates">' + opt.map(([l, d]) => '<button type="button" class="chip" data-pick="' + d + '">' + l + ' · ' + esc(fmtDate(d, true)) + '</button>').join('') + '</div>' + field('due', 'Or choose a date', input('due', t.due < TODAY ? TODAY : t.due, 'date', 'required')),
    fd => { const r = E.updateTask(data, id, { due: fd.get('due') }, data.me, stamp()); if (Object.keys(r.errors).length) return r.errors; commit(r.data, t.key + ' now due ' + fmtDate(fd.get('due'), true) + '.', { undo: true }); }, '', 'Save the date');
  $$('[data-pick]', dlg).forEach(b => b.addEventListener('click', () => { $('#f-due', dlg).value = b.dataset.pick; dlg.querySelector('form').requestSubmit(); }));
}
function depsForm(id) {
  const t = task(id); const here = x => x.projectId === t.projectId ? 0 : 1; const choices = data.tasks.filter(x => x.id !== t.id && (!x.archivedAt || t.deps.includes(x.id))).sort((a, b) => here(a) - here(b) || a.key.localeCompare(b.key));
  openForm('What does ' + t.key + ' wait for?', choices.length ? '<div class="deplist" role="group" aria-label="Waits for">' + choices.map(x => '<label class="dep"><input type="checkbox" name="deps" value="' + esc(x.id) + '"' + (t.deps.includes(x.id) ? ' checked' : '') + '> <span class="key">' + esc(x.key) + '</span> <span>' + esc(x.title) + '</span> <small class="muted">' + esc(x.status) + '</small></label>').join('') + '</div><small class="err" id="e-deps" hidden></small>' : '<p class="muted">No other task in this project.</p>',
    fd => { const r = E.updateTask(data, id, { deps: fd.getAll('deps') }, data.me, stamp()); if (Object.keys(r.errors).length) return r.errors; commit(r.data, 'Dependencies saved.', { undo: true }); });
}
function riskForm(r, projectId) {
  const isNew = !r; r = r || { id: E.uid('r'), projectId: projectId || ui.risks.project || (data.projects[0] || {}).id, title: '', impact: 3, probability: 3, owner: data.me, mitigation: '', status: 'Open' };
  const scale = [[1, '1 · Very low'], [2, '2 · Low'], [3, '3 · Medium'], [4, '4 · High'], [5, '5 · Very high']];
  openForm(isNew ? 'New risk' : 'Edit risk',
    field('title', 'What could go wrong', input('title', r.title, 'text', 'maxlength="120" required autocomplete="off"')) +
    '<div class="two">' + field('projectId', 'Project', select('projectId', data.projects.map(p => [p.id, p.name]), r.projectId)) + field('owner', 'Owner', input('owner', r.owner, 'text', 'list="peopleList" maxlength="40" autocomplete="off"')) + '</div>' + peopleList() +
    '<div class="three">' + field('impact', 'Impact', select('impact', scale, r.impact)) + field('probability', 'Probability', select('probability', scale, r.probability)) + field('status', 'Status', select('status', E.RISK_STATUSES, r.status)) + '</div><p class="score-live" id="scoreLive" aria-live="polite"></p>' +
    field('mitigation', 'Mitigation action', '<textarea id="f-mitigation" name="mitigation" rows="3" maxlength="400">' + esc(r.mitigation) + '</textarea>'),
    fd => {
      const next = { ...r, title: fd.get('title').trim(), projectId: fd.get('projectId'), owner: fd.get('owner').trim(), impact: Number(fd.get('impact')), probability: Number(fd.get('probability')), status: fd.get('status'), mitigation: fd.get('mitigation').trim() };
      const errors = E.validateRisk(next); if (Object.keys(errors).length) return errors;
      commit({ ...data, risks: isNew ? [...data.risks, next] : data.risks.map(x => x.id === next.id ? next : x) }, isNew ? 'Risk registered.' : 'Risk saved.', { undo: true });
    }, isNew ? '' : '<button type="button" class="btn ghost danger" id="delRisk">Delete</button>');
  const live = () => { const s = Number($('#f-impact', dlg).value) * Number($('#f-probability', dlg).value); $('#scoreLive', dlg).innerHTML = 'Score <b class="score rk-' + slug(E.riskLevel(s)) + '">' + s + '</b> ' + E.riskLevel(s); };
  $('#f-impact', dlg).addEventListener('change', live); $('#f-probability', dlg).addEventListener('change', live); live();
  const del = $('#delRisk', dlg); if (del) del.addEventListener('click', () => { dlg.close(); commit({ ...data, risks: data.risks.filter(x => x.id !== r.id) }, 'Risk deleted.', { undo: true }); });
}

// ---------- drag and drop on the board (mouse, pen and touch) ----------
let drag = null;
function setupBoardDnD() {
  $$('.card', $('#main')).forEach(c => c.addEventListener('pointerdown', onDown));
}
function onDown(e) {
  if (e.button !== 0 || e.target.closest('button, a, select, input')) return;
  const card = e.currentTarget;
  drag = { card, id: card.dataset.task, x0: e.clientX, y0: e.clientY, started: false, touch: e.pointerType === 'touch', pid: e.pointerId, timer: null };
  if (drag.touch) drag.timer = setTimeout(() => { if (drag && !drag.started) startDrag(e.clientX, e.clientY); }, 260);
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp, { once: true });
  document.addEventListener('pointercancel', cancelDrag, { once: true });
}
function startDrag(x, y) {
  const r = drag.card.getBoundingClientRect();
  drag.started = true; drag.dx = x - r.left; drag.dy = y - r.top;
  const ghost = drag.card.cloneNode(true); ghost.classList.add('ghost'); ghost.style.width = r.width + 'px'; ghost.removeAttribute('data-flip');
  document.body.appendChild(ghost); drag.ghost = ghost;
  drag.card.classList.add('dragging'); document.body.classList.add('is-dragging');
  if (navigator.vibrate && drag.touch) navigator.vibrate(12);
  place(x, y);
}
function onMove(e) {
  if (!drag) return;
  if (!drag.started) {
    const moved = Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0);
    if (drag.touch) { if (moved > 10) { clearTimeout(drag.timer); cancelDrag(); } return; }
    if (moved > 5) startDrag(e.clientX, e.clientY); else return;
  }
  e.preventDefault();
  place(e.clientX, e.clientY);
}
function place(x, y) {
  drag.ghost.style.transform = 'translate(' + (x - drag.dx) + 'px,' + (y - drag.dy) + 'px) rotate(2deg)';
  const under = document.elementFromPoint(x, y); const col = under && under.closest('.col');
  $$('.col.over').forEach(c => c !== col && c.classList.remove('over'));
  $$('.drop-ph').forEach(p => p.remove());
  drag.target = null;
  if (col && col.classList.contains('is-collapsed')) { col.classList.add('over'); drag.target = { status: 'Done', lane: col.dataset.lane || '', beforeId: null }; }
  else if (col) {
    col.classList.add('over');
    const body = col.querySelector('.col-body');
    const cards = $$('.card:not(.dragging)', body);
    const before = cards.find(c => { const r = c.getBoundingClientRect(); return y < r.top + r.height / 2; });
    const ph = document.createElement('div'); ph.className = 'drop-ph'; ph.style.height = drag.card.offsetHeight + 'px';
    body.insertBefore(ph, before || null);
    drag.target = { status: col.dataset.col, lane: col.dataset.lane || '', beforeId: before ? before.dataset.task : null };
  }
  // auto-scroll near edges
  const sc = col ? col.closest('.board') : null;
  if (sc) { const r = sc.getBoundingClientRect(); if (x > r.right - 60) sc.scrollLeft += 14; else if (x < r.left + 60) sc.scrollLeft -= 14; }
  if (y > innerHeight - 70) scrollBy(0, 14); else if (y < 90) scrollBy(0, -14);
}
function onUp() {
  document.removeEventListener('pointermove', onMove);
  if (!drag) return;
  clearTimeout(drag.timer);
  if (!drag.started) { const id = drag.id; drag = null; openTask(id); return; }
  const { id, target } = drag; endDrag();
  if (!target) return;
  drop(id, target.status, target.beforeId, target.lane);
}
function cancelDrag() { document.removeEventListener('pointermove', onMove); if (drag) { clearTimeout(drag.timer); if (drag.started) endDrag(); drag = null; } }
function endDrag() { if (drag.ghost) drag.ghost.remove(); drag.card.classList.remove('dragging'); document.body.classList.remove('is-dragging'); $$('.drop-ph').forEach(p => p.remove()); $$('.col.over').forEach(c => c.classList.remove('over')); drag = null; }
function drop(id, status, beforeId, lane) {
  const t = task(id); let d = data;
  if (lane && lane !== t.owner) { const r = E.updateTask(d, id, { owner: lane }, data.me, stamp()); if (Object.keys(r.errors).length) return refuse(id, Object.values(r.errors)[0]); d = r.data; }
  const finish = reason => {
    const r = E.placeTask(d, id, status, beforeId, data.me, stamp(), reason);
    if (Object.keys(r.errors).length) return refuse(id, Object.values(r.errors)[0]);
    commit(r.data, status !== t.status ? (status === 'Done' ? t.key + ' is done.' : t.key + ' moved to ' + stLabel(status) + '.') : '', { undo: status !== t.status || !!lane });
  };
  if (status === 'On hold' && t.status !== 'On hold') askHold(id, finish, () => flipRender());
  else finish();
}
function refuse(id, msg) {
  flipRender(); toast(msg, 'error');
  const c = document.querySelector('[data-task="' + id + '"]'); if (c) c.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-8px)' }, { transform: 'translateX(8px)' }, { transform: 'translateX(-4px)' }, { transform: 'translateX(0)' }], { duration: 360 });
}
// keyboard moves on a focused card: [ and ] move left and right
function moveByKey(id, dir) {
  const t = task(id); const i = E.BOARD_COLUMNS.indexOf(t.status); const to = E.BOARD_COLUMNS[i + dir];
  if (to === 'Done' && !ui.doneOpen && !isPhone()) ui.doneOpen = true;
  if (!to) return;
  drop(id, to, null, '');
  setTimeout(() => { const c = document.querySelector('[data-task="' + id + '"]'); if (c) c.focus(); }, 30);
}

// ---------- command palette ----------
const pal = $('#palette');
function openPalette() {
  pal.innerHTML = '<div class="pal" role="dialog" aria-modal="true" aria-label="Command palette"><div class="pal-in"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg><input id="palIn" placeholder="Search tasks and projects, or type a command" autocomplete="off" role="combobox" aria-expanded="true" aria-controls="palList"><kbd>Esc</kbd></div><ul id="palList" role="listbox"></ul><p class="pal-foot"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>Enter</kbd> open</span><span><kbd>?</kbd> all shortcuts</span></p></div>';
  pal.hidden = false; document.body.classList.add('pal-open');
  const inp = $('#palIn'); let sel = 0; let items = [];
  const cmds = [
    ['Create task', 'c', () => taskForm()], ['Go to home', 'g h', () => go('overview')], ['Go to my tasks', 'g m', () => go('mytasks')], ['Go to board', 'g b', () => go('board')], ['Go to the list of all tasks', 'g l', () => go('backlog')], ['Go to calendar', 'g k', () => go('calendar')], ['Go to projects', 'g p', () => go('projects')], ['Go to dependencies', 'g d', () => go('dependencies')], ['Go to risks', 'g r', () => go('risks')], ['Go to insights', 'g i', () => go('insights')], ['Go to reports', 'g e', () => go('reports')],
    ['Show only my tasks', '', () => { ui.q = { ...ui.q, assignee: 'me' }; go('board'); }], ['Show paused tasks', '', () => { ui.q = { ...ui.q, onHold: true }; go('board'); }], ['New project', '', () => projectForm()], ['New risk', '', () => riskForm()], ['Switch light or dark', '', () => $('.theme-switch').click()], ['Reset the demo', '', () => resetDemo()],
  ];
  const draw = () => {
    const q = inp.value.trim().toLowerCase();
    const match = s => !q || s.toLowerCase().includes(q) || q.split(/\s+/).every(w => s.toLowerCase().includes(w));
    items = [
      ...cmds.filter(c => match(c[0])).map(c => ({ kind: 'Command', label: c[0], hint: c[1], run: c[2] })),
      ...data.tasks.filter(t => match(t.key + ' ' + t.title + ' ' + t.owner)).slice(0, q ? 8 : 4).map(t => ({ kind: 'Task', label: t.key + '  ' + t.title, hint: stLabel(t.status), run: () => openTask(t.id) })),
      ...data.projects.filter(p => match(p.name + ' ' + p.code)).slice(0, 4).map(p => ({ kind: 'Project', label: p.name, hint: p.code, run: () => { location.hash = '#/project/' + p.id; } })),
    ].slice(0, 14);
    sel = Math.min(sel, Math.max(0, items.length - 1));
    $('#palList').innerHTML = items.length ? items.map((it, i) => '<li role="option" id="po' + i + '" aria-selected="' + (i === sel) + '" data-i="' + i + '"><span class="pk">' + it.kind + '</span><span class="pl">' + esc(it.label) + '</span>' + (it.hint ? '<kbd>' + esc(it.hint) + '</kbd>' : '') + '</li>').join('') : '<li class="pal-none">Nothing found for "' + esc(inp.value) + '"</li>';
    inp.setAttribute('aria-activedescendant', items.length ? 'po' + sel : '');
    const on = $('#po' + sel); if (on) on.scrollIntoView({ block: 'nearest' });
  };
  const run = i => { const it = items[i]; if (!it) return; closePalette(); it.run(); };
  inp.addEventListener('input', () => { sel = 0; draw(); });
  inp.addEventListener('keydown', e => { if (e.key === 'ArrowDown') { sel = (sel + 1) % Math.max(1, items.length); draw(); e.preventDefault(); } else if (e.key === 'ArrowUp') { sel = (sel - 1 + items.length) % Math.max(1, items.length); draw(); e.preventDefault(); } else if (e.key === 'Enter') { run(sel); e.preventDefault(); } else if (e.key === 'Escape') { closePalette(); e.preventDefault(); } });
  $('#palList').addEventListener('click', e => { const li = e.target.closest('[data-i]'); if (li) run(Number(li.dataset.i)); });
  pal.addEventListener('click', e => { if (e.target === pal) closePalette(); }, { once: true });
  draw(); inp.focus();
}
function closePalette() { pal.hidden = true; pal.innerHTML = ''; document.body.classList.remove('pal-open'); }
function go(name) { if (route().name === name) render(); else location.hash = '#/' + name; }
function shortcutsHelp() {
  const rows = [['⌘ K or Ctrl K, /', 'Search and commands'], ['c', 'Create a task'], ['g then h, m, b, l, k, p, d, r, i, e', 'Go to a page'], ['Enter', 'Open the selected card'], ['Arrow keys', 'Go from card to card on the board'], ['Shift + arrow, or [ and ]', 'Move the selected card one column left or right'], ['m', 'Assign the selected card to me'], ['Esc', 'Close a panel or dialog'], ['?', 'This list']];
  openForm('Keyboard shortcuts', '<dl class="keys">' + rows.map(([k, v]) => '<div><dt>' + k.split(', ').map(x => '<kbd>' + esc(x) + '</kbd>').join(' ') + '</dt><dd>' + esc(v) + '</dd></div>').join('') + '</dl>', () => {}, '', 'Got it');
}

// ---------- events ----------
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]'); if (!el || el.tagName === 'SELECT' || (el.tagName === 'INPUT' && el.type !== 'checkbox')) return;
  const act = el.dataset.act, id = el.dataset.id;
  if (el.matches('g.node') || act === 'open') { e.preventDefault(); openTask(id); return; }
  switch (act) {
    case 'toggle-ms': commit({ ...data, milestones: data.milestones.map(x => x.id === id ? { ...x, done: el.checked } : x) }, el.checked ? 'Milestone reached.' : 'Milestone reopened.', { undo: true }); break;
    case 'new-project': projectForm(); break;
    case 'theme-toggle': { const root = document.documentElement; const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'; root.setAttribute('data-theme', next); try { sessionStorage.setItem('cc-theme', next); } catch (err) { /* this visit only */ } if (window.ccThemeSync) window.ccThemeSync(); break; }
    case 'ws-go': if (acct && el.dataset.id !== acct.wsId) openWorkspace(el.dataset.id); break;
    case 'me-go': if (el.dataset.name !== data.me) commit({ ...data, me: el.dataset.name }, 'You are now viewing as ' + el.dataset.name + '.'); break;
    case 'edit-project': projectForm(proj(id)); break;
    case 'del-project': { const p = proj(id); const n = [E.projectMilestones(data, id).length, E.projectTasks(data, id).length, E.projectRisks(data, id).length]; confirmBox('Delete ' + p.name + '?', 'This also deletes its ' + n[0] + ' milestones, ' + n[1] + ' tasks and ' + n[2] + ' risks.', 'Delete project', () => { location.hash = '#/projects'; commit(E.deleteProject(data, id), p.name + ' deleted.', { undo: true }); }); break; }
    case 'new-milestone': milestoneForm(null, el.dataset.project); break;
    case 'edit-milestone': milestoneForm(data.milestones.find(x => x.id === id)); break;
    case 'new-task': taskForm(el.dataset.project, el.dataset.status); break;
    case 'new-risk': riskForm(null, el.dataset.project); break;
    case 'edit-risk': riskForm(data.risks.find(x => x.id === id)); break;
    case 'del-task': { const t = task(id); ui.panel = null; commit(E.deleteTask(data, id), t.key + ' deleted.', { undo: true }); break; }
    case 'close-panel': closePanel(); break;
    case 'full-page': location.hash = '#/task/' + encodeURIComponent(ui.panel); break;
    case 'list-pick': applyList(el.dataset.id); break;
    case 'list-open': applyList(el.dataset.id); location.hash = '#/lists'; break;
    case 'lsort': { const k = el.dataset.k; ui.list.sort = { k, dir: ui.list.sort.k === k ? -ui.list.sort.dir : 1 }; render(); const b = $('[data-act="lsort"][data-k="' + k + '"]'); if (b) b.focus(); break; }
    case 'list-cols': openForm('Columns', '<p class="muted small">Choose what the list shows. Task is always shown.</p><div class="colpick">' + LCOLS.filter(c => c[0] !== 'title').map(([k, l]) => '<label class="ckb"><input type="checkbox" name="c" value="' + k + '"' + (ui.list.columns.includes(k) ? ' checked' : '') + '> <span>' + l + '</span></label>').join('') + '</div>', fd => { const chosen = fd.getAll('c'); ui.list.columns = LCOLS.map(c => c[0]).filter(k => k === 'title' || chosen.includes(k)); render(); return {}; }, '', 'Show these columns'); break;
    case 'list-save': { const cur = savedList(ui.list.id);
      if (cur && el.dataset.mode === 'update') { commit({ ...data, filters: data.filters.map(f => f.id === cur.id ? { ...f, query: listQuery(cur.query.view && cur.query.view.pin) } : f) }, 'List "' + cur.name + '" saved.'); break; }
      openForm('Save this list', field('name', 'Name', input('name', '', 'text', 'maxlength="40" required autocomplete="off"'), 'It keeps the filters, columns, grouping and order. You can pin it to Home.') + '<label class="ckb"><input type="checkbox" name="pin" checked> <span>Show it on Home</span></label>', fd => { const name = String(fd.get('name') || '').trim(); const err = E.validateFilterName(name, data.filters); if (err) return { name: err }; const id = E.uid('f'); ui.list.id = id; commit({ ...data, filters: [...(data.filters || []), { id, name, query: listQuery(fd.get('pin') === 'on') }] }, 'List "' + name + '" saved' + (fd.get('pin') === 'on' ? ' and shown on Home.' : '.')); return {}; }, '', 'Save'); break; }
    case 'list-pin': { const cur = savedList(ui.list.id); if (!cur) break; const pin = !(cur.query.view && cur.query.view.pin); commit({ ...data, filters: data.filters.map(f => f.id === cur.id ? { ...f, query: { ...f.query, view: { ...(f.query.view || listView()), pin } } } : f) }, pin ? '"' + cur.name + '" is on Home now.' : '"' + cur.name + '" was taken off Home.'); break; }
    case 'list-del': { const cur = savedList(ui.list.id); if (!cur) break; confirmBox('Delete the list "' + cur.name + '"?', 'Only the saved list goes. No task is changed.', 'Delete the list', () => { ui.list.id = 'p-open'; commit({ ...data, filters: data.filters.filter(f => f.id !== cur.id) }, 'List deleted.', { undo: true }); }); break; }
    case 'set-status': { const s = el.dataset.s; const r = E.updateTask(data, ui.panel, { status: s }, data.me, stamp()); if (Object.keys(r.errors).length) { toast(Object.values(r.errors)[0], 'error'); el.animate([{ transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' }, { transform: 'none' }], { duration: 220 }); } else commit(r.data, task(ui.panel).key + ' is now ' + stLabel(s) + '.', { undo: true }); break; }
    case 'ask-hold': askHold(id, reason => { const r = E.hold(data, id, reason, data.me, stamp()); if (Object.keys(r.errors).length) toast(Object.values(r.errors)[0], 'error'); else commit(r.data, task(id).key + ' is paused.', { undo: true }); }); break;
    case 'resume': { const r = E.resume(data, id, data.me, stamp()); if (Object.keys(r.errors).length) toast(Object.values(r.errors)[0], 'error'); else commit(r.data, task(id).key + ' resumed.', { undo: true }); break; }
    case 'assign-me': panelUpdate({ owner: data.me }, 'Assigned to you.'); break;
    case 'chk-toggle': { const cl = (task(ui.panel).checklist || []).map(c => c.id === el.dataset.c ? { ...c, done: el.checked } : c); panelUpdate({ checklist: cl }); { const b = $('#panel [data-act="chk-toggle"][data-c="' + el.dataset.c + '"]'); if (b) b.focus(); } break; }
    case 'chk-del': { const cl = (task(ui.panel).checklist || []).filter(c => c.id !== el.dataset.c); panelUpdate({ checklist: cl }, 'Item removed.'); break; }
    case 'archive-task': case 'restore-task': { const t = task(ui.panel); const r = act === 'archive-task' ? E.archiveTask(data, t.id, TODAY, data.me, stamp()) : E.restoreTask(data, t.id, data.me, stamp()); if (Object.keys(r.errors).length) { toast(Object.values(r.errors)[0], 'error'); break; } commit(r.data, act === 'archive-task' ? t.key + ' archived. It stays in search, reports and Lists › Archived.' : t.key + ' is back.', { undo: true }); break; }
    case 'archive-project': case 'restore-project': { const p = proj(id); const r = act === 'archive-project' ? E.archiveProject(data, id, TODAY, data.me, stamp()) : E.restoreProject(data, id, data.me, stamp()); if (r.error) { toast(r.error, 'error'); break; } commit(r.data, act === 'archive-project' ? p.name + ' archived with its tasks. Find it in Projects › Archived.' : p.name + ' is back.', { undo: true }); break; }
    case 'rm-label': panelUpdate({ labels: (task(ui.panel).labels || []).filter(l => l !== el.dataset.l) }, 'Label removed.'); break;
    case 'edit-deps': depsForm(ui.panel); break;
    case 'ptab': ui.panelTab = el.dataset.k; renderPanel(); { const b = $('#panel [data-k="' + el.dataset.k + '"]'); if (b) b.focus(); } break;
    case 'q-assignee': { const n = el.dataset.name; ui.q.assignee = (ui.q.assignee === n || (ui.q.assignee === 'me' && n === data.me)) ? '' : n; flipRender(); break; }
    case 'q-chip': { const k = el.dataset.k; if (k === 'me') ui.q.assignee = ui.q.assignee === 'me' ? '' : 'me'; else ui.q[k] = !ui.q[k]; flipRender(); break; }
    case 'clear-q': ui.q = { text: '', assignee: '', status: [], priority: [], label: '', project: '', overdue: false, onHold: false }; flipRender(); break;
    case 'save-filter': openForm('Save this filter', field('name', 'Name', input('name', '', 'text', 'maxlength="40" required autocomplete="off"'), 'It appears under Saved filters on the board and the backlog.'), fd => { const name = String(fd.get('name') || '').trim(); const err = E.validateFilterName(name, data.filters); if (err) return { name: err }; commit({ ...data, filters: [...(data.filters || []), { id: E.uid('f'), name, query: JSON.parse(JSON.stringify(ui.q)) }] }, 'Filter "' + name + '" saved.'); }, '', 'Save'); break;
    case 'group': ui.group = el.dataset.g; flipRender(); break;
    case 'more-filters': ui.moreFilters = !ui.moreFilters; render(); { const b = $('[data-act="more-filters"]'); if (b) b.focus(); } break;
    case 'filter-person': ui.q = { ...ui.q, assignee: el.dataset.name }; location.hash = '#/board'; break;
    case 'sel': if (el.checked) ui.sel.add(id); else ui.sel.delete(id); render(); break;
    case 'sel-all': { const ids = E.applyFilter(data.tasks, ui.q, data.me, TODAY).map(t => t.id); if (el.checked) ids.forEach(i => ui.sel.add(i)); else ui.sel.clear(); render(); break; }
    case 'sel-none': ui.sel.clear(); render(); break;
    case 'bulk-label': openForm('Add a label to ' + ui.sel.size + ' tasks', field('label', 'Label', input('label', '', 'text', 'list="labelList2" maxlength="20" required autocomplete="off"')) + '<datalist id="labelList2">' + E.allLabels(data).map(l => '<option value="' + esc(l) + '">').join('') + '</datalist>', fd => { const l = String(fd.get('label') || '').trim().toLowerCase(); let d = data; const failed = []; for (const tid of ui.sel) { const r = E.updateTask(d, tid, { labels: [...(task(tid).labels || []), l] }, data.me, stamp()); if (Object.keys(r.errors).length) { failed.push(Object.values(r.errors)[0]); if (failed.length === 1 && /small letters/.test(failed[0])) return { label: failed[0] }; } else d = r.data; } commit(d, 'Label added to ' + (ui.sel.size - failed.length) + ' tasks.' + (failed.length ? ' ' + failed.length + ' refused: ' + failed[0] : ''), { undo: true }); }, '', 'Add'); break;
    case 'cell': { const c = [Number(el.dataset.i), Number(el.dataset.p)]; ui.risks.cell = ui.risks.cell && ui.risks.cell[0] === c[0] && ui.risks.cell[1] === c[1] ? null : c; render(); break; }
    case 'cell-clear': ui.risks.cell = null; render(); break;
    case 'rep': ui.reports.type = el.dataset.k; render(); break;
    case 'print': window.print(); break;
    case 'csv': downloadCsv(); break;
    case 'copy-summary': { const txt = $('#sumText').textContent; (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(() => toast('Status summary copied.'), () => toast('Copy is not allowed here. Select the text instead.', 'error')); break; }
    case 'reset': if (!canWipe()) { toast('Only the owner or an admin can replace this shared workspace.', 'error'); break; } resetDemo(); break;
    case 'start-empty': if (!canWipe()) { toast('Only the owner or an admin can empty this shared workspace.', 'error'); break; } startEmpty(); break;
    case 'signin': signInForm(el.dataset.email || ''); break;
    case 'join-accept': acceptInvite(el.dataset.token); break;
    case 'ws-open': openWorkspace(id).then(ok => { if (ok) location.hash = '#/overview'; }); break;
    case 'ws-new': openForm('New workspace', field('name', 'Name', input('name', '', 'text', 'maxlength="60" required autocomplete="off"'), 'For example: Marketing team, or Home renovation.'), async fd => { const r = await api('POST', 'workspaces', { name: String(fd.get('name') || '').trim() }); if (r.status !== 200) return r.body.errors || { name: r.body.error || 'Not created.' }; dlg.close(); await refreshMe(r.body.id); location.hash = '#/overview'; toast('Workspace created. Invite people from the People page.'); return {}; }, '', 'Create'); break;
    case 'ws-rename': openForm('Rename the workspace', field('name', 'Name', input('name', acct.wsName, 'text', 'maxlength="60" required autocomplete="off"')), async fd => { const r = await api('POST', 'workspaces/' + acct.wsId + '/rename', { name: String(fd.get('name') || '').trim() }); if (r.status !== 200) return r.body.errors || { name: r.body.error || 'Not renamed.' }; dlg.close(); await refreshMe(acct.wsId); location.hash = '#/workspace'; toast('Renamed.'); return {}; }, '', 'Rename'); break;
    case 'ws-leave': confirmBox('Leave "' + acct.wsName + '"?', 'You lose access to its projects and tasks. Someone can invite you again.', 'Leave', async () => { const r = await api('POST', 'workspaces/' + acct.wsId + '/leave', {}); if (r.status !== 200) { toast(r.body.error || 'Not done.', 'error'); return; } await refreshMe(); location.hash = '#/overview'; toast('You left the workspace.'); }); break;
    case 'ws-delete': openForm('Delete "' + acct.wsName + '"?', '<p>Every project, task and comment in it is removed for everyone. This cannot be undone.</p>' + field('confirm', 'Type the name to confirm', input('confirm', '', 'text', 'required autocomplete="off"'), esc(acct.wsName)), async fd => { const r = await api('POST', 'workspaces/' + acct.wsId + '/delete', { confirm: String(fd.get('confirm') || '') }); if (r.status !== 200) return r.body.errors || { confirm: r.body.error || 'Not deleted.' }; dlg.close(); await refreshMe(); location.hash = '#/overview'; toast('The workspace was deleted.'); return {}; }, '', 'Delete for everyone'); break;
    case 'member-remove': confirmBox('Remove ' + el.dataset.name + '?', 'They lose access to this workspace right away. Their past activity stays.', 'Remove', async () => { const r = await api('POST', 'workspaces/' + acct.wsId + '/members/' + id + '/remove', {}); if (r.status !== 200) { toast(r.body.error || 'Not done.', 'error'); return; } wsInfo = null; render(); toast(el.dataset.name + ' was removed.'); }); break;
    case 'invite-cancel': api('POST', 'workspaces/' + acct.wsId + '/invites/' + encodeURIComponent(id) + '/cancel', {}).then(r => { if (r.status !== 200) { toast(r.body.error || 'Not done.', 'error'); return; } wsInfo = null; render(); toast('Invitation cancelled. The link no longer works.'); }); break;
    case 'invite-copy': { const l = lastInvite[el.dataset.email]; (navigator.clipboard ? navigator.clipboard.writeText(l) : Promise.reject()).then(() => toast('Invitation link copied. It works only for ' + el.dataset.email + '.'), () => toast('Copy is not allowed here.', 'error')); break; }
    case 'acct-export': api('GET', 'account/export').then(r => { if (r.status !== 200) { toast(r.body.error || 'Not available.', 'error'); return; } const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(r.body, null, 2)], { type: 'application/json' })); a.download = 'command-center-my-data-' + TODAY + '.json'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); toast('Your data was downloaded.'); }); break;
    case 'acct-delete': openForm('Delete your account?', '<p>Your account and your private workspaces are deleted. Shared workspaces you own go on with the next person as owner. This cannot be undone.</p>' + field('password', 'Your password, to confirm', input('password', '', 'password', 'autocomplete="current-password" required maxlength="200"')), async fd => { const r = await api('POST', 'account/delete', { password: String(fd.get('password') || '') }); if (r.status !== 200) return r.body.errors || { password: r.body.error || 'Not deleted.' }; dlg.close(); leaveAccount(); location.hash = '#/overview'; toast('Your account was deleted.'); return {}; }, '', 'Delete my account'); break;
    case 'signup': signUpForm(); break;
    case 'forgot': { const em = (dlg.querySelector('[name="email"]') || {}).value || ''; forgotForm(em.trim()); break; }
    case 'acct-name': openForm('Change your name', field('displayName', 'Your name', input('displayName', acct.user.displayName, 'text', 'autocomplete="name" required maxlength="40"'), 'Shown on your tasks and comments. Past activity keeps the name it had.'), async fd => { const r = await api('POST', 'account/name', { displayName: String(fd.get('displayName') || '').trim() }); if (r.status !== 200) return r.body.errors || { displayName: r.body.error || 'Not changed.' }; dlg.close(); await refreshMe(acct.wsId); toast('Your name was changed.'); return {}; }); break;
    case 'acct-password': openForm('Change your password', field('password', 'Current password', input('password', '', 'password', 'autocomplete="current-password" required maxlength="200"')) + field('next', 'New password', input('next', '', 'password', 'autocomplete="new-password" required minlength="10" maxlength="200"'), 'At least 10 characters. Your other devices are signed out.'), async fd => { const r = await api('POST', 'account/password', { password: String(fd.get('password') || ''), next: String(fd.get('next') || '') }); if (r.status !== 200) return r.body.errors || { password: r.body.error || 'Not changed.' }; dlg.close(); await refreshMe(acct.wsId); toast('Your password was changed. Other devices were signed out.'); return {}; }); break;
    case 'acct-email': openForm('Change your email', '<p class="muted">We send a link to the new address. Your email changes when you open it.</p>' + field('email', 'New email', input('email', '', 'email', 'autocomplete="email" required maxlength="254"')) + field('password', 'Your password, to confirm', input('password', '', 'password', 'autocomplete="current-password" required maxlength="200"')), async fd => { const em = String(fd.get('email') || '').trim(); const r = await api('POST', 'account/email', { email: em, password: String(fd.get('password') || '') }); if (r.status !== 200) return r.body.errors || { email: r.body.error || 'Not changed.' }; checkMailbox(em, 'Check the new address'); return false; }); break;
    case 'acct-signout-all': confirmBox('Sign out on every device?', 'Every browser and phone where you are signed in, this one included, will need your password again.', 'Sign out everywhere', async () => { await syncing; const r = await api('POST', 'account/signout-all', {}); if (r.status !== 200) { toast(r.body.error || 'Not done.', 'error'); return; } leaveAccount(); location.hash = '#/overview'; toast('Signed out on every device.'); }); break;
    case 'member-owner': openForm('Make ' + el.dataset.name + ' the owner?', '<p>' + esc(el.dataset.name) + ' gets every right, including deleting the workspace. You stay in it as an admin.</p>' + field('password', 'Your password, to confirm', input('password', '', 'password', 'autocomplete="current-password" required maxlength="200"')), async fd => { const r = await api('POST', 'workspaces/' + acct.wsId + '/members/' + id + '/owner', { password: String(fd.get('password') || '') }); if (r.status !== 200) return r.body.errors || { password: r.body.error || 'Not done.' }; dlg.close(); wsInfo = null; await refreshMe(acct.wsId); location.hash = '#/workspace'; toast(el.dataset.name + ' is now the owner.'); return {}; }, '', 'Hand it over'); break;
    case 'adm-tab': admin.tab = el.dataset.tab; render(); break;
    case 'adm-user': adminAct(el.dataset.do, el.dataset.id, el.dataset.email, el.dataset.name); break;
    case 'adm-refresh': admin.data = null; admin.log = null; render(); break;
    case 'signout': signOut(); break;
    case 'resend': resend(el.dataset.email); break;
    case 'check-mail': { const v = ($('#mbEmail') || {}).value || ''; location.hash = '#/mailbox?email=' + encodeURIComponent(v.trim()); break; }
    case 'palette': $('#moreSheet').hidden = true; openPalette(); break;
    case 'complete': case 'reopen': {
      const t = task(id); if (!t) break;
      const to = act === 'complete' ? 'Done' : (t.history || []).slice().reverse().find(h => h.field === 'Status' && h.to === 'Done')?.from || 'To do';
      const r = E.updateTask(data, id, { status: to === 'Backlog' || to === 'none' ? 'To do' : to }, data.me, stamp());
      if (Object.keys(r.errors).length) { toast(Object.values(r.errors)[0], 'error'); el.animate([{ transform: 'translateX(-3px)' }, { transform: 'translateX(3px)' }, { transform: 'none' }], { duration: 200 }); break; }
      const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (act === 'complete') el.classList.add('done');
      setTimeout(() => commit(r.data, act === 'complete' ? 'Moved to Done.' : t.key + ' reopened.', { undo: true }), act === 'complete' && !calm ? 260 : 0);
      break; }
    case 'done-open': ui.doneOpen = true; flipRender(); break;
    case 'done-close': ui.doneOpen = false; flipRender(); break;
    case 'mcol': ui.mcol = el.dataset.s; render(); break;
    case 'qa-me': { const t = task(id); if (t.owner === data.me) { toast('It is already yours.'); break; } const r = E.updateTask(data, id, { owner: data.me }, data.me, stamp()); if (Object.keys(r.errors).length) toast(Object.values(r.errors)[0], 'error'); else commit(r.data, t.key + ' assigned to you.', { undo: true }); break; }
    case 'qa-date': case 'new-date': dateForm(id); break;
    case 'remind': { const t = task(id); const on = t.remindOn && t.remindOn >= TODAY; const r = E.updateTask(data, id, { remindOn: on ? '' : nextRemind() }, data.me, stamp()); if (Object.keys(r.errors).length) toast(Object.values(r.errors)[0], 'error'); else commit(r.data, on ? 'Reminder removed.' : 'It will be in your Today list on ' + weekday(nextRemind()) + '.', { undo: true }); break; }
    case 'fy-tab': ui.fyTab = el.dataset.k; render(); { const b = $('[data-act="fy-tab"][data-k="' + el.dataset.k + '"]'); if (b) b.focus(); } break;
    case 'watch': { const t = task(ui.panel); const w = t.watchers || []; panelUpdate({ watchers: w.includes(data.me) ? w.filter(x => x !== data.me) : [...w, data.me] }, w.includes(data.me) ? 'You stopped watching ' + t.key + '.' : 'You are watching ' + t.key + '.'); break; }
    case 'sub-focus': { const i = $('#subNew'); if (i) i.focus(); break; }
    case 'sub-done': { const x = task(id); const r = E.updateTask(data, id, { status: el.checked ? 'Done' : 'To do' }, data.me, stamp()); if (Object.keys(r.errors).length) { el.checked = !el.checked; toast(Object.values(r.errors)[0], 'error'); } else commit(r.data, x.key + (el.checked ? ' done.' : ' reopened.'), { undo: true }); break; }
    case 'copy-link': { const url = location.origin + location.pathname + '#/task/' + encodeURIComponent(ui.panel); (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(() => toast('Link copied. It opens this task for anyone in this workspace.'), () => toast('Copy is not allowed here.', 'error')); break; }
    case 'cal-move': { const [y, m] = (ui.calMonth || TODAY.slice(0, 7)).split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + Number(el.dataset.n), 1)); ui.calMonth = d.toISOString().slice(0, 7); ui.calDay = ''; render(); break; }
    case 'cal-today': ui.calMonth = TODAY.slice(0, 7); ui.calDay = TODAY; render(); break;
    case 'cal-mine': ui.calMine = !ui.calMine; render(); break;
    case 'cal-day': ui.calDay = el.dataset.d; render(); { const l = $('.cal-list'); if (l && isPhone()) l.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } break;
    case 'shortcuts': shortcutsHelp(); break;
    case 'more': $('#moreSheet').hidden = !$('#moreSheet').hidden; break;
  }
});
document.addEventListener('change', e => {
  const el = e.target;
  if (el.closest('#panel') && el.dataset.field && el.dataset.field !== 'title') {
    const f = el.dataset.field; const v = f === 'estimate' ? Number(el.value) : el.value;
    panelUpdate({ [f]: v }, { owner: 'Assigned to ' + v + '.', priority: 'Priority set to ' + v + '.', due: 'Due date changed.', estimate: 'Estimate changed.', milestoneId: 'Milestone changed.', description: 'Description saved.' }[f]);
    return;
  }
  const act = el.dataset.act;
  if (el.dataset.q) { const k = el.dataset.q; ui.q[k] = k === 'priority' ? (el.value ? [el.value] : []) : el.value; flipRender(); return; }
  if (act === 'list-group') { ui.list.group = el.value; render(); const lg = $('[data-act="list-group"]'); if (lg && lg.nextElementSibling) lg.nextElementSibling.focus(); return; }
  if (act === 'load-filter') { const f = (data.filters || []).find(x => x.id === el.value); if (f) { if (route().name === 'lists') { applyList(f.id); return; } const { view, ...fq } = f.query || {}; ui.q = { text: '', assignee: '', status: [], priority: [], label: '', project: '', overdue: false, onHold: false, ...fq }; flipRender(); toast('Filter "' + f.name + '" applied.'); } return; }
  if (act === 'bulk') {
    const field = el.dataset.field; const v = el.value; if (!v) return;
    const ids = [...ui.sel];
    const go2 = reason => { const r = E.bulkUpdate(data, ids, field === 'status' && v === 'On hold' ? { status: v, holdReason: reason } : { [field]: v }, data.me, stamp()); commit(r.data, r.done + ' task' + (r.done === 1 ? '' : 's') + ' updated.' + (r.failed.length ? ' ' + r.failed.length + ' refused: ' + r.failed.map(f => f.key + ' (' + f.error + ')').join('; ') : ''), { undo: r.done > 0 }); };
    if (field === 'status' && v === 'On hold') { openForm('Pause ' + ids.length + ' tasks', field2('holdReason'), fd => { const reason = String(fd.get('holdReason') || '').trim(); if (!reason) return { holdReason: 'Say why the tasks are paused.' }; go2(reason); }, '', 'Pause'); el.value = ''; }
    else go2();
    return;
  }
  if (act === 'bl-sort') { ui.backlogSort = el.value; flipRender(); return; }
  if (act === 'proj-sort') { ui.projSort = el.value; flipRender(); return; }
  if (act === 'proj-status') { ui.projStatus = el.value; flipRender(); return; }
  if (act === 'risk-project') { ui.risks.project = el.value; ui.risks.cell = null; render(); return; }
  if (act === 'risk-status') { ui.risks.status = el.value; ui.risks.cell = null; render(); return; }
  if (act === 'dep-project') { ui.deps.project = el.value; render(); return; }
  if (act === 'rep-project') { ui.reports.project = el.value; render(); return; }
  if (act === 'ws-switch') { openWorkspace(el.value); return; }
  if (act === 'member-role') { api('POST', 'workspaces/' + acct.wsId + '/members/' + el.dataset.id + '/role', { role: el.value }).then(r => { if (r.status !== 200) toast(r.body.error || 'Not changed.', 'error'); else toast('Role changed.'); wsInfo = null; render(); }); return; }
  if (el.id === 'meSel' || act === 'me-pick') { commit({ ...data, me: el.value }, 'You are now viewing as ' + el.value + '.'); return; }
});
function field2(name) { return field(name, 'Why are they paused?', '<textarea id="f-' + name + '" name="' + name + '" rows="3" maxlength="200"></textarea>'); }
document.addEventListener('focusout', e => {
  const el = e.target;
  if (el.id === 'pnTitle' && ui.panel) { const v = el.value.trim(); const t = task(ui.panel); if (t && v !== t.title) { if (!v) { toast('A task needs a title.', 'error'); el.value = t.title; } else panelUpdate({ title: v }, 'Title saved.'); } }
});
document.addEventListener('keydown', e => {
  const el = e.target;
  if (el.matches && el.matches('.lbl-in') && e.key === 'Enter') { e.preventDefault(); const l = el.value.trim().toLowerCase(); if (l) panelUpdate({ labels: [...(task(ui.panel).labels || []), l] }, 'Label "' + l + '" added.'); return; }
  if (el.id === 'pnTitle' && e.key === 'Enter') { e.preventDefault(); el.blur(); return; }
  if (el.id === 'cText' && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); el.form.requestSubmit(); return; }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); pal.hidden ? openPalette() : closePalette(); return; }
  if (e.key === 'Escape') { if (!pal.hidden) { closePalette(); return; } if (dlg.open) return; if (ui.panel) { closePanel(); return; } if (!$('#moreSheet').hidden) { $('#moreSheet').hidden = true; return; } }
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable || dlg.open || !pal.hidden;
  if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
  if (el.matches && el.matches('g.node') && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openTask(el.dataset.id); return; }
  if (el.matches && el.matches('.card')) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openTask(el.dataset.task); return; }
    if (e.key === '[' || e.key === ']' || (e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight'))) { e.preventDefault(); moveByKey(el.dataset.task, e.key === ']' || e.key === 'ArrowRight' ? 1 : -1); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const list = $$('.card', el.closest('.col-body')); const n = list[list.indexOf(el) + (e.key === 'ArrowDown' ? 1 : -1)]; if (n) n.focus(); return; }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); const cols = $$('.col', el.closest('.board')).filter(c => c.querySelector('.card')); const i = cols.indexOf(el.closest('.col')); const c = cols[i + (e.key === 'ArrowRight' ? 1 : -1)]; if (c) c.querySelector('.card').focus(); return; }
    if (e.key === 'm') { const r = E.updateTask(data, el.dataset.task, { owner: data.me }, data.me, stamp()); if (!Object.keys(r.errors).length) commit(r.data, task(el.dataset.task).key + ' assigned to you.', { undo: true }); return; }
  }
  if (e.key === '/') { e.preventDefault(); openPalette(); return; }
  if (e.key === '?') { shortcutsHelp(); return; }
  if (e.key === 'c') { e.preventDefault(); taskForm(); return; }
  if (e.key === 'g') { gPending = Date.now(); return; }
  if (gPending && Date.now() - gPending < 1200) { const map = { o: 'overview', h: 'overview', m: 'mytasks', k: 'calendar', b: 'board', l: 'backlog', p: 'projects', d: 'dependencies', r: 'risks', i: 'insights', e: 'reports' }; if (map[e.key]) { go(map[e.key]); } gPending = 0; }
});
let gPending = 0;
let searchTimer;
document.addEventListener('input', e => { const el = e.target; if (el.id === 'pnTitle' || el.id === 'cText') fitText(el); if (el.dataset.q === 'text') { clearTimeout(searchTimer); searchTimer = setTimeout(() => { ui.q.text = el.value; render(); const again = document.querySelector('[data-q="text"]'); if (again) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); } }, 160); } });
document.addEventListener('submit', async e => {
  const f = e.target;
  if (f.dataset.form === 'invite') {
    e.preventDefault(); const email = f.email.value.trim().toLowerCase(); const er = f.querySelector('.err'); er.hidden = true;
    const btn = f.querySelector('[type=submit]'); btn.disabled = true;
    const r = await api('POST', 'workspaces/' + acct.wsId + '/invites', { email, role: f.role ? f.role.value : 'member' });
    btn.disabled = false;
    if (r.status !== 200) { er.textContent = (r.body.errors && Object.values(r.body.errors)[0]) || r.body.error || 'Not sent.'; er.hidden = false; return; }
    lastInvite[email] = r.body.link; wsInfo = null; render(); toast('Invitation sent to ' + email + '.');
    return;
  }
  if (f.dataset.form === 'reset' || f.dataset.form === 'adm-settings') {
    e.preventDefault();
    const showErr = errs => { for (const [k, msg] of Object.entries(errs)) { const x = f.querySelector('#e-' + k); if (x) { x.textContent = msg; x.hidden = false; } else toast(msg, 'error'); } };
    f.querySelectorAll('.err').forEach(x => { x.hidden = true; });
    const btn = f.querySelector('[type=submit]'); btn.disabled = true;
    if (f.dataset.form === 'reset') {
      const r = await api('POST', 'auth/reset', { token: f.dataset.token, password: f.password.value });
      btn.disabled = false;
      if (r.status !== 200) return showErr(r.body.errors || { password: r.body.error || 'The password was not changed.' });
      history.replaceState(null, '', '#/overview'); await refreshMe(); toast('Your new password is saved. You are signed in.');
      return;
    }
    const r = await api('POST', 'admin/settings', { signup: (f.querySelector('[name=signup]:checked') || {}).value, maxOwned: Number(f.maxOwned.value), maxPeople: Number(f.maxPeople.value) });
    btn.disabled = false;
    if (r.status !== 200) return showErr(r.body.errors || { _: r.body.error || 'Not saved.' });
    admin.data.settings = r.body.settings; signupMode = r.body.settings.signup; admin.log = null; loadAdmin(); toast('Settings saved.');
    return;
  }
  if (f.dataset.form === 'sub-add') { e.preventDefault(); const title = f.title.value.trim(); if (!title) return; const par = task(ui.panel); const col = data.tasks.filter(t => t.status === 'To do');
    const next = { id: E.uid('t'), key: E.nextKey(data, par.projectId), projectId: par.projectId, parentId: par.id, type: 'Task', reporter: data.me, watchers: [data.me], title: title.slice(0, 100), owner: par.owner, priority: par.priority, status: 'To do', estimate: 1, due: par.due, labels: [], deps: [], milestoneId: par.milestoneId || '', holdReason: '', heldFrom: '', rank: (col.length ? Math.min(...col.map(t => t.rank)) : 1) - 1, comments: [], history: [{ at: stamp(), by: data.me, field: 'Created', from: '', to: '' }] };
    next.history[0].to = next.key; const errors = E.validateTask(next, data); if (Object.keys(errors).length) { toast(Object.values(errors)[0], 'error'); return; }
    commit({ ...data, tasks: [...data.tasks, next] }, next.key + ' added as a sub-task.', { undo: true }); const i = $('#subNew'); if (i) i.focus(); return; }
  if (f.dataset.form === 'chk-add') { e.preventDefault(); const text = f.text.value.trim(); if (!text) return; const cl = [...(task(ui.panel).checklist || []), { id: E.uid('c'), text: text.slice(0, 120), done: false }]; if (panelUpdate({ checklist: cl })) setTimeout(() => { const i = $('#chkNew'); if (i) i.focus(); }, 30); return; }
  if (f.dataset.form !== 'comment') return; e.preventDefault();
  const r = E.addComment(data, ui.panel, f.text.value, data.me, stamp());
  if (Object.keys(r.errors).length) { const er = f.querySelector('.err'); er.textContent = Object.values(r.errors)[0]; er.hidden = false; return; }
  ui.panelTab = 'comments'; f.text.value = ''; commit(r.data, 'Note posted.'); setTimeout(() => { const list = $('#panel .comments'); if (list && list.lastElementChild) list.lastElementChild.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, 30);
});

function resetDemo() {
  if (acct) { confirmBox('Load the sample data?', 'Everything in "' + acct.wsName + '" is replaced by the sample company, Orbis Studio. You can undo it right after.', 'Load sample data', () => { ui.sel.clear(); ui.panel = null; commit({ ...seed(TODAY), me: data.me }, 'Sample data loaded.', { undo: true, flip: false }); }); return; }
  confirmBox('Reset the demo?', 'Everything saved in this browser for Command Center is removed and the original sample data comes back.', 'Reset demo', () => { clearSaved(); data = seed(TODAY); ui.sel.clear(); ui.panel = null; toast('Sample data restored.'); if (route().name === 'project') location.hash = '#/overview'; else render(); });
}
function startEmpty() {
  const empty = { version: 2, me: data.me, projects: [], milestones: [], tasks: [], risks: [], filters: [] };
  if (acct) { confirmBox('Empty this workspace?', 'Every project, task and risk in "' + acct.wsName + '" is removed. You can undo it right after.', 'Empty the workspace', () => { ui.sel.clear(); ui.panel = null; location.hash = '#/overview'; commit(empty, 'The workspace is empty.', { undo: true, flip: false }); }); return; }
  confirmBox('Start with an empty workspace?', 'Everything saved in this browser for Command Center is removed. Reset demo brings the sample data back.', 'Empty the workspace', () => { clearSaved(); data = empty; ui.sel.clear(); ui.panel = null; location.hash = '#/overview'; render(); toast('The workspace is empty.'); });
}
window.addEventListener('hashchange', () => { $('#moreSheet').hidden = true; navigate(); });
window.addEventListener('storage', e => { if (e.key === KEY && !acct) { data = load(); render(); } });

// ---------- accounts: sign up, sign in, saved on the server ----------
const BAND_LOCAL = '<span class="strip-t"><b>Sample workspace</b> · Made-up data, saved in this browser only. Please use made-up names.</span>';
function renderBand() {
  const band = $('#band'); if (!band) return;
  band.hidden = !!acct; band.classList.toggle('acct', !!acct);
  if (acct) { band.innerHTML = ''; return; }
  band.innerHTML = BAND_LOCAL + '<span class="band-actions"><button type="button" class="lnk" data-act="reset">Reset sample</button><button type="button" class="lnk" data-act="start-empty">Start empty</button>' +
    (serverOn ? '<button type="button" class="lnk" data-act="signin">Sign in</button><button type="button" class="lnk strong" data-act="signup">Create an account<span class="ph-hide"> to keep your work</span></button>' : '') + '</span>';
}
function setSaveState(t) { if (!acct) return; acct.saveState = t; $$('.save-state').forEach(el => { el.textContent = t || 'Saved to your account'; }); }
const busyTyping = () => { const a = document.activeElement; return a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.closest('#panel, #main'); };

function queueSync() {
  syncing = syncing.then(async () => {
    if (!acct || !synced) return;
    const ops = diff(synced, data); if (!ops.length) return;
    const sent = data;
    setSaveState('Saving…');
    const r = await api('POST', 'workspaces/' + acct.wsId + '/sync', { version: acct.version, ops });
    if (r.status === 200) { useServer(r.body, sent === data); setSaveState('Saved to your account'); return; }
    if (r.status === 409 && r.body.workspace) {
      const ws = r.body.workspace; const mine = rebase(ws, data);
      acct.version = ws.version; acct.wsName = ws.name; synced = ws.data;
      data = { version: 2, ...mine, me: acct.user.displayName };
      if (!busyTyping() && !dlg.open) render();
      setSaveState('Merged with a change from someone else'); queueSync(); return;
    }
    if (r.status === 401) { toast('You were signed out, so the last change was not saved. Sign in again.', 'error'); leaveAccount(); return; }
    data = { ...synced, version: 2, me: acct.user.displayName }; setSaveState('Saved to your account'); render();
    toast((r.body.error || 'The change was not saved.') + ' The change was undone.', 'error');
  });
}
function useServer(ws, replace) {
  acct.version = ws.version; acct.wsName = ws.name; synced = ws.data;
  if (!replace) return;
  data = { version: 2, ...ws.data, me: acct.user.displayName };
  if (!busyTyping() && !dlg.open) render();
}
async function openWorkspace(id, quiet) {
  const r = await api('GET', 'workspaces/' + encodeURIComponent(id));
  if (r.status !== 200) { toast(r.body.error || 'This workspace could not be opened.', 'error'); return false; }
  acct.wsId = r.body.id; acct.saveState = '';
  ui.sel.clear(); ui.panel = null; ui.q = { text: '', assignee: '', status: [], priority: [], label: '', project: '', overdue: false, onHold: false };
  useServer(r.body, true); wsInfo = null; render();
  loadMembers().then(() => { if (wsInfo) wsInfo._for = acct.wsId; if (!busyTyping() && !dlg.open) render(); });
  if (!quiet) toast('Opened "' + r.body.name + '".');
  return true;
}
async function enterAccount(me, preferId) {
  acct = { user: me.user, workspaces: me.workspaces, wsId: null, version: 0, wsName: '' };
  const first = me.workspaces.find(w => w.id === preferId) || me.workspaces[0];
  if (first) await openWorkspace(first.id, true);
  renderBand();
  offerCopy();
  if (!dlg.open) pendingJoin();
}
function leaveAccount() { acct = null; synced = null; wsInfo = null; data = load(); ui.panel = null; render(); }
async function refreshMe(preferId) {
  const me = await api('GET', 'me');
  if (me.status !== 200 || !me.body.user) return false;
  signupMode = me.body.signup || signupMode;
  await enterAccount(me.body, preferId);
  return true;
}
async function signOut() {
  await syncing;
  await api('POST', 'auth/signout', {});
  leaveAccount(); toast('Signed out. You are back in the demo saved in this browser.');
}

function signInForm(email = '') {
  openForm('Sign in', field('email', 'Email', input('email', email, 'email', 'autocomplete="email" required maxlength="254"')) + field('password', 'Password', input('password', '', 'password', 'autocomplete="current-password" required maxlength="200"')) +
    '<p class="muted small"><button type="button" class="lnk" data-act="forgot">Forgot your password?</button> · No account yet? <button type="button" class="lnk" data-act="signup">Create one</button></p>',
  async fd => {
    const em = String(fd.get('email') || '').trim();
    const r = await api('POST', 'auth/signin', { email: em, password: String(fd.get('password') || '') });
    if (r.status === 200) { dlg.close(); await refreshMe(); toast('Signed in. Your work is now saved to your account.'); return {}; }
    if (r.body.unverified) { checkMailbox(em, 'Confirm your email first'); return false; }
    return { password: r.body.error || 'Sign-in did not work.' };
  }, '', 'Sign in');
}

// Victoria's step (accounts plan 1.6): an informed acknowledgement, not a consent. Words to be approved by Nawres before live.
const PRIVACY_STEP = '<div class="privacy-step"><p><b>Before you create an account</b></p><ul>' +
  '<li><b>What is kept:</b> your email, the name you choose, and what you put in your workspaces, including names of people you type and the email addresses of people you invite. Also a short log of account events (sign-ins, password and email changes), kept 90 days.</li>' +
  '<li><b>Who runs it:</b> the admin of this site sees your name, email, dates and how many workspaces, projects and tasks you have, never what is inside them.</li>' +
  '<li><b>Who sees it:</b> only the people in a workspace you share. They see your name; only its owner and admins see your email.</li>' +
  '<li><b>Why:</b> to run your account and keep your work, on any device.</li>' +
  '<li><b>Where:</b> a database in the EU (Frankfurt), on Vercel and Neon.</li>' +
  '<li><b>How long:</b> until you delete your account. Sign-ups that are never confirmed are removed after 7 days.</li>' +
  '<li><b>Your rights:</b> you can ask to see, download, correct or delete your data at any time, as the <a href="/privacy/" target="_blank" rel="noopener">privacy page</a> explains.</li>' +
  '<li><b>This is a preview:</b> please use made-up details only.</li></ul></div>';
function forgotForm(email = '') {
  openForm('Forgot your password?', '<p class="muted">Enter the email of your account. We send a link to choose a new password. It works once, for one hour.</p>' + field('email', 'Email', input('email', email, 'email', 'autocomplete="email" required maxlength="254"')),
  async fd => {
    const em = String(fd.get('email') || '').trim();
    const r = await api('POST', 'auth/forgot', { email: em });
    if (r.status !== 200) return r.body.errors || { email: r.body.error || 'The link could not be sent.' };
    dlg.innerHTML = '<form method="dialog" class="form confirm"><header><h2 id="dlgTitle">Check your email</h2></header><div class="form-body"><p>If <b>' + esc(em) + '</b> has an account, a link to choose a new password is on its way. It works once, for one hour.</p>' +
      '<p class="muted small">On this preview no real email is sent: the link waits in the <a href="#/mailbox?email=' + encodeURIComponent(em) + '" data-close>test mailbox</a>.</p></div><footer><span class="grow"></span><button type="submit" class="btn">OK</button></footer></form>';
    dlg.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => dlg.close()));
    return false;
  }, '', 'Send the link');
}
function signUpForm() {
  if (signupMode === 'closed') { confirmBox('New accounts are closed for now', 'The person who runs this Command Center has paused new sign-ups. You can still try everything in this browser without an account.', 'OK', () => {}); return; }
  openForm('Create an account', '<p class="muted">Your projects and tasks are saved to your account and are there on any device. Without an account, they stay only in this browser.</p>' + (signupMode === 'invite' ? '<p class="note-calm">New accounts are by invitation only right now. Use the address your invitation was sent to.</p>' : '') +
    field('displayName', 'Your name', input('displayName', '', 'text', 'autocomplete="name" required maxlength="40"'), 'Shown on your tasks and comments.') +
    field('email', 'Email', input('email', '', 'email', 'autocomplete="email" required maxlength="254"'), 'We send one link to confirm it.') +
    field('password', 'Password', input('password', '', 'password', 'autocomplete="new-password" required minlength="10" maxlength="200"'), 'At least 10 characters.') +
    PRIVACY_STEP +
    '<div class="fld check" data-field="privacyAck"><label><input type="checkbox" name="privacyAck" id="f-privacyAck"> I have read how my data is used, above, and the privacy page</label><small class="err" id="e-privacyAck" hidden></small></div>',
  async fd => {
    const email = String(fd.get('email') || '').trim();
    const r = await api('POST', 'auth/signup', { displayName: String(fd.get('displayName') || '').trim(), email, password: String(fd.get('password') || ''), privacyAck: fd.get('privacyAck') === 'on' });
    if (r.status === 200) { checkMailbox(email, 'Check your email'); return false; }
    if (r.body.errors) return r.body.errors;
    return { email: r.body.error || 'The account could not be created.' };
  }, '', 'Create account');
}
function checkMailbox(email, title) {
  dlg.innerHTML = '<form method="dialog" class="form confirm"><header><h2 id="dlgTitle">' + esc(title) + '</h2></header><div class="form-body"><p>We sent a link to <b>' + esc(email) + '</b>. Open it to confirm your address and sign in. It works once, for 24 hours.</p>' +
    '<p class="muted small">On this preview no real email is sent: the link waits in the <a href="#/mailbox?email=' + encodeURIComponent(email) + '" data-close>test mailbox</a>.</p></div>' +
    '<footer><button type="button" class="lnk" data-act="resend" data-email="' + esc(email) + '">Send the link again</button><span class="grow"></span><button type="submit" class="btn">OK</button></footer></form>';
  dlg.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => dlg.close()));
  if (!dlg.open) dlg.showModal();
}
async function resend(email) { const r = await api('POST', 'auth/resend', { email }); toast(r.status === 200 ? 'If this address has an account waiting, a new link is on its way.' : (r.body.error || 'Not sent.'), r.status === 200 ? 'ok' : 'error'); }

// Copy the workspace saved in this browser into the account (checked by the server; the browser copy is kept).
function localWorkspace() { try { const raw = localStorage.getItem(KEY); const d = raw && JSON.parse(raw); return d && E.isValidData(d) && d.projects.length ? d : null; } catch (e) { return null; } }
function offerCopy() {
  if (offeredCopy || !acct) return;
  const local = localWorkspace(); if (!local) return;
  offeredCopy = true;
  openForm('Copy your browser workspace?', '<p>This browser holds a Command Center workspace with ' + local.projects.length + ' projects and ' + local.tasks.length + ' tasks. Copy it into your account as a new workspace?</p><p class="muted small">The copy in this browser is kept. You can remove it afterwards.</p>',
  async () => {
    const isSample = local.projects.some(p => p.id === 'p-atlas');
    const r = await api('POST', 'workspaces/import', { name: isSample ? 'Orbis Studio (sample)' : 'Copied from this browser', data: local, isSample });
    if (r.status !== 200) return { _: 'Nothing was copied: ' + (r.body.error || 'the workspace could not be checked.') };
    dlg.close();
    await refreshMe(r.body.id);
    confirmBox('Copied. Remove the browser copy?', 'Your workspace is now in your account. The copy saved in this browser can stay, or you can remove it now.', 'Remove the browser copy', () => { clearSaved(); toast('The browser copy was removed.'); });
    return {};
  }, '', 'Copy into my account');
}

// ---------- sharing: the workspace page, invitations, your account ----------
const ROLE = { owner: 'Owner', admin: 'Admin', member: 'Member' };
const ROLE_SAYS = { owner: 'Can do everything, including deleting the workspace or handing it over.', admin: 'Can invite members, rename and remove members.', member: 'Can see and change all projects and tasks.' };
let wsInfo = null; // { name, yourRole, members, invites } for the open workspace
async function loadMembers() {
  if (!acct || !acct.wsId) { wsInfo = null; return; }
  const r = await api('GET', 'workspaces/' + acct.wsId + '/members');
  wsInfo = r.status === 200 ? { ...r.body, _for: acct.wsId } : null;
  if (wsInfo) acct.members = wsInfo.members.map(m => m.name);
}
function workspaceView() {
  if (!acct) return '<div class="vh"><div><h2>Share a workspace</h2><p class="lede">Work together on the same projects and tasks, each person with their own sign-in.</p></div></div>' +
    calmEmpty('Sharing needs an account', serverOn ? 'Create a free account, then invite people by email. What you made in this browser can come with you.' : 'Accounts are not available on this copy of the site.', serverOn ? '<div class="row"><button class="btn" data-act="signup">Create an account</button><button class="btn ghost" data-act="signin">Sign in</button></div>' : '');
  if (!wsInfo || wsInfo._for !== acct.wsId) { loadMembers().then(() => { if (wsInfo) wsInfo._for = acct.wsId; if (route().name === 'workspace') render(); }); return '<div class="vh"><div><h2>' + esc(acct.wsName) + '</h2><p class="lede">Loading the people…</p></div></div>'; }
  const me = wsInfo.yourRole; const manager = me === 'owner' || me === 'admin';
  const person = m => '<div class="tr person">' + avatar(m.name, 'sm') + '<span class="pp"><b>' + esc(m.name) + (m.you ? ' <small>(you)</small>' : '') + '</b>' + (m.email ? '<small>' + esc(m.email) + '</small>' : '') + '</span>' +
    (me === 'owner' && !m.you && m.role !== 'owner' ? '<label><span class="sr">Role of ' + esc(m.name) + '</span><select data-act="member-role" data-id="' + esc(m.id) + '">' + opts([['admin', 'Admin'], ['member', 'Member']], m.role) + '</select></label>' : '<span class="chip2 ' + (m.role === 'owner' ? 'c-acc' : 'c-n') + '">' + ROLE[m.role] + '</span>') +
    (me === 'owner' && !m.you && m.role !== 'owner' ? '<button type="button" class="lnk" data-act="member-owner" data-id="' + esc(m.id) + '" data-name="' + esc(m.name) + '">Make owner</button>' : '') +
    (manager && !m.you && m.role !== 'owner' && !(me === 'admin' && m.role === 'admin') ? '<button type="button" class="lnk" data-act="member-remove" data-id="' + esc(m.id) + '" data-name="' + esc(m.name) + '">Remove</button>' : '') + '</div>';
  const others = acct.workspaces.filter(w => w.id !== acct.wsId);
  return '<div class="vh"><div><p class="eyebrow">Workspace</p><h2>' + esc(acct.wsName) + '</h2><p class="lede">' + wsInfo.members.length + ' ' + (wsInfo.members.length === 1 ? 'person' : 'people') + '. Everyone here sees and changes the same projects and tasks. You are ' + (me === 'owner' ? 'the owner' : me === 'admin' ? 'an admin' : 'a member') + '.</p></div><div class="row">' + (manager ? '<button class="btn ghost" data-act="ws-rename">Rename</button>' : '') + '<button class="btn" data-act="ws-new">' + ic('plus') + 'New workspace</button></div></div>' +
    '<div class="cols2"><div class="stack">' +
      '<section class="card2"><div class="ch"><h3>People</h3><span>' + wsInfo.members.length + '</span></div>' + wsInfo.members.map(person).join('') + '</section>' +
      (manager ? '<section class="card2"><div class="ch"><h3>Invite someone</h3></div><form class="invite" data-form="invite"><label class="sr" for="invEmail">Email address</label><input id="invEmail" name="email" type="email" required maxlength="254" autocomplete="off" placeholder="name@example.com">' +
        (me === 'owner' ? '<label class="sr" for="invRole">Role</label><select id="invRole" name="role">' + opts([['member', 'Member'], ['admin', 'Admin']], 'member') + '</select>' : '') + '<button class="btn" type="submit">Send invitation</button><small class="err" hidden></small></form>' +
        '<p class="soft small">They get a link that works for 7 days, only with an account for that email address. On this preview no email is really sent: the link waits in the test mailbox, and you can copy it below.</p>' +
        (wsInfo.invites.length ? '<div class="ch sep"><h3>Waiting for an answer</h3><span>' + wsInfo.invites.length + '</span></div>' + wsInfo.invites.map(i => '<div class="tr person">' + ic('clock') + '<span class="pp"><b>' + esc(i.email) + '</b><small>' + ROLE[i.role] + ' · until ' + esc(fmtDate(String(i.expiresAt).slice(0, 10), true)) + '</small></span>' + (lastInvite[i.email] ? '<button type="button" class="lnk" data-act="invite-copy" data-email="' + esc(i.email) + '">Copy link</button>' : '') + '<button type="button" class="lnk" data-act="invite-cancel" data-id="' + esc(i.id) + '">Cancel</button></div>').join('') : '') + '</section>' : '') +
    '</div><div class="stack">' +
      '<section class="card2"><div class="ch"><h3>Who can do what</h3></div>' + ['owner', 'admin', 'member'].map(r => '<div class="tr person"><span class="chip2 ' + (r === 'owner' ? 'c-acc' : 'c-n') + '">' + ROLE[r] + '</span><span class="pp"><small>' + ROLE_SAYS[r] + '</small></span></div>').join('') + '</section>' +
      (others.length ? '<section class="card2"><div class="ch"><h3>Your other workspaces</h3></div>' + others.map(w => '<div class="tr person"><span class="pd"></span><button type="button" class="tt" data-act="ws-open" data-id="' + esc(w.id) + '">' + esc(w.name) + '</button><small class="when">' + ROLE[w.role] + (w.members > 1 ? ' · ' + w.members + ' people' : '') + '</small></div>').join('') + '</section>' : '') +
      '<section class="card2"><div class="ch"><h3>' + (me === 'owner' ? 'Delete this workspace' : 'Leave this workspace') + '</h3></div><p class="soft">' + (me === 'owner' ? 'Every project, task and comment in it is removed for everyone. This cannot be undone.' : 'You lose access to its projects and tasks. Someone can invite you again.') + '</p><div class="row pad-x"><button class="btn ghost" data-act="' + (me === 'owner' ? 'ws-delete' : 'ws-leave') + '">' + (me === 'owner' ? 'Delete the workspace' : 'Leave') + '</button></div></section>' +
    '</div></div>';
}
const lastInvite = {}; // email -> link, only in memory for this page visit
function accountView() {
  if (!acct) return '<div class="vh"><div><h2>Your account</h2></div></div>' + calmEmpty('You are not signed in', 'Without an account, your work stays in this browser only.', serverOn ? '<div class="row"><button class="btn" data-act="signup">Create an account</button><button class="btn ghost" data-act="signin">Sign in</button></div>' : '');
  return '<div class="vh"><div><p class="eyebrow">Account</p><h2>' + esc(acct.user.displayName) + '</h2><p class="lede">' + esc(acct.user.email) + '</p></div><div class="row"><button class="btn ghost" data-act="signout">Sign out</button></div></div>' +
    '<div class="cols2"><div class="stack">' +
      '<section class="card2"><div class="ch"><h3>Sign-in and security</h3></div>' +
        '<div class="tr person"><span class="pp"><b>Name</b><small>' + esc(acct.user.displayName) + '</small></span><button type="button" class="lnk" data-act="acct-name">Change</button></div>' +
        '<div class="tr person"><span class="pp"><b>Email</b><small>' + esc(acct.user.email) + '</small></span><button type="button" class="lnk" data-act="acct-email">Change</button></div>' +
        '<div class="tr person"><span class="pp"><b>Password</b><small>Forgot it? Sign out, then use “Forgot your password?”.</small></span><button type="button" class="lnk" data-act="acct-password">Change</button></div>' +
        '<div class="tr person"><span class="pp"><b>Signed in on ' + (acct.user.devices || 1) + ' ' + ((acct.user.devices || 1) === 1 ? 'device' : 'devices') + '</b><small>Lost a phone, or used a shared computer? Sign out everywhere.</small></span><button type="button" class="lnk" data-act="acct-signout-all">Sign out everywhere</button></div></section>' +
      '<section class="card2"><div class="ch"><h3>Your data</h3></div><p class="soft">Download everything kept about you: your account details and every workspace you are in, as a JSON file you can open or keep.</p><div class="row pad-x"><button class="btn ghost" data-act="acct-export">Download my data</button></div></section>' +
      '<section class="card2"><div class="ch"><h3>Delete my account</h3></div><p class="soft">Your account and your private workspaces are deleted. Shared workspaces you own go on with the next person as owner. Your name in past activity becomes "Former member". This cannot be undone.</p><div class="row pad-x"><button class="btn ghost" data-act="acct-delete">Delete my account</button></div></section>' +
    '</div><div class="stack"><section class="card2"><div class="ch"><h3>How your data is used</h3></div><p class="soft">Kept in a database in the EU (Frankfurt), to run your account and keep your work. Read the <a href="/privacy/" target="_blank" rel="noopener">privacy page</a>.</p></section></div></div>';
}
function joinView(r) {
  const token = r.id;
  setTimeout(async () => {
    const box = $('#joinBox'); if (!box) return;
    const peek = await api('GET', 'invites/' + encodeURIComponent(token));
    if (peek.status !== 200) { box.innerHTML = calmEmpty('This invitation does not work', peek.body.error || 'Ask for a new one.'); return; }
    const p = peek.body;
    const say = '<b>' + esc(p.invitedBy) + '</b> invited <b>' + esc(p.email) + '</b> to the workspace <b>' + esc(p.workspace) + '</b> as ' + (p.role === 'admin' ? 'an admin' : 'a member') + '.';
    if (!acct) {
      try { sessionStorage.setItem('cc-join', token); } catch (e) { /* the link can be opened again */ }
      box.innerHTML = '<section class="card2 join"><div class="ch"><h3>You are invited</h3></div><p class="soft">' + say + '</p><p class="soft">Sign in, or create an account with <b>' + esc(p.email) + '</b>, to join. You come back here after.</p><div class="row pad-x"><button class="btn" data-act="signup">Create an account</button><button class="btn ghost" data-act="signin" data-email="' + esc(p.email) + '">Sign in</button></div></section>';
      return;
    }
    box.innerHTML = '<section class="card2 join"><div class="ch"><h3>You are invited</h3></div><p class="soft">' + say + '</p>' + (acct.user.email !== p.email ? '<p class="soft">You are signed in as <b>' + esc(acct.user.email) + '</b>. Sign out, then sign in with ' + esc(p.email) + ' to join.</p><div class="row pad-x"><button class="btn ghost" data-act="signout">Sign out</button></div>' : '<div class="row pad-x"><button class="btn" data-act="join-accept" data-token="' + esc(token) + '">Join ' + esc(p.workspace) + '</button></div>') + '</section>';
  }, 0);
  return '<div class="vh"><div><h2>An invitation</h2></div></div><div id="joinBox"><p class="muted">One moment…</p></div>';
}
async function acceptInvite(token) {
  const r = await api('POST', 'invites/accept', { token });
  try { sessionStorage.removeItem('cc-join'); } catch (e) { /* nothing kept */ }
  if (r.status !== 200) { toast(r.body.error || 'Joining did not work.', 'error'); return; }
  history.replaceState(null, '', '#/overview');
  await refreshMe(r.body.id);
  toast('You joined "' + acct.wsName + '". Everyone here sees the same work.');
}
function pendingJoin() { try { const t = sessionStorage.getItem('cc-join'); if (t && acct) { location.hash = '#/join/' + t; } } catch (e) { /* storage blocked */ } }

// Others' changes arrive by checking quietly every 15 seconds, only in a shared workspace (or one with an invitation
// waiting), only while the page is visible, and only in the first 30 minutes after the last click or key, so the
// free database can sleep when nobody is looking.
let lastInput = Date.now(); let tick = 0;
['pointerdown', 'keydown'].forEach(ev => document.addEventListener(ev, () => { lastInput = Date.now(); }, { passive: true, capture: true }));
async function checkLatest() {
  if (!acct || !acct.wsId || dlg.open || drag || busyTyping()) return;
  await syncing;
  if (diff(synced, data).length) return;
  const r = await api('GET', 'workspaces/' + acct.wsId);
  if (r.status === 200 && r.body.version > acct.version) { useServer(r.body, true); setSaveState('Updated with the latest changes'); }
  else if (r.status === 404) { toast('You no longer have access to this workspace.', 'error'); refreshMe(); }
}
setInterval(async () => {
  if (!acct || !acct.wsId || document.hidden || Date.now() - lastInput > 30 * 60000) return;
  const shared = wsInfo && (wsInfo.members.length > 1 || (wsInfo.invites || []).length);
  if (!shared) return;
  tick++;
  if (tick % 4 === 0 || (wsInfo.invites || []).length) { const had = wsInfo.members.length; await loadMembers(); if (wsInfo) { wsInfo._for = acct.wsId; if (wsInfo.members.length !== had) renderSide(); } }
  await checkLatest();
}, 15000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && wsInfo && wsInfo.members.length > 1) checkLatest(); });

// When someone else saved first: keep their work, put our change on top (entity by entity), and save again.
function rebase(serverWs, ours) {
  const ops = diff(synced, ours); const base = serverWs.data;
  const next = { ...base, projects: [...base.projects], milestones: [...base.milestones], tasks: [...base.tasks], risks: [...base.risks] };
  for (const o of ops) {
    if (o.type === 'filters') { next.filters = o.filters; continue; }
    const key = o.type + 's';
    const i = next[key].findIndex(x => x.id === o.id);
    if (o.op === 'del') { if (i >= 0) next[key].splice(i, 1); continue; }
    let doc = o.doc;
    if (o.type === 'task' && i >= 0) {
      const theirs = next[key][i]; const ids = new Set((theirs.comments || []).map(c => c.id));
      doc = { ...doc, comments: [...(theirs.comments || []), ...(doc.comments || []).filter(c => !ids.has(c.id))], history: theirs.history };
    }
    if (i >= 0) next[key][i] = doc; else next[key].push(doc);
  }
  return next;
}

// #/verify/<token>: the link from the confirmation email.
function verifyView(r) {
  const token = r.id;
  setTimeout(async () => {
    const res = await api('POST', 'auth/verify', { token });
    if (res.status === 200) { history.replaceState(null, '', '#/overview'); await refreshMe(); toast('Email confirmed. Welcome to your workspace.'); }
    else { const el = $('#verifyMsg'); if (el) el.textContent = res.body.error || 'This link did not work.'; }
  }, 0);
  return '<div class="vh"><div><h2>Confirming your email</h2><p class="lede" id="verifyMsg" aria-live="polite">One moment…</p></div></div><p><button type="button" class="btn ghost" data-act="signin">Sign in</button></p>';
}
// #/reset/<token>: the link from "Forgot your password?".
function resetView(r) {
  const token = r.id;
  return '<div class="vh"><div><p class="eyebrow">Your account</p><h2>Choose a new password</h2><p class="lede">After this, every device where you were signed in is signed out.</p></div></div>' +
    '<section class="card2 narrow"><form class="form-inline" novalidate data-form="reset" data-token="' + esc(token) + '"><div class="fld" data-field="password"><label for="f-password">New password</label><input id="f-password" name="password" type="password" autocomplete="new-password" required minlength="10" maxlength="200"><small class="hint">At least 10 characters.</small><small class="err" id="e-password" hidden></small></div><div class="row"><button class="btn" type="submit">Save and sign in</button></div></form></section>';
}
// #/email/<token>: the link sent to a new email address.
function emailView(r) {
  const token = r.id;
  setTimeout(async () => {
    const res = await api('POST', 'auth/confirm-email', { token });
    const el = $('#emailMsg'); if (!el) return;
    if (res.status === 200) { el.textContent = 'Done. Your account now uses this address.'; if (acct) await refreshMe(acct.wsId); }
    else el.textContent = res.body.error || 'This link did not work.';
  }, 0);
  return '<div class="vh"><div><h2>Confirming your new email</h2><p class="lede" id="emailMsg" aria-live="polite">One moment…</p></div></div><p><a class="btn ghost" href="#/overview">Go to Home</a></p>';
}

// ---------- full-page task: #/task/<id>, the same details as the side panel, with room ----------
function taskPage(r) {
  if (!task(r.id)) { ui.panel = null; return '<div class="vh"><div><h2>Task not found</h2></div></div>' + calmEmpty('This task does not exist here', 'It may have been deleted, or it is in another workspace.', '<a class="btn" href="#/board">Go to the board</a>'); }
  ui.panel = r.id; return '';
}

// ---------- lists: a table of tasks with your filters, columns, grouping and order; save it, pin it to Home ----------
const Q0 = { text: '', assignee: '', status: [], priority: [], label: '', project: '', overdue: false, onHold: false, archived: false };
const LCOLS = [['key', 'Key'], ['title', 'Task'], ['project', 'Project'], ['status', 'Status'], ['owner', 'Assignee'], ['priority', 'Priority'], ['due', 'Due'], ['labels', 'Labels'], ['estimate', 'Estimate'], ['milestone', 'Milestone'], ['deps', 'Waits for'], ['checklist', 'Checklist']];
const LDEF = ['key', 'title', 'project', 'status', 'owner', 'priority', 'due'];
const PRESETS = [
  { id: 'p-open', name: 'All open tasks', q: { status: E.TASK_STATUSES.filter(x => x !== 'Done') } },
  { id: 'p-mine', name: 'My tasks', q: { assignee: 'me' } },
  { id: 'p-past', name: 'Could use a new date', q: { overdue: true } },
  { id: 'p-paused', name: 'Paused', q: { onHold: true } },
  { id: 'p-archived', name: 'Archived', q: { archived: true } },
];
ui.list = { id: 'p-open', columns: LDEF, group: 'none', sort: { k: 'due', dir: 1 } };
const PRANK = { Critical: 0, High: 1, Medium: 2, Low: 3 };
const LSORT = {
  key: (a, b) => a.key.localeCompare(b.key, 'en', { numeric: true }), title: (a, b) => a.title.localeCompare(b.title),
  project: (a, b) => (proj(a.projectId)?.name || '').localeCompare(proj(b.projectId)?.name || ''), status: (a, b) => E.TASK_STATUSES.indexOf(a.status) - E.TASK_STATUSES.indexOf(b.status),
  owner: (a, b) => String(a.owner || '~').localeCompare(String(b.owner || '~')), priority: (a, b) => PRANK[a.priority] - PRANK[b.priority],
  due: (a, b) => String(a.due).localeCompare(String(b.due)), labels: (a, b) => (a.labels || []).join().localeCompare((b.labels || []).join()),
  estimate: (a, b) => (a.estimate || 0) - (b.estimate || 0), milestone: (a, b) => msName(a).localeCompare(msName(b)), deps: (a, b) => (a.deps || []).length - (b.deps || []).length,
};
const msName = t => (data.milestones.find(m => m.id === t.milestoneId) || {}).name || '';
function sortTasks(list, sort = { k: 'due', dir: 1 }) { const f = LSORT[sort.k] || LSORT.due; return [...list].sort((a, b) => f(a, b) * sort.dir || LSORT.due(a, b)); }
const savedList = id => (data.filters || []).find(f => f.id === id);
const listView = () => ({ columns: ui.list.columns, group: ui.list.group, sort: ui.list.sort });
const listQuery = pin => ({ ...JSON.parse(JSON.stringify(ui.q)), view: { ...listView(), pin: !!pin } });
function applyList(id) {
  const pre = PRESETS.find(p => p.id === id); const f = savedList(id);
  if (!pre && !f) return;
  const { view, ...q } = pre ? { q: pre.q } && { ...pre.q } : (f.query || {});
  ui.q = { ...Q0, ...q };
  ui.list = { id, columns: view && view.columns ? view.columns.filter(c => LCOLS.some(x => x[0] === c)) : LDEF, group: view && view.group || 'none', sort: view && view.sort || { k: 'due', dir: 1 } };
  if (!ui.list.columns.includes('title')) ui.list.columns = ['title', ...ui.list.columns];
  render();
}
function listCell(k, t) {
  const p = proj(t.projectId);
  switch (k) {
    case 'checklist': return (t.checklist || []).length ? (t.checklist.filter(c => c.done).length + ' of ' + t.checklist.length) : '<span class="muted">—</span>';
    case 'key': return '<button type="button" class="key lk" data-act="open" data-id="' + esc(t.id) + '" title="Open beside the list">' + esc(t.key) + '</button>';
    case 'title': return '<a class="lt-title" href="#/task/' + esc(t.id) + '">' + esc(t.title) + '</a>' + (t.status === 'On hold' && t.holdReason ? '<small class="lt-why">' + esc(t.holdReason) + '</small>' : '');
    case 'project': return p ? '<span class="lt-p"' + pcs(p.id) + '><span class="pd"></span>' + esc(p.name) + '</span>' : '';
    case 'status': return '<span class="st st-' + slug(t.status) + '">' + esc(stLabel(t.status)) + '</span>';
    case 'owner': return t.owner ? '<span class="lt-o">' + avatar(t.owner, 'sm') + esc(t.owner) + '</span>' : '<span class="muted">Nobody yet</span>';
    case 'priority': return esc(t.priority);
    case 'due': return '<span class="lt-d">' + esc(fmtDate(t.due, true)) + '</span>' + (isPast(t) ? ' ' + pastChip(t) : '');
    case 'labels': return (t.labels || []).map(l => '<span class="chip2 c-n">' + esc(l) + '</span>').join(' ');
    case 'estimate': return t.estimate ? t.estimate + (t.estimate === 1 ? ' day' : ' days') : '';
    case 'milestone': return esc(msName(t));
    case 'deps': { const open = (t.deps || []).map(task).filter(d => d && d.status !== 'Done').length; return open ? open + ' open' : ''; }
  }
  return '';
}
function listsView() {
  const cols = ui.list.columns; const L = Object.fromEntries(LCOLS);
  const rows = sortTasks(E.applyFilter(data.tasks, ui.q, data.me, TODAY), ui.list.sort);
  const cur = savedList(ui.list.id); const pre = PRESETS.find(p => p.id === ui.list.id);
  const name = cur ? cur.name : pre ? pre.name : 'Custom list';
  const changed = cur && JSON.stringify(listQuery(cur.query.view && cur.query.view.pin)) !== JSON.stringify({ ...Q0, ...cur.query, view: { columns: cur.query.view?.columns || LDEF, group: cur.query.view?.group || 'none', sort: cur.query.view?.sort || { k: 'due', dir: 1 }, pin: !!(cur.query.view && cur.query.view.pin) } });
  const pinned = cur && cur.query.view && cur.query.view.pin;
  const GROUPS = [['none', 'No grouping'], ['project', 'Project'], ['status', 'Status'], ['owner', 'Assignee'], ['priority', 'Priority']];
  const gkey = t => ui.list.group === 'project' ? (proj(t.projectId)?.name || '') : ui.list.group === 'status' ? stLabel(t.status) : ui.list.group === 'owner' ? (t.owner || 'Nobody yet') : ui.list.group === 'priority' ? t.priority : '';
  const groups = [];
  for (const t of rows) { const k = gkey(t); let g = groups.find(x => x.k === k); if (!g) groups.push(g = { k, items: [] }); g.items.push(t); }
  const th = k => k === 'title' || LSORT[k] ? '<th scope="col" aria-sort="' + (ui.list.sort.k === k ? (ui.list.sort.dir > 0 ? 'ascending' : 'descending') : 'none') + '"><button type="button" data-act="lsort" data-k="' + k + '">' + L[k] + (ui.list.sort.k === k ? (ui.list.sort.dir > 0 ? ' ↑' : ' ↓') : '') + '</button></th>' : '<th scope="col">' + L[k] + '</th>';
  const tr = t => '<tr class="' + (ui.panel === t.id ? 'sel' : '') + '">' + cols.map(k => '<td class="lc-' + k + '" data-label="' + L[k] + '">' + listCell(k, t) + '</td>').join('') + '</tr>';
  const chip = (id, label, on) => '<button type="button" class="chip' + (on ? ' on' : '') + '" data-act="list-pick" data-id="' + esc(id) + '" aria-pressed="' + on + '">' + esc(label) + '</button>';
  return '<div class="vh"><div><p class="eyebrow">Lists</p><h2>' + esc(name) + '</h2><p class="lede">' + rows.length + (rows.length === 1 ? ' task' : ' tasks') + '. Choose the filters, columns, grouping and order, then save it as your own list. A saved list can sit on Home.</p></div>' +
    '<div class="row">' + (cur ? '<button class="btn ghost" data-act="list-pin">' + (pinned ? 'Take off Home' : 'Show on Home') + '</button><button class="btn ghost" data-act="list-del">Delete</button>' : '') + (cur && changed ? '<button class="btn" data-act="list-save" data-mode="update">Save changes</button>' : '') + '<button class="btn' + (cur && changed ? ' ghost' : '') + '" data-act="list-save">' + ic('plus') + 'Save as a new list</button></div></div>' +
    '<div class="lists-pick" role="group" aria-label="Lists">' + PRESETS.map(p => chip(p.id, p.name, ui.list.id === p.id)).join('') + (data.filters || []).map(f => chip(f.id, f.name + (f.query && f.query.view && f.query.view.pin ? ' · Home' : ''), ui.list.id === f.id)).join('') + '</div>' +
    filterBar('lists') +
    '<div class="lt-tools"><label class="fsel"><span>Group by</span><select data-act="list-group">' + opts(GROUPS, ui.list.group) + '</select></label><button type="button" class="btn ghost sm" data-act="list-cols">' + ic('filter') + 'Columns</button><span class="grow"></span><button type="button" class="btn sm" data-act="new-task">' + ic('plus') + 'Create</button></div>' +
    (rows.length ? '<section class="card2 lt-card"><div class="lt-wrap"><table class="lt"><caption class="sr">' + esc(name) + ', ' + rows.length + ' tasks</caption><thead><tr>' + cols.map(th).join('') + '</tr></thead>' +
      groups.map(g => '<tbody>' + (ui.list.group !== 'none' ? '<tr class="lt-g"><th colspan="' + cols.length + '" scope="rowgroup">' + esc(g.k) + ' <small>' + g.items.length + '</small></th></tr>' : '') + g.items.map(tr).join('') + '</tbody>').join('') + '</table></div></section>'
      : calmEmpty('No task in this list', 'Change a filter, or pick another list.'));
}

// ---------- the admin area: who has an account, and how much is used. Never what is inside a workspace. ----------
const admin = { tab: 'people', data: null, log: null, loading: false };
const when = d => d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
async function loadAdmin() {
  if (admin.loading) return; admin.loading = true;
  const [o, l] = await Promise.all([api('GET', 'admin/overview'), api('GET', 'admin/log')]);
  admin.loading = false;
  admin.data = o.status === 200 ? o.body : { error: o.body.error || 'Not available.' };
  admin.log = l.status === 200 ? l.body : null;
  if (route().name === 'admin') render();
}
function adminView() {
  const head = '<div class="vh"><div><p class="eyebrow">Admin</p><h2>Run Command Center</h2><p class="lede">Accounts, numbers and settings. What people write inside their workspaces stays private, also from you.</p></div><div class="row"><button class="btn ghost" data-act="adm-refresh">Refresh</button></div></div>';
  if (!acct || !acct.user.admin) return head.replace(/<div class="row">.*<\/div><\/div>$/, '</div>') + calmEmpty('This page is for the admin', 'Only the person who runs this Command Center can open it.');
  if (!admin.data) { loadAdmin(); return head + '<p class="muted">Loading…</p>'; }
  if (admin.data.error) return head + calmEmpty('The admin area did not load', admin.data.error);
  const d = admin.data; const c = d.counts;
  const kp = (n, l, s = '') => '<div class="kpi"><b>' + n + '</b><span>' + l + '</span>' + (s ? '<small>' + s + '</small>' : '') + '</div>';
  const tabs = [['people', 'People'], ['workspaces', 'Workspaces'], ['settings', 'Settings'], ['log', 'Activity log']];
  let body = '';
  if (admin.tab === 'people') body = '<div class="tbl-wrap"><table class="tbl adm"><thead><tr><th>Person</th><th>Joined</th><th>Last sign-in</th><th>Workspaces</th><th>State</th><th><span class="sr">Actions</span></th></tr></thead><tbody>' + d.users.map(u => {
      const self = u.id === d.you;
      const state = u.pausedAt ? '<span class="chip2 c-pause">Paused</span>' : !u.confirmedAt ? '<span class="chip2 c-n">Not confirmed</span>' : '<span class="chip2 c-n">Active</span>';
      const b = (what, label) => '<button type="button" class="lnk" data-act="adm-user" data-do="' + what + '" data-id="' + esc(u.id) + '" data-email="' + esc(u.email) + '" data-name="' + esc(u.name) + '">' + label + '</button>';
      return '<tr><td data-label="Person"><span class="pp"><b>' + esc(u.name) + (self ? ' <small>(you)</small>' : '') + '</b><small>' + esc(u.email) + '</small></span></td><td data-label="Joined">' + when(u.createdAt) + '</td><td data-label="Last sign-in">' + when(u.lastSignInAt) + '</td><td data-label="Workspaces"><span>' + u.workspaces + (u.owns ? ' <small class="muted">(owns ' + u.owns + ')</small>' : '') + '</span></td><td data-label="State">' + state + '</td><td data-label="Actions" class="adm-acts">' +
        (self ? '<small class="muted">Use your account page</small>' : (u.confirmedAt && !u.pausedAt ? b('reset', 'Send password link') : '') + b(u.pausedAt ? 'resume' : 'pause', u.pausedAt ? 'Resume' : 'Pause') + b('delete', 'Delete')) + '</td></tr>';
    }).join('') + '</tbody></table></div>';
  if (admin.tab === 'workspaces') body = '<div class="tbl-wrap"><table class="tbl adm"><thead><tr><th>Workspace</th><th>Owner</th><th>People</th><th>Projects</th><th>Tasks</th><th>Created</th><th>Last change</th></tr></thead><tbody>' + d.workspaces.map((w, i) =>
      '<tr><td data-label="Workspace"><b>Workspace ' + (i + 1) + '</b>' + (w.sample ? ' <small class="muted">sample</small>' : '') + '</td><td data-label="Owner">' + esc(w.owner) + '</td><td data-label="People">' + w.people + '</td><td data-label="Projects">' + w.projects + '</td><td data-label="Tasks">' + w.tasks + '</td><td data-label="Created">' + when(w.createdAt) + '</td><td data-label="Last change">' + when(w.lastChange) + '</td></tr>').join('') + '</tbody></table></div>' +
      '<p class="soft small">Only names and counts. You cannot open someone else’s workspace from here.</p>';
  if (admin.tab === 'settings') {
    const s = d.settings;
    const radio = (v, l, hint) => '<label class="radio"><input type="radio" name="signup" value="' + v + '"' + (s.signup === v ? ' checked' : '') + '><span><b>' + l + '</b><small>' + hint + '</small></span></label>';
    body = '<form class="adm-set" data-form="adm-settings"><fieldset><legend>New accounts</legend>' + radio('open', 'Open', 'Anyone with the address can create an account.') + radio('invite', 'By invitation only', 'Only an address that was invited to a workspace can create an account.') + radio('closed', 'Closed', 'Nobody can create an account. People who have one can still sign in.') + '</fieldset>' +
      '<fieldset><legend>Limits</legend><div class="fld" data-field="maxOwned"><label for="f-maxOwned">Workspaces one person can own</label><input id="f-maxOwned" name="maxOwned" type="number" min="1" max="100" value="' + s.maxOwned + '"><small class="err" id="e-maxOwned" hidden></small></div>' +
      '<div class="fld" data-field="maxPeople"><label for="f-maxPeople">People in one workspace, invitations included</label><input id="f-maxPeople" name="maxPeople" type="number" min="2" max="200" value="' + s.maxPeople + '"><small class="err" id="e-maxPeople" hidden></small></div></fieldset>' +
      '<div class="row"><button class="btn" type="submit">Save settings</button></div></form>' +
      '<p class="soft small">' + (d.adminBy === 'list' ? 'You are the admin because your address is on the admin list of this site.' : 'On this preview, the first person who signed in became the admin. On the live site, only the addresses on the admin list can open this page.') + '</p>';
  }
  if (admin.tab === 'log') body = !admin.log ? '<p class="muted">The log did not load.</p>' : '<p class="soft small">What happened to accounts, kept ' + admin.log.keptDays + ' days. Never what people wrote.</p><div class="tbl-wrap"><table class="tbl adm"><thead><tr><th>When</th><th>What</th><th>Account</th></tr></thead><tbody>' + admin.log.events.map(e =>
      '<tr><td data-label="When">' + esc(new Date(e.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })) + '</td><td data-label="What">' + esc(e.kind) + (e.byAdmin ? ' <small class="muted">by the admin</small>' : '') + (e.detail ? '<br><small class="muted">' + esc(e.detail) + '</small>' : '') + '</td><td data-label="Account">' + (e.kind === 'Account deleted' ? '<small class="muted">removed</small>' : esc(e.name) + (e.email ? ' <small class="muted">' + esc(e.email) + '</small>' : '')) + '</td></tr>').join('') + '</tbody></table></div>';
  return head + '<div class="kpis adm-k">' + kp(c.accounts, 'Accounts', c.unconfirmed ? c.unconfirmed + ' not confirmed' : 'all confirmed') + kp(c.active7, 'Signed in this week') + kp(c.workspaces, 'Workspaces', c.shared + ' shared') + kp(c.projects, 'Projects') + kp(c.tasks, 'Tasks') + kp(c.invites, 'Invitations waiting', c.paused ? c.paused + ' accounts paused' : '') + '</div>' +
    '<nav class="seg adm-tabs" aria-label="Admin sections">' + tabs.map(([k, l]) => '<button type="button" data-act="adm-tab" data-tab="' + k + '" aria-pressed="' + (admin.tab === k) + '">' + l + '</button>').join('') + '</nav><section class="card2 adm-body">' + body + '</section>';
}
function adminAct(what, id, email, name) {
  const done = msg => { admin.data = null; admin.log = null; render(); toast(msg); };
  const post = async (b = {}) => api('POST', 'admin/users/' + id + '/' + what, b);
  if (what === 'pause') confirmBox('Pause ' + name + '?', 'They are signed out everywhere and cannot sign in until you resume the account. Their workspaces stay as they are.', 'Pause the account', async () => { const r = await post(); if (r.status !== 200) return toast(r.body.error || 'Not done.', 'error'); done(name + ' is paused.'); });
  if (what === 'resume') confirmBox('Resume ' + name + '?', 'They can sign in again with their password.', 'Resume', async () => { const r = await post(); if (r.status !== 200) return toast(r.body.error || 'Not done.', 'error'); done(name + ' can sign in again.'); });
  if (what === 'reset') confirmBox('Send ' + name + ' a password link?', 'They get an email with a link to choose a new password, valid for one hour. Their current password keeps working until they use it.', 'Send the link', async () => { const r = await post(); if (r.status !== 200) return toast(r.body.error || 'Not sent.', 'error'); done('The link was sent to ' + email + '.'); });
  if (what === 'delete') openForm('Delete the account of ' + name + '?', '<p>Their account and private workspaces are deleted. Shared workspaces they own go on with the next person as owner. Their name in past activity becomes “Former member”. This cannot be undone.</p>' + field('confirm', 'Type their email to confirm', input('confirm', '', 'text', 'required autocomplete="off"'), esc(email)),
    async fd => { const r = await post({ confirm: String(fd.get('confirm') || '') }); if (r.status !== 200) return r.body.errors || { confirm: r.body.error || 'Not deleted.' }; dlg.close(); done('The account was deleted.'); return {}; }, '', 'Delete the account');
}

// #/mailbox: preview-only test mailbox (no real email is sent from the preview).
function mailboxView(r) {
  const email = r.params.get('email') || '';
  setTimeout(async () => {
    const out = $('#mbList'); if (!out || !email) return;
    const res = await api('GET', 'dev/mailbox?email=' + encodeURIComponent(email));
    if (res.status !== 200) { out.innerHTML = '<p class="muted">The test mailbox exists only on the preview.</p>'; return; }
    out.innerHTML = res.body.mails.length ? res.body.mails.map(m => '<article class="panel mail"><p class="muted small">' + esc(new Date(m.created_at).toLocaleString('en-GB')) + '</p><h3>' + esc(m.subject) + '</h3><p>' + esc(m.body).replace(/(https?:\/\/[^\s<]+)/g, u => '<a href="' + u + '">' + (/#\/reset\//.test(u) ? 'Choose a new password' : /#\/join\//.test(u) ? 'Open the invitation' : /#\/email\//.test(u) ? 'Confirm the new address' : 'Confirm my email') + '</a>') + '</p></article>').join('') : '<p class="muted">No email for this address yet.</p>';
  }, 0);
  return '<div class="vh"><div><p class="eyebrow">Preview only</p><h2>Test mailbox</h2><p class="lede">On the preview, emails are not sent. They wait here so the sign-up can be tried with made-up addresses.</p></div></div>' +
    '<div class="row"><label class="fsearch"><span class="sr">Email address</span><input id="mbEmail" type="email" value="' + esc(email) + '" placeholder="the address you signed up with"></label><button type="button" class="btn ghost" data-act="check-mail">Show emails</button></div><div id="mbList" class="mb-list"></div>';
}

if (!location.hash) history.replaceState(null, '', '#/overview');
render();
lastHash = location.hash;
if (startNotice) toast(startNotice, 'error');
(async () => {
  const me = await api('GET', 'me');
  serverOn = me.status === 200;
  if (serverOn) signupMode = me.body.signup || 'open';
  if (serverOn && me.body.user) await enterAccount(me.body); else renderBand();
})();

// Home groups remember being folded while the page is open.
document.addEventListener('toggle', e => { const d = e.target; if (d.matches && d.matches('details.fy-g')) { ui.fyFold = { ...(ui.fyFold || {}), [d.dataset.g]: d.open }; } }, true);

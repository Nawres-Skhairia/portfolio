// Command Center: screens and interactions. Every figure comes from engine.js; this file shows it and saves changes.
import * as E from './engine.js';
import { seed } from './seed.js';

const KEY = 'command-center-v2';
const OLD_KEYS = ['command-center-v1'];
const pad = n => String(n).padStart(2, '0');
const now = new Date();
const TODAY = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
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
function save() {
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
const fmtDate = (iso, short) => { if (!iso) return ''; const [y, m, d] = iso.slice(0, 10).split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', short ? { day: 'numeric', month: 'short', timeZone: 'UTC' } : { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }); };
const fmtStamp = s => s ? fmtDate(s, true) + (s.length > 10 ? ' · ' + s.slice(11, 16) : '') : '';
const rel = iso => { const n = E.daysBetween(TODAY, iso); return n === 0 ? 'today' : n === 1 ? 'tomorrow' : n === -1 ? 'yesterday' : n > 0 ? 'in ' + n + ' days' : Math.abs(n) + ' days ago'; };
const proj = id => data.projects.find(p => p.id === id);
const task = id => data.tasks.find(t => t.id === id);
const people = () => [...new Set([data.me, ...data.projects.map(p => p.owner), ...data.tasks.map(t => t.owner), ...data.risks.map(r => r.owner)].filter(Boolean))].sort();
const healthTone = label => ({ 'On track': 'ok', 'At risk': 'warn', 'Critical': 'bad', 'Delivered': 'done', 'Not started': 'idle' }[label] || 'idle');
const slug = s => String(s).toLowerCase().replace(/\s+/g, '-');
function hue(name) { let h = 0; for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; }
const initials = n => String(n || '?').split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
const avatar = (name, size = '') => '<span class="av ' + size + '" style="--h:' + hue(name) + '" title="' + esc(name) + '" aria-hidden="true">' + esc(initials(name)) + '</span>';
const prioIcon = p => '<span class="pri pri-' + slug(p) + '" title="' + esc(p) + ' priority" aria-label="' + esc(p) + ' priority"><svg viewBox="0 0 16 16" aria-hidden="true">' + ({ Critical: '<path d="M3 9l5-5 5 5M3 13l5-5 5 5"/>', High: '<path d="M3 11l5-5 5 5"/>', Medium: '<path d="M3 6h10M3 10h10"/>', Low: '<path d="M3 5l5 5 5-5"/>' }[p] || '') + '</svg></span>';
function opts(list, sel, blank) { return (blank !== undefined ? '<option value="">' + esc(blank) + '</option>' : '') + list.map(v => { const [val, lab] = Array.isArray(v) ? v : [v, v]; return '<option value="' + esc(val) + '"' + (String(val) === String(sel) ? ' selected' : '') + '>' + esc(lab) + '</option>'; }).join(''); }
function emptyState(title, text, action, icon = 'spark') { return '<div class="empty"><span class="empty-ic ic-' + icon + '" aria-hidden="true"></span><p class="empty-t">' + esc(title) + '</p><p>' + esc(text) + '</p>' + (action || '') + '</div>'; }
function ring(score, tone, size = 64, label = '') {
  const r = (size - 8) / 2, c = 2 * Math.PI * r, off = c * (1 - Math.max(0, Math.min(100, score)) / 100);
  return '<svg class="ring tone-' + tone + '" viewBox="0 0 ' + size + ' ' + size + '" width="' + size + '" height="' + size + '" role="img" aria-label="' + esc(label || 'Health ' + score + ' out of 100') + '"><circle class="ring-bg" cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '"/><circle class="ring-fg" cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" stroke-dasharray="' + c.toFixed(1) + '" style="--off:' + off.toFixed(1) + ';--full:' + c.toFixed(1) + '"/><text x="50%" y="50%" dy=".35em" text-anchor="middle">' + (tone === 'idle' ? '–' : score) + '</text></svg>';
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
  panel: null, panelTab: 'comments',
};
const activeFilterCount = () => ['text', 'assignee', 'label', 'project'].filter(k => ui.q[k]).length + (ui.q.status.length ? 1 : 0) + (ui.q.priority.length ? 1 : 0) + (ui.q.overdue ? 1 : 0) + (ui.q.onHold ? 1 : 0);

// ---------- routing ----------
function route() {
  const h = location.hash.replace(/^#\/?/, '');
  const [path, query] = h.split('?');
  const parts = path.split('/');
  return { name: parts[0] || '', id: decodeURIComponent(parts[1] || ''), params: new URLSearchParams(query || '') };
}
const VIEWS = { overview, board, backlog, projects, project: projectView, dependencies, risks, insights: insightsView, reports };
const NAV_OF = { project: 'projects' };
let lastHash = null;

function render() {
  const r = route();
  const view = VIEWS[r.name];
  const main = $('#main');
  if (!view) { location.replace('#/overview'); return; }
  if (r.name === 'dependencies' && r.params.get('p')) ui.deps.project = r.params.get('p');
  if (r.name === 'reports') { if (r.params.get('type')) ui.reports.type = r.params.get('type'); if (r.params.get('p')) ui.reports.project = r.params.get('p'); }
  main.innerHTML = view(r);
  main.dataset.view = r.name;
  $$('[data-nav]').forEach(a => a.toggleAttribute('aria-current', a.dataset.nav === (NAV_OF[r.name] || r.name)) || a.removeAttribute('aria-current'));
  $$('[data-nav]').forEach(a => { if (a.dataset.nav === (NAV_OF[r.name] || r.name)) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  const high = E.insights(data, TODAY).filter(i => i.level === 'high').length;
  $$('.ins-count').forEach(c => { c.hidden = !high; c.textContent = high; });
  $('#meSel').innerHTML = opts(people(), data.me);
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
    root.querySelectorAll('[data-count]').forEach(el => {
      const end = Number(el.dataset.count); const t0 = performance.now(); const dur = 700;
      const step = t => { const k = Math.min(1, (t - t0) / dur); el.textContent = Math.round(end * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    });
    root.querySelectorAll('.ring, .grow-in').forEach(el => el.classList.add('in'));
  });
}

// ---------- shared pieces ----------
function filterBar(where) {
  const q = ui.q; const ppl = people();
  const chips = [['me', 'Only my tasks', q.assignee === 'me'], ['overdue', 'Overdue', q.overdue], ['onHold', 'On hold', q.onHold]];
  return '<div class="fbar" role="search">' +
    '<label class="fsearch"><span class="sr">Search tasks</span><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg><input type="search" data-q="text" value="' + esc(q.text) + '" placeholder="Search key, title, label"></label>' +
    '<div class="avstack" role="group" aria-label="Filter by assignee">' + ppl.map(n => '<button type="button" class="avbtn' + ((q.assignee === n || (q.assignee === 'me' && n === data.me)) ? ' on' : '') + '" data-act="q-assignee" data-name="' + esc(n) + '" aria-pressed="' + (q.assignee === n) + '" aria-label="Only ' + esc(n) + '">' + avatar(n) + '</button>').join('') + '</div>' +
    chips.map(([k, l, on]) => '<button type="button" class="chip' + (on ? ' on' : '') + '" data-act="q-chip" data-k="' + k + '" aria-pressed="' + !!on + '">' + l + '</button>').join('') +
    '<label class="fsel"><span class="sr">Project</span><select data-q="project">' + opts(data.projects.map(p => [p.id, p.name]), q.project, 'All projects') + '</select></label>' +
    '<label class="fsel"><span class="sr">Label</span><select data-q="label">' + opts(E.allLabels(data), q.label, 'All labels') + '</select></label>' +
    '<label class="fsel"><span class="sr">Priority</span><select data-q="priority">' + opts(E.PRIORITIES, q.priority[0] || '', 'Any priority') + '</select></label>' +
    '<div class="saved"><label class="fsel"><span class="sr">Saved filters</span><select data-act="load-filter"><option value="">Saved filters</option>' + (data.filters || []).map(f => '<option value="' + esc(f.id) + '">' + esc(f.name) + '</option>').join('') + '</select></label>' +
    (activeFilterCount() ? '<button type="button" class="lnk" data-act="save-filter">Save</button><button type="button" class="lnk" data-act="clear-q">Clear (' + activeFilterCount() + ')</button>' : '') + '</div>' +
    (where === 'board' ? '<div class="seg" role="group" aria-label="Group the board"><button type="button" data-act="group" data-g="none" aria-pressed="' + (ui.group === 'none') + '">Columns</button><button type="button" data-act="group" data-g="people" aria-pressed="' + (ui.group === 'people') + '">By person</button></div>' : '') +
    '</div>';
}

function card(t) {
  const all = E.projectTasks(data, t.projectId);
  const waits = E.isWaiting(t, all); const od = E.isTaskOverdue(t, TODAY); const blocks = E.dependents(all, t.id).length;
  return '<article class="card' + (t.status === 'Done' ? ' is-done' : '') + (t.status === 'On hold' ? ' is-hold' : '') + '" data-task="' + esc(t.id) + '" data-flip="' + esc(t.id) + '" tabindex="0" aria-label="' + esc(t.key + ' ' + t.title + ', ' + t.status + ', ' + t.owner + ', due ' + fmtDate(t.due)) + '">' +
    '<div class="c-top"><span class="key">' + esc(t.key) + '</span>' + prioIcon(t.priority) + '</div>' +
    '<p class="c-title">' + esc(t.title) + '</p>' +
    (t.status === 'On hold' && t.holdReason ? '<p class="c-hold">' + esc(t.holdReason) + '</p>' : '') +
    ((t.labels || []).length ? '<div class="c-labels">' + t.labels.map(l => '<span class="lbl" style="--h:' + hue(l) + '">' + esc(l) + '</span>').join('') + '</div>' : '') +
    '<div class="c-foot"><span class="due' + (od ? ' late' : '') + '">' + esc(fmtDate(t.due, true)) + '</span>' + (waits ? '<span class="flag wait" title="Waits for unfinished tasks">waits</span>' : '') + (blocks && t.status !== 'Done' ? '<span class="flag blk" title="Tasks wait for this one">blocks ' + blocks + '</span>' : '') + (t.comments && t.comments.length ? '<span class="cm" title="Comments">' + t.comments.length + '</span>' : '') + '<span class="grow"></span>' + avatar(t.owner, 'sm') + '</div>' +
  '</article>';
}

// ---------- views ----------
function overview() {
  const s = E.portfolioSummary(data, TODAY);
  if (!data.projects.length) return '<div class="vh"><h2>Overview</h2></div>' + emptyState('An empty workspace', 'Create a project, or bring the sample portfolio back to explore.', '<div class="row"><button class="btn" data-act="new-project">New project</button><button class="btn ghost" data-act="reset">Load sample data</button></div>');
  const live = s.health.filter(x => x.project.status === 'Active' || x.project.status === 'On hold').sort((a, b) => a.h.score - b.h.score);
  const ins = E.insights(data, TODAY);
  const wl = E.workload(data); const maxDays = Math.max(1, ...wl.map(w => w.days));
  const onHold = data.tasks.filter(t => t.status === 'On hold').length;
  const kpi = (n, l, tone = '', hint = '') => '<div class="kpi ' + tone + '"><b data-count="' + n + '">' + n + '</b><span>' + l + '</span>' + (hint ? '<small>' + hint + '</small>' : '') + '</div>';
  const hello = new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 18 ? 'Good afternoon' : 'Good evening';
  return '<div class="vh"><div><p class="eyebrow">' + esc(fmtDate(TODAY)) + ' · Orbis Studio</p><h2>' + hello + ', ' + esc(String(data.me).split(' ')[0]) + '.</h2><p class="lede">' + (s.delayed ? s.delayed + ' project' + (s.delayed > 1 ? 's need' : ' needs') + ' attention, ' : 'Everything runs to plan, ') + s.overdueTasks + ' task' + (s.overdueTasks === 1 ? ' is' : 's are') + ' overdue and ' + onHold + ' on hold.</p></div><div class="row"><a class="btn ghost" href="#/board">Open the board</a></div></div>' +
    '<div class="kpis">' + kpi(s.active, 'Active projects') + kpi(s.delayed, 'Delayed', s.delayed ? 'bad' : '', 'late or a milestone missed') + kpi(s.openTasks, 'Open tasks') + kpi(s.overdueTasks, 'Overdue', s.overdueTasks ? 'warn' : '') + kpi(onHold, 'On hold', onHold ? 'warn' : '') + kpi(s.completed, 'Delivered', 'ok') + '</div>' +
    '<section class="panel"><div class="ph"><h3>Project health</h3><a class="lnk" href="#/projects">All projects</a></div><div class="rings">' +
      live.map(({ project: p, h }) => '<a class="ring-card" href="#/project/' + esc(p.id) + '">' + ring(h.score, healthTone(h.label), 78) + '<span><b>' + esc(p.name) + '</b><small>' + esc(h.label) + ' · ' + pct(h.progress) + ' done</small></span></a>').join('') + '</div></section>' +
    '<div class="grid g21">' +
      '<section class="panel"><div class="ph"><h3>Progress against plan</h3><span class="legend"><i class="lg-done"></i>Done <i class="lg-plan"></i>Expected today</span></div><ul class="bars">' +
        live.map(({ project: p, h }) => '<li><a href="#/project/' + esc(p.id) + '" class="bar-name">' + esc(p.name) + '</a><span class="bar" role="img" aria-label="' + esc(p.name) + ': ' + pct(h.progress) + ' done, ' + pct(h.expected) + ' expected"><span class="fill grow-in tone-' + healthTone(h.label) + '" style="--w:' + (h.progress * 100).toFixed(1) + '%"></span><span class="plan" style="left:' + (h.expected * 100).toFixed(1) + '%"></span></span><span class="bar-val">' + pct(h.progress) + '</span></li>').join('') + '</ul></section>' +
      '<section class="panel"><div class="ph"><h3>Needs attention</h3><a class="lnk" href="#/insights">All ' + ins.length + '</a></div>' + (ins.length ? '<ul class="att">' + ins.slice(0, 4).map(i => '<li class="lv-' + i.level + '"><b>' + esc(i.title) + '</b><span>' + esc(i.action) + '</span></li>').join('') + '</ul>' : emptyState('All clear', 'No rule found anything to flag.')) + '</section>' +
    '</div>' +
    '<div class="grid g11">' +
      '<section class="panel"><div class="ph"><h3>Who carries the work</h3><span class="muted small">open days of work</span></div><ul class="wl">' + wl.map(w => '<li><button type="button" class="wl-who" data-act="filter-person" data-name="' + esc(w.owner) + '">' + avatar(w.owner, 'sm') + '<span>' + esc(w.owner) + '</span></button><span class="bar"><span class="fill grow-in tone-done" style="--w:' + (w.days / maxDays * 100).toFixed(1) + '%"></span></span><span class="bar-val">' + w.days + ' d</span><small>' + w.tasks + ' tasks' + (w.onHold ? ' · ' + w.onHold + ' on hold' : '') + '</small></li>').join('') + '</ul></section>' +
      '<section class="panel"><div class="ph"><h3>Next 30 days</h3></div>' + (s.upcoming.length ? '<ol class="tl">' + s.upcoming.map(m => '<li><span class="tl-d">' + esc(fmtDate(m.target, true)) + '</span><span class="tl-dot"></span><span><b>' + esc(m.name) + '</b><small>' + esc(proj(m.projectId)?.name) + ' · ' + rel(m.target) + '</small></span></li>').join('') + '</ol>' : emptyState('Nothing due soon', 'No milestone in the next 30 days.')) +
      '<div class="ph sp"><h3>Highest risks</h3><a class="lnk" href="#/risks">Register</a></div><ul class="rl">' + s.topRisks.slice(0, 3).map(r => '<li><span class="score rk-' + slug(E.riskLevel(E.riskScore(r))) + '">' + E.riskScore(r) + '</span><span><b>' + esc(r.title) + '</b><small>' + esc(proj(r.projectId)?.name) + '</small></span></li>').join('') + '</ul></section>' +
    '</div>';
}

function board() {
  const list = E.applyFilter(data.tasks.filter(t => t.status !== 'Backlog'), ui.q, data.me, TODAY);
  const head = '<div class="vh"><div><h2>Board</h2><p class="lede">Drag a card to change its status. Dropping on <b>On hold</b> asks for a reason.</p></div><div class="row"><a class="btn ghost" href="#/backlog">Backlog <span class="pill-n">' + data.tasks.filter(t => t.status === 'Backlog').length + '</span></a><button class="btn" data-act="new-task">Create task</button></div></div>' + filterBar('board');
  if (!data.projects.length) return head + emptyState('No projects yet', 'Tasks belong to a project.', '<button class="btn" data-act="new-project">New project</button>');
  const col = (status, items, lane) => '<section class="col col-' + slug(status) + '" data-col="' + esc(status) + '"' + (lane ? ' data-lane="' + esc(lane) + '"' : '') + ' aria-label="' + esc(status) + '"><header><span class="dot"></span><h3>' + esc(status) + '</h3><span class="n">' + items.length + '</span></header><div class="col-body">' + items.sort(E.byRank).map(card).join('') + (items.length ? '' : '<p class="col-empty">Drop tasks here</p>') + '</div></section>';
  if (ui.group === 'people') {
    const ppl = [...new Set(list.map(t => t.owner))].sort();
    if (!ppl.length) return head + emptyState('No task matches', 'Change or clear the filters.', '<button class="btn ghost" data-act="clear-q">Clear filters</button>', 'search');
    return head + '<div class="lanes">' + ppl.map(p => { const mine = list.filter(t => t.owner === p); return '<div class="lane"><div class="lane-h">' + avatar(p) + '<b>' + esc(p) + '</b><span class="muted small">' + mine.length + ' tasks · ' + mine.filter(t => t.status !== 'Done').reduce((s, t) => s + t.estimate, 0) + ' days open</span></div><div class="board">' + E.BOARD_COLUMNS.map(st => col(st, mine.filter(t => t.status === st), p)).join('') + '</div></div>'; }).join('') + '</div>';
  }
  return head + (list.length || !activeFilterCount() ? '' : '<p class="note">No task matches these filters. <button class="lnk" data-act="clear-q">Clear filters</button></p>') + '<div class="board">' + E.BOARD_COLUMNS.map(st => col(st, list.filter(t => t.status === st))).join('') + '</div>';
}

function backlog() {
  const list = E.applyFilter(data.tasks, ui.q, data.me, TODAY);
  const rank = { Critical: 0, High: 1, Medium: 2, Low: 3 };
  const sorters = { rank: E.byRank, due: (a, b) => a.due.localeCompare(b.due), priority: (a, b) => rank[a.priority] - rank[b.priority] || a.due.localeCompare(b.due), key: (a, b) => a.key.localeCompare(b.key, 'en', { numeric: true }) };
  const sorted = list.sort(sorters[ui.backlogSort] || E.byRank);
  for (const id of [...ui.sel]) if (!data.tasks.some(t => t.id === id)) ui.sel.delete(id);
  const groups = [['Backlog', 'Not planned yet', sorted.filter(t => t.status === 'Backlog')], ['Planned', 'On the board', sorted.filter(t => t.status !== 'Backlog' && t.status !== 'Done')], ['Done', 'Finished', sorted.filter(t => t.status === 'Done')]];
  const row = t => { const od = E.isTaskOverdue(t, TODAY); return '<li class="bl-row' + (ui.sel.has(t.id) ? ' sel' : '') + '" data-flip="' + esc(t.id) + '"><label class="ck"><input type="checkbox" data-act="sel" data-id="' + esc(t.id) + '"' + (ui.sel.has(t.id) ? ' checked' : '') + '><span class="sr">Select ' + esc(t.key) + '</span></label>' + prioIcon(t.priority) + '<span class="key">' + esc(t.key) + '</span><button type="button" class="bl-title" data-act="open" data-id="' + esc(t.id) + '">' + esc(t.title) + '</button><span class="bl-labels">' + (t.labels || []).slice(0, 2).map(l => '<span class="lbl" style="--h:' + hue(l) + '">' + esc(l) + '</span>').join('') + '</span><span class="st st-' + slug(t.status) + '">' + esc(t.status) + '</span><span class="due' + (od ? ' late' : '') + '">' + esc(fmtDate(t.due, true)) + '</span><span class="est">' + t.estimate + ' d</span>' + avatar(t.owner, 'sm') + '</li>'; };
  const n = ui.sel.size;
  return '<div class="vh"><div><h2>Backlog</h2><p class="lede">Every task in one list. Select several to change them together.</p></div><div class="row"><label class="fsel"><span class="sr">Sort</span><select data-act="bl-sort">' + opts([['rank', 'Board order'], ['priority', 'Priority'], ['due', 'Due date'], ['key', 'Key']], ui.backlogSort) + '</select></label><button class="btn" data-act="new-task" data-status="Backlog">Create task</button></div></div>' + filterBar('backlog') +
    '<div class="bl-tools"><label class="ck"><input type="checkbox" data-act="sel-all"' + (n && n === sorted.length ? ' checked' : '') + '> <span>Select all ' + sorted.length + '</span></label></div>' +
    (sorted.length ? groups.filter(g => g[2].length).map(([name, sub, items]) => '<section class="bl-group"><h3>' + esc(name) + ' <small>' + esc(sub) + ' · ' + items.length + '</small></h3><ul class="bl-list">' + items.map(row).join('') + '</ul></section>').join('') : emptyState('No task matches', 'Change or clear the filters.', '<button class="btn ghost" data-act="clear-q">Clear filters</button>', 'search')) +
    '<div class="bulk' + (n ? ' show' : '') + '" role="region" aria-label="Change selected tasks"' + (n ? '' : ' hidden') + '><b>' + n + ' selected</b>' +
      '<label><span class="sr">Status</span><select data-act="bulk" data-field="status">' + opts(E.TASK_STATUSES, '', 'Status…') + '</select></label>' +
      '<label><span class="sr">Assignee</span><select data-act="bulk" data-field="owner">' + opts(people(), '', 'Assign to…') + '</select></label>' +
      '<label><span class="sr">Priority</span><select data-act="bulk" data-field="priority">' + opts(E.PRIORITIES, '', 'Priority…') + '</select></label>' +
      '<button type="button" class="lnk" data-act="bulk-label">Add label</button><button type="button" class="lnk" data-act="sel-none">Clear</button></div>';
}

function projects() {
  const prioRank = { Critical: 0, High: 1, Medium: 2, Low: 3 };
  let list = data.projects.filter(p => !ui.projStatus || p.status === ui.projStatus);
  const sorters = { deadline: (a, b) => a.deadline.localeCompare(b.deadline), name: (a, b) => a.name.localeCompare(b.name), health: (a, b) => E.health(data, a, TODAY).score - E.health(data, b, TODAY).score, priority: (a, b) => prioRank[a.priority] - prioRank[b.priority] };
  list = list.sort(sorters[ui.projSort]);
  return '<div class="vh"><div><h2>Projects</h2><p class="lede">' + data.projects.length + ' projects, sorted ' + ({ health: 'by health, weakest first', deadline: 'by deadline', name: 'by name', priority: 'by priority' }[ui.projSort]) + '.</p></div><div class="row"><label class="fsel"><span class="sr">Status</span><select data-act="proj-status">' + opts(E.PROJECT_STATUSES, ui.projStatus, 'All statuses') + '</select></label><label class="fsel"><span class="sr">Sort</span><select data-act="proj-sort">' + opts([['health', 'Health'], ['deadline', 'Deadline'], ['priority', 'Priority'], ['name', 'Name']], ui.projSort) + '</select></label><button class="btn" data-act="new-project">New project</button></div></div>' +
    (list.length ? '<div class="pgrid">' + list.map(p => { const h = E.health(data, p, TODAY); const tasks = E.projectTasks(data, p.id); const live = p.status === 'Active' || p.status === 'On hold';
      return '<a class="pcard" href="#/project/' + esc(p.id) + '" data-flip="' + esc(p.id) + '"><div class="pc-top"><span class="key">' + esc(p.code) + '</span><span class="st st-' + slug(p.status) + '">' + esc(p.status) + '</span></div><div class="pc-mid">' + ring(live ? h.score : (p.status === 'Completed' ? 100 : 0), live ? healthTone(h.label) : (p.status === 'Completed' ? 'done' : 'idle'), 64) + '<div><h3>' + esc(p.name) + '</h3><p>' + esc(p.objective) + '</p></div></div><div class="pc-bar"><span class="fill grow-in tone-' + healthTone(h.label) + '" style="--w:' + (h.progress * 100).toFixed(1) + '%"></span></div><div class="pc-foot">' + avatar(p.owner, 'sm') + '<span>' + esc(p.owner) + '</span><span class="grow"></span><span class="' + (h.pastDeadline ? 'late' : 'muted') + '">' + esc(fmtDate(p.deadline, true)) + '</span><span class="muted">' + tasks.length + ' tasks</span></div></a>'; }).join('') + '</div>' : emptyState('No project here', 'Change the filter or create one.', '<button class="btn" data-act="new-project">New project</button>'));
}

function projectView(r) {
  const p = proj(r.id);
  if (!p) return '<div class="vh"><h2>Project not found</h2></div>' + emptyState('This project does not exist', 'It may have been deleted, or the demo was reset.', '<a class="btn" href="#/projects">Back to projects</a>');
  const h = E.health(data, p, TODAY); const live = p.status === 'Active' || p.status === 'On hold';
  const ms = E.projectMilestones(data, p.id); const tasks = E.projectTasks(data, p.id);
  const risks = E.projectRisks(data, p.id).sort((a, b) => E.riskScore(b) - E.riskScore(a));
  const pen = h.penalties;
  const reasons = [['Schedule', pen.schedule, h.pastDeadline ? 'Deadline passed ' + rel(p.deadline) + '.' : pct(h.progress) + ' done, ' + pct(h.expected) + ' expected by today.'], ['Milestones', pen.milestones, h.overdueMilestones.length + ' overdue.'], ['Risks', pen.risks, h.highRisks.length + ' high or critical, ' + (h.openRisks.length - h.highRisks.length) + ' other open.'], ['On hold and stuck', pen.blockers, h.blocked.length + ' task' + (h.blocked.length === 1 ? '' : 's') + '.']];
  const span = Math.max(1, E.daysBetween(p.start, p.deadline));
  const posOf = iso => Math.max(0, Math.min(100, E.daysBetween(p.start, iso) / span * 100));
  const counts = E.TASK_STATUSES.map(s => [s, tasks.filter(t => t.status === s).length]).filter(x => x[1]);
  return '<nav class="crumbs" aria-label="Breadcrumb"><a href="#/projects">Projects</a><span>/</span><span>' + esc(p.name) + '</span></nav>' +
    '<div class="vh"><div><p class="eyebrow">' + esc(p.code) + ' · ' + esc(p.priority) + ' priority · ' + esc(p.status) + '</p><h2>' + esc(p.name) + '</h2><p class="lede">' + esc(p.objective) + '</p></div><div class="row"><button class="btn ghost" data-act="edit-project" data-id="' + esc(p.id) + '">Edit</button><a class="btn ghost" href="#/reports?type=project&p=' + esc(p.id) + '">Report</a><button class="btn ghost danger" data-act="del-project" data-id="' + esc(p.id) + '">Delete</button></div></div>' +
    '<div class="grid g21">' +
      '<section class="panel"><div class="ph"><h3>Timeline</h3><span class="muted small">' + esc(fmtDate(p.start)) + ' → ' + esc(fmtDate(p.deadline)) + '</span></div>' +
        '<div class="ptl"><div class="ptl-track"><span class="ptl-done grow-in" style="--w:' + (h.progress * 100).toFixed(1) + '%"></span>' + (TODAY >= p.start && TODAY <= p.deadline ? '<span class="ptl-today" style="left:' + posOf(TODAY) + '%"><i>Today</i></span>' : '') + ms.map(m => '<button type="button" class="ptl-ms' + (m.done ? ' done' : E.isMilestoneOverdue(m, TODAY) ? ' late' : '') + '" style="left:' + posOf(m.target) + '%" data-act="edit-milestone" data-id="' + esc(m.id) + '" title="' + esc(m.name + ' · ' + fmtDate(m.target)) + '"><span class="sr">' + esc(m.name) + '</span></button>').join('') + '</div></div>' +
        '<ol class="msl">' + ms.map(m => { const od = E.isMilestoneOverdue(m, TODAY); return '<li class="' + (m.done ? 'done' : od ? 'late' : '') + '"><label class="ck"><input type="checkbox" data-act="toggle-ms" data-id="' + esc(m.id) + '"' + (m.done ? ' checked' : '') + '><span class="sr">Mark ' + esc(m.name) + ' reached</span></label><span class="grow"><b>' + esc(m.name) + '</b><small>' + esc(fmtDate(m.target)) + ' · ' + (m.done ? 'reached' : od ? 'overdue, ' + rel(m.target) : rel(m.target)) + '</small></span><button class="lnk" data-act="edit-milestone" data-id="' + esc(m.id) + '">Edit</button></li>'; }).join('') + '</ol><button class="btn ghost sm" data-act="new-milestone" data-project="' + esc(p.id) + '">Add milestone</button>' +
        '<div class="summary"><p id="sumText">' + esc(E.statusSummary(data, p, TODAY)) + '</p><button class="lnk" data-act="copy-summary">Copy status summary</button></div></section>' +
      '<section class="panel hcard">' + ring(live ? h.score : 0, live ? healthTone(h.label) : 'idle', 120) + '<p class="hlabel tone-' + healthTone(h.label) + '">' + esc(h.label) + '</p>' +
        (live ? '<p class="small muted">Health starts at 100. Points come off for:</p><ul class="reasons">' + reasons.map(([k, v, why]) => '<li><span>' + k + '</span><b class="' + (v ? 'minus' : '') + '">' + (v ? '−' + v : '0') + '</b><small>' + esc(why) + '</small></li>').join('') + '</ul>' : '<p class="small muted">' + (p.status === 'Completed' ? 'Delivered projects are not scored.' : 'Scoring starts when the project is active.') + '</p>') +
        '<dl class="facts"><div><dt>Owner</dt><dd>' + avatar(p.owner, 'sm') + ' ' + esc(p.owner) + '</dd></div><div><dt>Risk exposure</dt><dd>' + h.exposure + '</dd></div></dl></section>' +
    '</div>' +
    '<section class="panel"><div class="ph"><h3>Tasks <small class="muted">' + tasks.length + '</small></h3><div class="row"><a class="lnk" href="#/dependencies?p=' + esc(p.id) + '">Dependency map</a><button class="btn sm" data-act="new-task" data-project="' + esc(p.id) + '">Create task</button></div></div>' +
      '<div class="stack-bar" role="img" aria-label="' + esc(counts.map(c => c[1] + ' ' + c[0]).join(', ')) + '">' + counts.map(([s, n]) => '<span class="sb sb-' + slug(s) + '" style="flex:' + n + '" title="' + esc(s + ': ' + n) + '"></span>').join('') + '</div><p class="sb-legend">' + counts.map(([s, n]) => '<span><i class="sb-' + slug(s) + '"></i>' + esc(s) + ' ' + n + '</span>').join('') + '</p>' +
      (tasks.length ? '<ul class="bl-list">' + tasks.sort(E.byRank).map(t => '<li class="bl-row" data-flip="' + esc(t.id) + '">' + prioIcon(t.priority) + '<span class="key">' + esc(t.key) + '</span><button type="button" class="bl-title" data-act="open" data-id="' + esc(t.id) + '">' + esc(t.title) + '</button><span class="bl-labels"></span><span class="st st-' + slug(t.status) + '">' + esc(t.status) + '</span><span class="due' + (E.isTaskOverdue(t, TODAY) ? ' late' : '') + '">' + esc(fmtDate(t.due, true)) + '</span><span class="est">' + t.estimate + ' d</span>' + avatar(t.owner, 'sm') + '</li>').join('') + '</ul>' : emptyState('No tasks yet', 'Break the project into tasks to track it.')) + '</section>' +
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
    return '<g class="node ' + cls + (cpSet.has(t.id) ? ' crit' : '') + '" transform="translate(' + o.x + ',' + o.y + ')" tabindex="0" role="button" data-act="open" data-id="' + esc(t.id) + '" aria-label="' + esc(t.key + ' ' + t.title + ', ' + t.status + (cpSet.has(t.id) ? ', on the critical path' : '')) + '"><rect width="' + W + '" height="' + H + '" rx="12"/><text x="14" y="22" class="n-k">' + esc(t.key) + '</text><text x="14" y="42" class="n-t">' + esc(short(t.title)) + '</text><text x="14" y="59" class="n-s">' + esc(t.owner.split(' ')[0] + ' · ' + t.status + ' · ' + fmtDate(t.due, true)) + '</text></g>'; }).join('');
  const blockers = tasks.filter(t => t.status !== 'Done' && E.dependents(tasks, t.id).length).map(t => ({ t, n: E.downstream(tasks, t.id).length })).sort((a, b) => b.n - a.n);
  return head + '<div class="legend-row"><span><i class="lg n-ready"></i>Ready</span><span><i class="lg n-waiting"></i>Waiting</span><span><i class="lg n-late"></i>Overdue</span><span><i class="lg n-hold"></i>On hold</span><span><i class="lg n-done"></i>Done</span><span><i class="lg n-crit"></i>Critical path</span></div>' +
    '<section class="panel graph-panel"><div class="graph-scroll"><svg class="graph" viewBox="0 0 ' + width + ' ' + height + '" width="' + width + '" height="' + height + '" role="group" aria-label="Dependency map of ' + esc(p.name) + '"><defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0L10,5L0,10z" class="ah"/></marker><marker id="arrC" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0L10,5L0,10z" class="ahc"/></marker></defs>' + edges + nodes + '</svg></div></section>' +
    '<div class="grid g11"><section class="panel"><h3>Critical path · ' + cp.days + ' days</h3>' + (cp.ids.length ? '<p class="small muted">The longest chain of unfinished work. A delay here delays the project.</p><ol class="cpath">' + cp.ids.map(id => { const t = task(id); return '<li><button type="button" class="bl-title" data-act="open" data-id="' + esc(id) + '"><span class="key">' + esc(t.key) + '</span> ' + esc(t.title) + '</button><small>' + esc(t.owner) + ' · ' + t.estimate + ' d · due ' + esc(fmtDate(t.due, true)) + '</small></li>'; }).join('') + '</ol>' : '<p class="muted">All tasks are done.</p>') + '</section>' +
    '<section class="panel"><h3>What holds up the most</h3>' + (blockers.length ? '<ul class="rl">' + blockers.slice(0, 6).map(({ t, n }) => '<li><span class="score ' + (E.isTaskOverdue(t, TODAY) || t.status === 'On hold' ? 'rk-critical' : 'rk-low') + '">' + n + '</span><span><button type="button" class="bl-title" data-act="open" data-id="' + esc(t.id) + '">' + esc(t.key + ' ' + t.title) + '</button><small>' + n + ' task' + (n === 1 ? '' : 's') + ' wait · ' + esc(t.status) + (E.isTaskOverdue(t, TODAY) ? ' · overdue' : '') + '</small></span></li>').join('') + '</ul>' : '<p class="muted">No unfinished task holds up another.</p>') + '</section></div>';
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
      { h: 'Milestones', head: ['Milestone', 'Target', 'State'], rows: E.projectMilestones(data, p.id).map(m => [m.name, m.target, m.done ? 'Reached' : E.isMilestoneOverdue(m, TODAY) ? 'Overdue' : 'Planned']) },
      { h: 'Open tasks', head: ['Key', 'Task', 'Assignee', 'Priority', 'Status', 'Due'], rows: E.projectTasks(data, p.id).filter(t => t.status !== 'Done').sort((a, b) => a.due.localeCompare(b.due)).map(t => [t.key, t.title, t.owner, t.priority, t.status + (t.status === 'On hold' ? ': ' + t.holdReason : '') + (E.isTaskOverdue(t, TODAY) ? ' (overdue)' : ''), t.due]) },
      { h: 'Open risks', head: ['Risk', 'Score', 'Owner', 'Mitigation'], rows: h.openRisks.sort((a, b) => E.riskScore(b) - E.riskScore(a)).map(r => [r.title, String(E.riskScore(r)), r.owner || '', r.mitigation || 'None yet']) }] };
  }
  if (type === 'milestones') return { title: 'Milestone report', intro: s.upcoming.length + ' milestone(s) due in the next 30 days; ' + data.milestones.filter(m => E.isMilestoneOverdue(m, TODAY)).length + ' overdue.', sections: [{ h: 'Open milestones', head: ['Project', 'Milestone', 'Target', 'State'], rows: data.milestones.filter(m => !m.done).sort((a, b) => a.target.localeCompare(b.target)).map(m => [proj(m.projectId)?.name || '', m.name, m.target, E.isMilestoneOverdue(m, TODAY) ? 'Overdue' : 'Planned']) }] };
  if (type === 'risks') { const open = data.risks.filter(r => r.status !== 'Closed'); return { title: 'Risk report', intro: open.length + ' open risk(s); ' + open.filter(r => E.riskScore(r) >= 10).length + ' high or critical; ' + open.filter(r => !String(r.mitigation || '').trim()).length + ' without a mitigation.', sections: [{ h: 'Open risks by score', head: ['Project', 'Risk', 'Impact', 'Probability', 'Score', 'Level', 'Owner', 'Mitigation'], rows: open.sort((a, b) => E.riskScore(b) - E.riskScore(a)).map(r => [proj(r.projectId)?.name || '', r.title, String(r.impact), String(r.probability), String(E.riskScore(r)), E.riskLevel(E.riskScore(r)), r.owner || '', r.mitigation || 'None yet']) }] }; }
  if (type === 'hold') { const h = data.tasks.filter(t => t.status === 'On hold'); return { title: 'Tasks on hold', intro: h.length + ' task(s) on hold.', sections: [{ h: 'On hold', head: ['Key', 'Task', 'Project', 'Assignee', 'Reason', 'Due'], rows: h.map(t => [t.key, t.title, proj(t.projectId)?.name || '', t.owner, t.holdReason, t.due]) }] }; }
  return { title: 'Portfolio overview', intro: s.total + ' projects: ' + s.active + ' active, ' + s.completed + ' completed, ' + s.delayed + ' delayed. ' + s.openTasks + ' open tasks, ' + s.overdueTasks + ' overdue.', sections: [{ h: 'Projects', head: ['Project', 'Owner', 'Status', 'Deadline', 'Progress', 'Expected', 'Health', 'Score'], rows: s.health.map(({ project: p, h }) => [p.name, p.owner, p.status, p.deadline, pct(h.progress), p.status === 'Completed' ? '' : pct(h.expected), h.label, p.status === 'Active' || p.status === 'On hold' ? String(h.score) : '']) }] };
}
function reports() {
  const f = ui.reports;
  if (!data.projects.length) return '<div class="vh"><h2>Reports</h2></div>' + emptyState('Nothing to report yet', 'Reports are made from the projects in this workspace.');
  if (!proj(f.project)) f.project = data.projects[0].id;
  const r = reportData(f.type, f.project);
  return '<div class="vh no-print"><div><h2>Reports</h2><p class="lede">Made from the live records, ready to print, save as PDF or open in a spreadsheet.</p></div><div class="row"><button class="btn ghost" data-act="print">Print or PDF</button><button class="btn" data-act="csv">Download CSV</button></div></div>' +
    '<div class="seg no-print rep-tabs" role="group" aria-label="Report">' + [['portfolio', 'Portfolio'], ['project', 'Project'], ['milestones', 'Milestones'], ['risks', 'Risks'], ['hold', 'On hold']].map(([k, l]) => '<button type="button" data-act="rep" data-k="' + k + '" aria-pressed="' + (f.type === k) + '">' + l + '</button>').join('') + '</div>' +
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
function openTask(id) { ui.panel = id; renderPanel(true); }
function closePanel() { const had = ui.panel; ui.panel = null; renderPanel(); if (had) { const c = document.querySelector('[data-task="' + had + '"]'); if (c) c.focus(); } }
function renderPanel(focus) {
  const el = $('#panel'); const t = ui.panel && task(ui.panel);
  document.body.classList.toggle('panel-open', !!t);
  if (!t) { el.hidden = true; el.innerHTML = ''; return; }
  const p = proj(t.projectId); const all = E.projectTasks(data, t.projectId);
  const waitsFor = (t.deps || []).map(task).filter(Boolean); const blocks = E.dependents(all, t.id);
  const flow = E.TASK_STATUSES.filter(s => s !== 'On hold');
  el.hidden = false;
  const scrollTop = el.querySelector('.pn-body') ? el.querySelector('.pn-body').scrollTop : 0;
  el.innerHTML = '<div class="pn-head"><span class="key">' + esc(t.key) + '</span><a href="#/project/' + esc(p.id) + '" class="muted small">' + esc(p.name) + '</a><span class="grow"></span><button type="button" class="icon" data-act="del-task" data-id="' + esc(t.id) + '" aria-label="Delete task" title="Delete"><svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg></button><button type="button" class="icon" data-act="close-panel" aria-label="Close" title="Close (Esc)"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>' +
    '<div class="pn-body">' +
    '<label class="sr" for="pnTitle">Title</label><textarea id="pnTitle" class="pn-title" rows="2" maxlength="100" data-field="title">' + esc(t.title) + '</textarea>' +
    (t.status === 'On hold' ? '<div class="holdbox"><b>On hold</b><p>' + esc(t.holdReason) + '</p><button type="button" class="btn sm" data-act="resume" data-id="' + esc(t.id) + '">Resume to ' + esc(t.heldFrom || 'To do') + '</button></div>' : '') +
    '<div class="flow" role="group" aria-label="Status">' + flow.map(s => '<button type="button" class="fl fl-' + slug(s) + '" data-act="set-status" data-s="' + esc(s) + '" aria-pressed="' + (t.status === s) + '">' + esc(s) + '</button>').join('') + (t.status !== 'On hold' ? '<button type="button" class="fl fl-on-hold" data-act="ask-hold" data-id="' + esc(t.id) + '">Put on hold…</button>' : '') + '</div>' +
    '<dl class="pn-grid">' +
      '<dt>Assignee</dt><dd><div class="who">' + avatar(t.owner, 'sm') + '<select data-field="owner" aria-label="Assignee">' + opts(people(), t.owner) + '</select></div>' + (t.owner !== data.me ? '<button type="button" class="lnk" data-act="assign-me">Assign to me</button>' : '') + '</dd>' +
      '<dt>Priority</dt><dd>' + prioIcon(t.priority) + '<select data-field="priority" aria-label="Priority">' + opts(E.PRIORITIES, t.priority) + '</select></dd>' +
      '<dt>Due</dt><dd><input type="date" data-field="due" value="' + esc(t.due) + '" aria-label="Due date"' + (E.isTaskOverdue(t, TODAY) ? ' class="late"' : '') + '></dd>' +
      '<dt>Estimate</dt><dd><input type="number" min="1" max="60" step="1" data-field="estimate" value="' + t.estimate + '" aria-label="Days of work"> days</dd>' +
      '<dt>Milestone</dt><dd><select data-field="milestoneId" aria-label="Milestone">' + opts(data.milestones.filter(m => m.projectId === t.projectId).map(m => [m.id, m.name]), t.milestoneId, 'None') + '</select></dd>' +
      '<dt>Labels</dt><dd><div class="lbls">' + (t.labels || []).map(l => '<span class="lbl" style="--h:' + hue(l) + '">' + esc(l) + '<button type="button" data-act="rm-label" data-l="' + esc(l) + '" aria-label="Remove label ' + esc(l) + '">×</button></span>').join('') + '<input list="labelList" class="lbl-in" placeholder="Add label" aria-label="Add a label" maxlength="20" data-act="add-label"></div><datalist id="labelList">' + E.allLabels(data).map(l => '<option value="' + esc(l) + '">').join('') + '</datalist></dd>' +
    '</dl>' +
    '<div class="pn-sec"><h4>Waits for</h4>' + (waitsFor.length ? '<ul class="deps">' + waitsFor.map(d => '<li><button type="button" class="bl-title" data-act="open" data-id="' + esc(d.id) + '"><span class="key">' + esc(d.key) + '</span> ' + esc(d.title) + '</button><span class="st st-' + slug(d.status) + '">' + esc(d.status) + '</span></li>').join('') + '</ul>' : '<p class="muted small">Nothing. It can start any time.</p>') + '<button type="button" class="lnk" data-act="edit-deps">Change what it waits for</button>' +
    (blocks.length ? '<h4>Holds up</h4><ul class="deps">' + blocks.map(d => '<li><button type="button" class="bl-title" data-act="open" data-id="' + esc(d.id) + '"><span class="key">' + esc(d.key) + '</span> ' + esc(d.title) + '</button><span class="st st-' + slug(d.status) + '">' + esc(d.status) + '</span></li>').join('') + '</ul>' : '') + '</div>' +
    '<div class="seg pn-tabs" role="tablist"><button type="button" role="tab" data-act="ptab" data-k="comments" aria-selected="' + (ui.panelTab === 'comments') + '">Comments ' + ((t.comments || []).length || '') + '</button><button type="button" role="tab" data-act="ptab" data-k="history" aria-selected="' + (ui.panelTab === 'history') + '">History ' + ((t.history || []).length || '') + '</button></div>' +
    (ui.panelTab === 'comments' ?
      '<ul class="comments">' + (t.comments || []).map(c => '<li>' + avatar(c.by, 'sm') + '<div><p class="c-meta"><b>' + esc(c.by) + '</b> · ' + esc(fmtStamp(c.at)) + '</p><p>' + esc(c.text) + '</p></div></li>').join('') + '</ul>' +
      '<form class="cform" data-form="comment"><label class="sr" for="cText">Add a comment</label><textarea id="cText" name="text" rows="2" maxlength="1000" placeholder="Add a comment as ' + esc(data.me) + '…"></textarea><button class="btn sm" type="submit">Comment</button><small class="err" hidden></small></form>'
      : '<ol class="history">' + [...(t.history || [])].reverse().map(h => '<li><span class="h-dot"></span><p>' + avatar(h.by, 'xs') + ' <b>' + esc(h.by) + '</b> ' + (h.field === 'Created' ? 'created the task' : 'changed <b>' + esc(h.field) + '</b>' + (h.from ? ' from <s>' + esc(h.from) + '</s>' : '') + ' to <span class="to">' + esc(h.to) + '</span>') + '</p><small>' + esc(fmtStamp(h.at)) + '</small></li>').join('') + '</ol>') +
    '</div>';
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
  dlg.innerHTML = '<form method="dialog" novalidate class="form"><header><h2 id="dlgTitle">' + esc(title) + '</h2><button type="button" class="icon" data-close aria-label="Close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></header><div class="form-body">' + body + '</div><footer>' + extraBtn + '<span class="grow"></span><button type="button" class="btn ghost" data-close>Cancel</button><button type="submit" class="btn">' + esc(submitLabel) + '</button></footer></form>';
  const form = dlg.querySelector('form');
  form.addEventListener('submit', e => {
    e.preventDefault();
    form.querySelectorAll('.err').forEach(x => { x.hidden = true; x.textContent = ''; });
    form.querySelectorAll('[aria-invalid]').forEach(x => x.removeAttribute('aria-invalid'));
    const errors = onSubmit(new FormData(form), form);
    if (errors && Object.keys(errors).length) {
      let first = null;
      for (const [k, msg] of Object.entries(errors)) { const el = form.querySelector('#e-' + k); const ctl = form.querySelector('[name="' + k + '"]'); if (el) { el.textContent = msg; el.hidden = false; } if (ctl) { ctl.setAttribute('aria-invalid', 'true'); ctl.setAttribute('aria-describedby', 'e-' + k); first = first || ctl; } }
      if (!first) toast(Object.values(errors)[0], 'error');
      (first || form.querySelector('input,select,textarea')).focus();
      form.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(0)' }], { duration: 240 });
      return;
    }
    dlg.close();
  });
  dlg.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => dlg.close()));
  dlg.showModal();
  const f = form.querySelector('input:not([type=hidden]),select,textarea'); if (f) f.focus();
}
function confirmBox(title, text, okLabel, onOk) {
  dlg.innerHTML = '<form method="dialog" class="form confirm"><header><h2 id="dlgTitle">' + esc(title) + '</h2></header><div class="form-body"><p>' + esc(text) + '</p></div><footer><span class="grow"></span><button type="button" class="btn ghost" data-close>Cancel</button><button type="submit" class="btn danger">' + esc(okLabel) + '</button></footer></form>';
  dlg.querySelector('form').addEventListener('submit', e => { e.preventDefault(); dlg.close(); onOk(); });
  dlg.querySelector('[data-close]').addEventListener('click', () => dlg.close());
  dlg.showModal(); dlg.querySelector('[data-close]').focus();
}
function askHold(id, onDone, onCancel) {
  const t = task(id);
  openForm('Put ' + t.key + ' on hold', '<p class="muted">' + esc(t.title) + '</p>' + field('holdReason', 'Why is it on hold?', '<textarea id="f-holdReason" name="holdReason" rows="3" maxlength="200" placeholder="For example: waiting for access from the finance team"></textarea>', 'Everyone sees this on the card until the task resumes.'),
    fd => { const reason = String(fd.get('holdReason') || '').trim(); if (!reason) return { holdReason: 'Say why the task is on hold.' }; onDone(reason); }, '', 'Put on hold');
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
    '<div class="two">' + field('status', 'Status', select('status', E.PROJECT_STATUSES, p.status)) + field('priority', 'Priority', select('priority', E.PRIORITIES, p.priority)) + '</div>',
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
    '<div class="two">' + field('projectId', 'Project', select('projectId', data.projects.map(p => [p.id, p.name + ' · ' + p.code]), pid)) + field('owner', 'Assignee', input('owner', data.me, 'text', 'list="peopleList" maxlength="40" required autocomplete="off"')) + '</div>' + peopleList() +
    '<div class="three">' + field('status', 'Status', select('status', E.TASK_STATUSES.filter(s => s !== 'On hold'), status || 'To do')) + field('priority', 'Priority', select('priority', E.PRIORITIES, 'Medium')) + field('estimate', 'Days of work', input('estimate', 2, 'number', 'min="1" max="60" step="1" inputmode="numeric" required')) + '</div>' +
    '<div class="two">' + field('due', 'Due date', input('due', E.addDays(TODAY, 7), 'date', 'required')) + field('labels', 'Labels', input('labels', '', 'text', 'placeholder="for example: frontend, release" autocomplete="off"'), 'Separate with commas') + '</div>',
    fd => {
      const projectId = fd.get('projectId');
      const col = data.tasks.filter(t => t.status === fd.get('status'));
      const next = { id: E.uid('t'), key: E.nextKey(data, projectId), projectId, title: fd.get('title').trim(), owner: fd.get('owner').trim(), priority: fd.get('priority'), status: fd.get('status'), estimate: Number(fd.get('estimate')), due: fd.get('due'), labels: [...new Set(String(fd.get('labels') || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean))], deps: [], milestoneId: '', holdReason: '', heldFrom: '', rank: (col.length ? Math.min(...col.map(t => t.rank)) : 1) - 1, comments: [], history: [{ at: stamp(), by: data.me, field: 'Created', from: '', to: '' }] };
      next.history[0].to = next.key;
      const errors = E.validateTask(next, data); if (Object.keys(errors).length) return errors;
      commit({ ...data, tasks: [...data.tasks, next] }, next.key + ' created.', { undo: true });
      openTask(next.id);
    }, '', 'Create');
}
function depsForm(id) {
  const t = task(id); const choices = data.tasks.filter(x => x.projectId === t.projectId && x.id !== t.id);
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
  if (col) {
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
    commit(r.data, status !== t.status ? t.key + ' moved to ' + status + '.' : '', { undo: status !== t.status || !!lane });
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
    ['Create task', 'c', () => taskForm()], ['Go to overview', 'g o', () => go('overview')], ['Go to board', 'g b', () => go('board')], ['Go to backlog', 'g l', () => go('backlog')], ['Go to projects', 'g p', () => go('projects')], ['Go to dependencies', 'g d', () => go('dependencies')], ['Go to risks', 'g r', () => go('risks')], ['Go to insights', 'g i', () => go('insights')], ['Go to reports', 'g e', () => go('reports')],
    ['Show only my tasks', '', () => { ui.q = { ...ui.q, assignee: 'me' }; go('board'); }], ['Show tasks on hold', '', () => { ui.q = { ...ui.q, onHold: true }; go('board'); }], ['New project', '', () => projectForm()], ['New risk', '', () => riskForm()], ['Switch light or dark', '', () => $('.theme-switch').click()], ['Reset the demo', '', () => resetDemo()],
  ];
  const draw = () => {
    const q = inp.value.trim().toLowerCase();
    const match = s => !q || s.toLowerCase().includes(q) || q.split(/\s+/).every(w => s.toLowerCase().includes(w));
    items = [
      ...cmds.filter(c => match(c[0])).map(c => ({ kind: 'Command', label: c[0], hint: c[1], run: c[2] })),
      ...data.tasks.filter(t => match(t.key + ' ' + t.title + ' ' + t.owner)).slice(0, q ? 8 : 4).map(t => ({ kind: 'Task', label: t.key + '  ' + t.title, hint: t.status, run: () => { if (!['board', 'backlog'].includes(route().name)) go('board'); openTask(t.id); } })),
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
  const rows = [['⌘ K or Ctrl K, /', 'Search and commands'], ['c', 'Create a task'], ['g then o, b, l, p, d, r, i, e', 'Go to a page'], ['Enter', 'Open the selected card'], ['[ and ]', 'Move the selected card one column left or right'], ['m', 'Assign the selected card to me'], ['Esc', 'Close a panel or dialog'], ['?', 'This list']];
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
    case 'edit-project': projectForm(proj(id)); break;
    case 'del-project': { const p = proj(id); const n = [E.projectMilestones(data, id).length, E.projectTasks(data, id).length, E.projectRisks(data, id).length]; confirmBox('Delete ' + p.name + '?', 'This also deletes its ' + n[0] + ' milestones, ' + n[1] + ' tasks and ' + n[2] + ' risks.', 'Delete project', () => { location.hash = '#/projects'; commit(E.deleteProject(data, id), p.name + ' deleted.', { undo: true }); }); break; }
    case 'new-milestone': milestoneForm(null, el.dataset.project); break;
    case 'edit-milestone': milestoneForm(data.milestones.find(x => x.id === id)); break;
    case 'new-task': taskForm(el.dataset.project, el.dataset.status); break;
    case 'new-risk': riskForm(null, el.dataset.project); break;
    case 'edit-risk': riskForm(data.risks.find(x => x.id === id)); break;
    case 'del-task': { const t = task(id); ui.panel = null; commit(E.deleteTask(data, id), t.key + ' deleted.', { undo: true }); break; }
    case 'close-panel': closePanel(); break;
    case 'set-status': { const s = el.dataset.s; const r = E.updateTask(data, ui.panel, { status: s }, data.me, stamp()); if (Object.keys(r.errors).length) { toast(Object.values(r.errors)[0], 'error'); el.animate([{ transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' }, { transform: 'none' }], { duration: 220 }); } else commit(r.data, task(ui.panel).key + ' is now ' + s + '.', { undo: true }); break; }
    case 'ask-hold': askHold(id, reason => { const r = E.hold(data, id, reason, data.me, stamp()); if (Object.keys(r.errors).length) toast(Object.values(r.errors)[0], 'error'); else commit(r.data, task(id).key + ' is on hold.', { undo: true }); }); break;
    case 'resume': { const r = E.resume(data, id, data.me, stamp()); if (Object.keys(r.errors).length) toast(Object.values(r.errors)[0], 'error'); else commit(r.data, task(id).key + ' resumed.', { undo: true }); break; }
    case 'assign-me': panelUpdate({ owner: data.me }, 'Assigned to you.'); break;
    case 'rm-label': panelUpdate({ labels: (task(ui.panel).labels || []).filter(l => l !== el.dataset.l) }, 'Label removed.'); break;
    case 'edit-deps': depsForm(ui.panel); break;
    case 'ptab': ui.panelTab = el.dataset.k; renderPanel(); break;
    case 'q-assignee': { const n = el.dataset.name; ui.q.assignee = (ui.q.assignee === n || (ui.q.assignee === 'me' && n === data.me)) ? '' : n; flipRender(); break; }
    case 'q-chip': { const k = el.dataset.k; if (k === 'me') ui.q.assignee = ui.q.assignee === 'me' ? '' : 'me'; else ui.q[k] = !ui.q[k]; flipRender(); break; }
    case 'clear-q': ui.q = { text: '', assignee: '', status: [], priority: [], label: '', project: '', overdue: false, onHold: false }; flipRender(); break;
    case 'save-filter': openForm('Save this filter', field('name', 'Name', input('name', '', 'text', 'maxlength="40" required autocomplete="off"'), 'It appears under Saved filters on the board and the backlog.'), fd => { const name = String(fd.get('name') || '').trim(); const err = E.validateFilterName(name, data.filters); if (err) return { name: err }; commit({ ...data, filters: [...(data.filters || []), { id: E.uid('f'), name, query: JSON.parse(JSON.stringify(ui.q)) }] }, 'Filter "' + name + '" saved.'); }, '', 'Save'); break;
    case 'group': ui.group = el.dataset.g; flipRender(); break;
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
    case 'reset': resetDemo(); break;
    case 'palette': openPalette(); break;
    case 'shortcuts': shortcutsHelp(); break;
    case 'more': $('#moreSheet').hidden = !$('#moreSheet').hidden; break;
  }
});
document.addEventListener('change', e => {
  const el = e.target;
  if (el.closest('#panel') && el.dataset.field && el.dataset.field !== 'title') {
    const f = el.dataset.field; const v = f === 'estimate' ? Number(el.value) : el.value;
    panelUpdate({ [f]: v }, { owner: 'Assigned to ' + v + '.', priority: 'Priority set to ' + v + '.', due: 'Due date changed.', estimate: 'Estimate changed.', milestoneId: 'Milestone changed.' }[f]);
    return;
  }
  const act = el.dataset.act;
  if (el.dataset.q) { const k = el.dataset.q; ui.q[k] = k === 'priority' ? (el.value ? [el.value] : []) : el.value; flipRender(); return; }
  if (act === 'load-filter') { const f = (data.filters || []).find(x => x.id === el.value); if (f) { ui.q = { text: '', assignee: '', status: [], priority: [], label: '', project: '', overdue: false, onHold: false, ...f.query }; flipRender(); toast('Filter "' + f.name + '" applied.'); } return; }
  if (act === 'bulk') {
    const field = el.dataset.field; const v = el.value; if (!v) return;
    const ids = [...ui.sel];
    const go2 = reason => { const r = E.bulkUpdate(data, ids, field === 'status' && v === 'On hold' ? { status: v, holdReason: reason } : { [field]: v }, data.me, stamp()); commit(r.data, r.done + ' task' + (r.done === 1 ? '' : 's') + ' updated.' + (r.failed.length ? ' ' + r.failed.length + ' refused: ' + r.failed.map(f => f.key + ' (' + f.error + ')').join('; ') : ''), { undo: r.done > 0 }); };
    if (field === 'status' && v === 'On hold') { openForm('Put ' + ids.length + ' tasks on hold', field2('holdReason'), fd => { const reason = String(fd.get('holdReason') || '').trim(); if (!reason) return { holdReason: 'Say why the tasks are on hold.' }; go2(reason); }, '', 'Put on hold'); el.value = ''; }
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
  if (el.id === 'meSel') { commit({ ...data, me: el.value }, 'You are now viewing as ' + el.value + '.'); return; }
});
function field2(name) { return field(name, 'Why are they on hold?', '<textarea id="f-' + name + '" name="' + name + '" rows="3" maxlength="200"></textarea>'); }
document.addEventListener('focusout', e => {
  const el = e.target;
  if (el.id === 'pnTitle' && ui.panel) { const v = el.value.trim(); const t = task(ui.panel); if (t && v !== t.title) { if (!v) { toast('A task needs a title.', 'error'); el.value = t.title; } else panelUpdate({ title: v }, 'Title saved.'); } }
});
document.addEventListener('keydown', e => {
  const el = e.target;
  if (el.matches && el.matches('.lbl-in') && e.key === 'Enter') { e.preventDefault(); const l = el.value.trim().toLowerCase(); if (l) panelUpdate({ labels: [...(task(ui.panel).labels || []), l] }, 'Label "' + l + '" added.'); return; }
  if (el.id === 'pnTitle' && e.key === 'Enter') { e.preventDefault(); el.blur(); return; }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); pal.hidden ? openPalette() : closePalette(); return; }
  if (e.key === 'Escape') { if (!pal.hidden) { closePalette(); return; } if (dlg.open) return; if (ui.panel) { closePanel(); return; } if (!$('#moreSheet').hidden) { $('#moreSheet').hidden = true; return; } }
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable || dlg.open || !pal.hidden;
  if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
  if (el.matches && el.matches('g.node') && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openTask(el.dataset.id); return; }
  if (el.matches && el.matches('.card')) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openTask(el.dataset.task); return; }
    if (e.key === '[' || e.key === ']') { e.preventDefault(); moveByKey(el.dataset.task, e.key === ']' ? 1 : -1); return; }
    if (e.key === 'm') { const r = E.updateTask(data, el.dataset.task, { owner: data.me }, data.me, stamp()); if (!Object.keys(r.errors).length) commit(r.data, task(el.dataset.task).key + ' assigned to you.', { undo: true }); return; }
  }
  if (e.key === '/') { e.preventDefault(); openPalette(); return; }
  if (e.key === '?') { shortcutsHelp(); return; }
  if (e.key === 'c') { e.preventDefault(); taskForm(); return; }
  if (e.key === 'g') { gPending = Date.now(); return; }
  if (gPending && Date.now() - gPending < 1200) { const map = { o: 'overview', b: 'board', l: 'backlog', p: 'projects', d: 'dependencies', r: 'risks', i: 'insights', e: 'reports' }; if (map[e.key]) { go(map[e.key]); } gPending = 0; }
});
let gPending = 0;
let searchTimer;
document.addEventListener('input', e => { const el = e.target; if (el.dataset.q === 'text') { clearTimeout(searchTimer); searchTimer = setTimeout(() => { ui.q.text = el.value; render(); const again = document.querySelector('[data-q="text"]'); if (again) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); } }, 160); } });
document.addEventListener('submit', e => {
  const f = e.target; if (f.dataset.form !== 'comment') return; e.preventDefault();
  const r = E.addComment(data, ui.panel, f.text.value, data.me, stamp());
  if (Object.keys(r.errors).length) { const er = f.querySelector('.err'); er.textContent = Object.values(r.errors)[0]; er.hidden = false; return; }
  commit(r.data, 'Comment added.'); setTimeout(() => { const list = $('#panel .comments'); if (list && list.lastElementChild) list.lastElementChild.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, 30);
});

function resetDemo() { confirmBox('Reset the demo?', 'Everything saved in this browser for Command Center is removed and the original sample data comes back.', 'Reset demo', () => { clearSaved(); data = seed(TODAY); ui.sel.clear(); ui.panel = null; toast('Sample data restored.'); if (route().name === 'project') location.hash = '#/overview'; else render(); }); }
$('#resetDemo').addEventListener('click', resetDemo);
$('#startEmpty').addEventListener('click', () => confirmBox('Start with an empty workspace?', 'Everything saved in this browser for Command Center is removed. Reset demo brings the sample data back.', 'Empty the workspace', () => { clearSaved(); data = { version: 2, me: data.me, projects: [], milestones: [], tasks: [], risks: [], filters: [] }; ui.sel.clear(); ui.panel = null; location.hash = '#/overview'; render(); toast('The workspace is empty.'); }));
$('#enterDemo').addEventListener('click', e => { e.preventDefault(); $('#app').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
window.addEventListener('hashchange', () => { $('#moreSheet').hidden = true; navigate(); });
window.addEventListener('storage', e => { if (e.key === KEY) { data = load(); render(); } });

// ---------- hero: a live miniature of this workspace ----------
function hero() {
  const s = E.portfolioSummary(data, TODAY);
  const live = s.health.filter(x => x.project.status === 'Active').sort((a, b) => a.h.score - b.h.score).slice(0, 3);
  const cols = E.BOARD_COLUMNS.map(c => [c, data.tasks.filter(t => t.status === c).length]); const max = Math.max(1, ...cols.map(c => c[1]));
  const top = E.insights(data, TODAY)[0];
  $('#heroLive').innerHTML = '<p class="hl-tag"><span class="pulse"></span>Live from the demo workspace</p><div class="hl-rings">' + live.map(({ project: p, h }) => '<div>' + ring(h.score, healthTone(h.label), 84) + '<b>' + esc(p.name) + '</b><small>' + esc(h.label) + '</small></div>').join('') + '</div>' +
    '<div class="hl-cols">' + cols.map(([c, n], i) => '<div class="hl-col"><span class="hl-bar grow-in sb-' + slug(c) + '" style="--h:' + (n / max * 100).toFixed(0) + '%;--d:' + i * 90 + 'ms"></span><b>' + n + '</b><small>' + esc(c) + '</small></div>').join('') + '</div>' +
    (top ? '<p class="hl-ins"><b>' + esc(top.title) + '.</b> ' + esc(top.action) + '</p>' : '');
  animateIn($('#heroLive'));
}

if (!location.hash) history.replaceState(null, '', '#/overview');
hero();
render();
lastHash = location.hash;
if (startNotice) toast(startNotice, 'error');

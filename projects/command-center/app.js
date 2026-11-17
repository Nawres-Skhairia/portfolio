// Command Center: screens. All figures come from engine.js; this file only shows them and saves changes.
import * as E from './engine.js';
import { seed } from './seed.js';

const KEY = 'command-center-v1';
const pad = n => String(n).padStart(2, '0');
const now = new Date();
const TODAY = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());

// ---------- storage ----------
let startNotice = '';
function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw);
      if (E.isValidData(d)) return d;
      startNotice = 'The saved workspace could not be read, so the sample data was restored.';
    }
  } catch (e) { /* storage blocked: keep going with sample data */ }
  return seed(TODAY);
}
let data = load();
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(data)); return true; }
  catch (e) { toast('This browser did not allow saving. Your changes last until you close the tab.', 'error'); return false; }
}
function commit(next, message) { data = next; save(); render(); if (message) toast(message); }

// ---------- helpers ----------
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = x => Math.round(x * 100) + '%';
const fmtDate = iso => { if (!iso) return ''; const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }); };
const rel = iso => { const n = E.daysBetween(TODAY, iso); return n === 0 ? 'today' : n === 1 ? 'tomorrow' : n === -1 ? 'yesterday' : n > 0 ? 'in ' + n + ' days' : Math.abs(n) + ' days ago'; };
const proj = id => data.projects.find(p => p.id === id);
const owners = () => [...new Set([...data.projects.map(p => p.owner), ...data.tasks.map(t => t.owner), ...data.risks.map(r => r.owner)].filter(Boolean))].sort();
const healthClass = label => ({ 'On track': 'ok', 'At risk': 'warn', 'Critical': 'bad', 'Delivered': 'done', 'Not started': 'idle' }[label] || 'idle');
const prioClass = p => 'prio-' + String(p).toLowerCase();
const statusClass = s => 'st-' + String(s).toLowerCase().replace(/\s+/g, '-');
const riskClass = s => 'rk-' + E.riskLevel(s).toLowerCase();
function opts(list, sel, blank) { return (blank !== undefined ? '<option value="">' + esc(blank) + '</option>' : '') + list.map(v => { const [val, lab] = Array.isArray(v) ? v : [v, v]; return '<option value="' + esc(val) + '"' + (String(val) === String(sel) ? ' selected' : '') + '>' + esc(lab) + '</option>'; }).join(''); }
function emptyState(title, text, action) { return '<div class="empty"><p class="empty-t">' + esc(title) + '</p><p>' + esc(text) + '</p>' + (action || '') + '</div>'; }

function toast(msg, kind = 'ok') {
  const box = $('#toasts'); const el = document.createElement('div');
  el.className = 'toast ' + kind; el.textContent = msg; box.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, kind === 'error' ? 6000 : 3200);
}

// ---------- routing ----------
const filters = {
  projects: { q: '', status: '', sort: 'deadline' },
  tasks: { q: '', project: '', status: '', priority: '', owner: '', overdue: false, sort: 'due' },
  risks: { project: '', status: 'open', cell: null },
  deps: { project: '' },
  reports: { type: 'portfolio', project: '' },
};
function route() {
  const h = location.hash.replace(/^#\/?/, '');
  const [path, query] = h.split('?');
  const parts = path.split('/');
  return { name: parts[0] || '', id: parts[1] || '', params: new URLSearchParams(query || '') };
}

let lastRoute = '';
function render() {
  const r = route();
  const views = { dashboard, projects, project: projectView, tasks, dependencies, risks, insights: insightsView, reports };
  const view = views[r.name];
  document.body.classList.toggle('in-app', !!view);
  const main = $('#main');
  if (!view) { main.innerHTML = ''; updateNav(''); return; }
  if (r.name === 'tasks' && r.params.get('p') !== null) filters.tasks.project = r.params.get('p');
  if (r.name === 'dependencies' && r.params.get('p')) filters.deps.project = r.params.get('p');
  if (r.name === 'reports') { if (r.params.get('type')) filters.reports.type = r.params.get('type'); if (r.params.get('p')) filters.reports.project = r.params.get('p'); }
  main.innerHTML = view(r);
  updateNav(r.name === 'project' ? 'projects' : r.name);
  const ins = E.insights(data, TODAY).filter(i => i.level === 'high').length;
  const c = $('#insCount'); c.hidden = !ins; c.textContent = ins;
  if (location.hash !== lastRoute) {
    const first = lastRoute === '';
    lastRoute = location.hash;
    if (!first) {
      const h1 = main.querySelector('h2'); if (h1) { h1.setAttribute('tabindex', '-1'); h1.focus({ preventScroll: true }); }
      $('#app').scrollIntoView({ block: 'start' });
    }
  }
}
function updateNav(name) { document.querySelectorAll('[data-nav]').forEach(a => { if (a.dataset.nav === name) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); }); }

// ---------- views ----------
function dashboard() {
  const s = E.portfolioSummary(data, TODAY);
  if (!data.projects.length) return '<h2>Dashboard</h2>' + emptyState('No projects yet', 'Create your first project, or load the sample portfolio to explore.', '<div class="row-btns"><button class="btn" data-act="new-project">New project</button><button class="btn line" data-act="reset">Load sample data</button></div>');
  const live = s.health.filter(x => x.project.status !== 'Completed').sort((a, b) => a.h.score - b.h.score);
  const ins = E.insights(data, TODAY).slice(0, 3);
  const kpi = (n, l, cls = '', hint = '') => '<div class="kpi ' + cls + '"><b>' + n + '</b><span>' + l + '</span>' + (hint ? '<small>' + hint + '</small>' : '') + '</div>';
  return '<div class="view-head"><h2>Portfolio overview</h2><p class="sub">Orbis Studio · ' + fmtDate(TODAY) + '</p></div>' +
    '<div class="kpis">' + kpi(s.total, 'Projects') + kpi(s.active, 'Active') + kpi(s.completed, 'Completed', 'k-done') + kpi(s.delayed, 'Delayed', s.delayed ? 'k-bad' : '', 'late or a milestone missed') + kpi(s.openTasks, 'Open tasks') + kpi(s.overdueTasks, 'Overdue tasks', s.overdueTasks ? 'k-warn' : '') + '</div>' +
    '<div class="grid g-2-1">' +
      '<section class="panel"><div class="p-head"><h3>Progress against plan</h3><span class="legend"><i class="lg-done"></i>Done <i class="lg-plan"></i>Expected today</span></div>' +
        (live.length ? '<ul class="bars">' + live.map(({ project: p, h }) => '<li><a href="#/project/' + esc(p.id) + '" class="bar-name">' + esc(p.name) + '</a><span class="bar" role="img" aria-label="' + esc(p.name) + ': ' + pct(h.progress) + ' done, ' + pct(h.expected) + ' expected"><span class="fill ' + healthClass(h.label) + '" style="width:' + (h.progress * 100).toFixed(1) + '%"></span><span class="plan" style="left:' + (h.expected * 100).toFixed(1) + '%"></span></span><span class="bar-val">' + pct(h.progress) + '</span><span class="badge ' + healthClass(h.label) + '">' + esc(h.label) + (h.label !== 'Not started' ? ' · ' + h.score : '') + '</span></li>').join('') + '</ul>' : emptyState('Nothing in progress', 'Every project is completed.')) +
      '</section>' +
      '<section class="panel"><div class="p-head"><h3>Needs attention</h3><a href="#/insights" class="lnk">All insights</a></div>' +
        (ins.length ? '<ul class="ins-mini">' + ins.map(i => '<li class="lv-' + i.level + '"><b>' + esc(i.title) + '</b><span>' + esc(i.action) + '</span></li>').join('') + '</ul>' : emptyState('All clear', 'No rule found anything to flag in this workspace.')) +
      '</section>' +
    '</div>' +
    '<div class="grid g-1-1">' +
      '<section class="panel"><div class="p-head"><h3>Milestones in the next 30 days</h3></div>' +
        (s.upcoming.length ? '<ul class="list">' + s.upcoming.map(m => '<li><span class="date-chip">' + esc(fmtDate(m.target)) + '</span><span class="grow"><b>' + esc(m.name) + '</b><small>' + esc(proj(m.projectId)?.name) + ' · ' + rel(m.target) + '</small></span></li>').join('') + '</ul>' : emptyState('No milestone due soon', 'Nothing is planned in the next 30 days.')) +
      '</section>' +
      '<section class="panel"><div class="p-head"><h3>Highest risks</h3><a href="#/risks" class="lnk">Risk register</a></div>' +
        (s.topRisks.length ? '<ul class="list">' + s.topRisks.map(r => '<li><span class="score ' + riskClass(E.riskScore(r)) + '">' + E.riskScore(r) + '</span><span class="grow"><b>' + esc(r.title) + '</b><small>' + esc(proj(r.projectId)?.name) + ' · ' + esc(r.status) + '</small></span></li>').join('') + '</ul>' : emptyState('No open risks', 'Register a risk from any project.')) +
      '</section>' +
    '</div>' +
    '<section class="panel"><div class="p-head"><h3>Project health</h3><a href="#/projects" class="lnk">All projects</a></div>' + projectTable(s.health.map(x => x.project)) + '</section>';
}

function projectTable(list) {
  if (!list.length) return emptyState('No project matches', 'Change the search or the filters.');
  return '<div class="tbl-wrap"><table class="tbl"><thead><tr><th scope="col">Project</th><th scope="col">Owner</th><th scope="col">Status</th><th scope="col">Priority</th><th scope="col">Deadline</th><th scope="col">Progress</th><th scope="col">Health</th></tr></thead><tbody>' +
    list.map(p => { const h = E.health(data, p, TODAY); return '<tr><td data-label="Project"><a href="#/project/' + esc(p.id) + '" class="strong">' + esc(p.name) + '</a><small class="muted"> ' + esc(p.code || '') + '</small></td><td data-label="Owner">' + esc(p.owner) + '</td><td data-label="Status"><span class="pill ' + statusClass(p.status) + '">' + esc(p.status) + '</span></td><td data-label="Priority"><span class="prio ' + prioClass(p.priority) + '">' + esc(p.priority) + '</span></td><td data-label="Deadline" class="' + (h.pastDeadline ? 'late' : '') + '">' + esc(fmtDate(p.deadline)) + '</td><td data-label="Progress" class="num">' + pct(h.progress) + '</td><td data-label="Health"><span class="badge ' + healthClass(h.label) + '">' + esc(h.label) + (p.status === 'Active' || p.status === 'On hold' ? ' · ' + h.score : '') + '</span></td></tr>'; }).join('') + '</tbody></table></div>';
}

function projects() {
  const f = filters.projects;
  const prioRank = { Critical: 0, High: 1, Medium: 2, Low: 3 };
  let list = data.projects.filter(p => (!f.status || p.status === f.status) && (!f.q || (p.name + ' ' + p.owner + ' ' + p.objective + ' ' + (p.code || '')).toLowerCase().includes(f.q.toLowerCase())));
  const sorters = { deadline: (a, b) => a.deadline.localeCompare(b.deadline), name: (a, b) => a.name.localeCompare(b.name), health: (a, b) => E.health(data, a, TODAY).score - E.health(data, b, TODAY).score, priority: (a, b) => prioRank[a.priority] - prioRank[b.priority] };
  list = list.sort(sorters[f.sort] || sorters.deadline);
  return '<div class="view-head"><h2>Projects</h2><button class="btn" data-act="new-project">New project</button></div>' +
    '<div class="filters" role="search"><label class="f-search"><span class="sr">Search projects</span><input type="search" data-filter="projects.q" value="' + esc(f.q) + '" placeholder="Search by name, owner or objective"></label>' +
    '<label><span>Status</span><select data-filter="projects.status">' + opts(E.PROJECT_STATUSES, f.status, 'All') + '</select></label>' +
    '<label><span>Sort by</span><select data-filter="projects.sort">' + opts([['deadline', 'Deadline'], ['health', 'Health (lowest first)'], ['priority', 'Priority'], ['name', 'Name']], f.sort) + '</select></label></div>' +
    (data.projects.length ? projectTable(list) : emptyState('No projects yet', 'A project groups milestones, tasks and risks.', '<button class="btn" data-act="new-project">New project</button>'));
}

function projectView(r) {
  const p = proj(r.id);
  if (!p) return '<h2>Project not found</h2>' + emptyState('This project does not exist', 'It may have been deleted, or the demo was reset.', '<a class="btn" href="#/projects">Back to projects</a>');
  const h = E.health(data, p, TODAY);
  const ms = E.projectMilestones(data, p.id);
  const tasks = E.projectTasks(data, p.id).sort((a, b) => a.due.localeCompare(b.due));
  const risks = E.projectRisks(data, p.id).sort((a, b) => E.riskScore(b) - E.riskScore(a));
  const pen = h.penalties; const live = p.status === 'Active' || p.status === 'On hold';
  const reasons = live ? [
    ['Schedule', pen.schedule, h.pastDeadline ? 'Deadline passed ' + rel(p.deadline) + '.' : pct(h.progress) + ' done, ' + pct(h.expected) + ' expected by today.'],
    ['Milestones', pen.milestones, h.overdueMilestones.length + ' overdue.'],
    ['Risks', pen.risks, h.highRisks.length + ' high or critical, ' + (h.openRisks.length - h.highRisks.length) + ' other open.'],
    ['Blockers', pen.blockers, h.blocked.length + ' blocked task' + (h.blocked.length === 1 ? '' : 's') + '.'],
  ] : [];
  return '<nav class="crumbs" aria-label="Breadcrumb"><a href="#/projects">Projects</a> / <span>' + esc(p.name) + '</span></nav>' +
    '<div class="view-head"><h2>' + esc(p.name) + ' <small class="muted">' + esc(p.code || '') + '</small></h2><div class="row-btns"><button class="btn line" data-act="edit-project" data-id="' + esc(p.id) + '">Edit</button><a class="btn line" href="#/reports?type=project&p=' + esc(p.id) + '">Report</a><button class="btn danger line" data-act="del-project" data-id="' + esc(p.id) + '">Delete</button></div></div>' +
    '<div class="grid g-2-1">' +
      '<section class="panel"><p class="objective">' + esc(p.objective) + '</p>' + (p.description ? '<p class="muted">' + esc(p.description) + '</p>' : '') +
        '<dl class="facts"><div><dt>Owner</dt><dd>' + esc(p.owner) + '</dd></div><div><dt>Status</dt><dd><span class="pill ' + statusClass(p.status) + '">' + esc(p.status) + '</span></dd></div><div><dt>Priority</dt><dd><span class="prio ' + prioClass(p.priority) + '">' + esc(p.priority) + '</span></dd></div><div><dt>Start</dt><dd>' + esc(fmtDate(p.start)) + '</dd></div><div><dt>Deadline</dt><dd class="' + (h.pastDeadline ? 'late' : '') + '">' + esc(fmtDate(p.deadline)) + ' <small>(' + rel(p.deadline) + ')</small></dd></div><div><dt>Risk exposure</dt><dd>' + h.exposure + '</dd></div></dl>' +
        '<div class="summary"><p id="sumText">' + esc(E.statusSummary(data, p, TODAY)) + '</p><button class="lnk" data-act="copy-summary">Copy status summary</button></div>' +
      '</section>' +
      '<section class="panel health-card"><div class="gauge ' + healthClass(h.label) + '"><b>' + (live ? h.score : '—') + '</b><span>' + esc(h.label) + '</span></div>' +
        (live ? '<p class="small muted">Starts at 100. Points are taken off for:</p><ul class="reasons">' + reasons.map(([k, v, why]) => '<li><span>' + k + '</span><b class="' + (v ? 'minus' : '') + '">' + (v ? '−' + v : '0') + '</b><small>' + esc(why) + '</small></li>').join('') + '</ul>' : '<p class="small muted">' + (p.status === 'Completed' ? 'Delivered projects are not scored.' : 'Scoring starts when the project is active.') + '</p>') +
      '</section>' +
    '</div>' +
    '<section class="panel"><div class="p-head"><h3>Milestones</h3><button class="btn sm" data-act="new-milestone" data-project="' + esc(p.id) + '">Add milestone</button></div>' +
      (ms.length ? '<ol class="timeline">' + ms.map(m => { const od = E.isMilestoneOverdue(m, TODAY); return '<li class="' + (m.done ? 'is-done' : od ? 'is-late' : '') + '"><label class="chk"><input type="checkbox" data-act="toggle-ms" data-id="' + esc(m.id) + '"' + (m.done ? ' checked' : '') + '><span class="sr">Mark ' + esc(m.name) + ' as done</span></label><span class="grow"><b>' + esc(m.name) + '</b><small>' + esc(fmtDate(m.target)) + ' · ' + (m.done ? 'done' : od ? 'overdue, ' + rel(m.target) : rel(m.target)) + '</small></span><button class="icon-btn" data-act="edit-milestone" data-id="' + esc(m.id) + '" aria-label="Edit ' + esc(m.name) + '">Edit</button></li>'; }).join('') + '</ol>' : emptyState('No milestones', 'Milestones mark the moments that matter, like a pilot or a go-live.')) +
    '</section>' +
    '<section class="panel"><div class="p-head"><h3>Tasks <small class="muted">' + tasks.length + '</small></h3><div class="row-btns"><a class="lnk" href="#/dependencies?p=' + esc(p.id) + '">Dependency map</a><button class="btn sm" data-act="new-task" data-project="' + esc(p.id) + '">Add task</button></div></div>' + taskTable(tasks, false) + '</section>' +
    '<section class="panel"><div class="p-head"><h3>Risks <small class="muted">' + risks.length + '</small></h3><button class="btn sm" data-act="new-risk" data-project="' + esc(p.id) + '">Add risk</button></div>' + riskTable(risks, false) + '</section>';
}

function taskTable(list, showProject = true) {
  if (!list.length) return emptyState('No tasks here', 'Add a task, or change the filters.');
  return '<div class="tbl-wrap"><table class="tbl"><thead><tr><th scope="col">Task</th>' + (showProject ? '<th scope="col">Project</th>' : '') + '<th scope="col">Owner</th><th scope="col">Priority</th><th scope="col">Status</th><th scope="col">Due</th><th scope="col">Days</th><th scope="col">Links</th></tr></thead><tbody>' +
    list.map(t => { const all = E.projectTasks(data, t.projectId); const waits = E.isWaiting(t, all); const blocks = E.dependents(all, t.id).length; const od = E.isTaskOverdue(t, TODAY);
      return '<tr class="' + (t.status === 'Done' ? 'is-done' : '') + '"><td data-label="Task"><button class="cell-link" data-act="edit-task" data-id="' + esc(t.id) + '">' + esc(t.title) + '</button></td>' + (showProject ? '<td data-label="Project"><a href="#/project/' + esc(t.projectId) + '">' + esc(proj(t.projectId)?.name) + '</a></td>' : '') +
        '<td data-label="Owner">' + esc(t.owner) + '</td><td data-label="Priority"><span class="prio ' + prioClass(t.priority) + '">' + esc(t.priority) + '</span></td>' +
        '<td data-label="Status"><select class="inline-sel ' + statusClass(t.status) + '" data-act="task-status" data-id="' + esc(t.id) + '" aria-label="Status of ' + esc(t.title) + '">' + opts(E.TASK_STATUSES, t.status) + '</select></td>' +
        '<td data-label="Due" class="' + (od ? 'late' : '') + '">' + esc(fmtDate(t.due)) + (od ? ' <small>overdue</small>' : '') + '</td><td data-label="Days" class="num">' + esc(t.estimate) + '</td>' +
        '<td data-label="Links">' + (waits ? '<span class="tagx wait" title="Waits for unfinished tasks">waits</span>' : '') + (blocks ? '<span class="tagx blk" title="Other tasks wait for this one">blocks ' + blocks + '</span>' : '') + (!waits && !blocks ? '<span class="muted">—</span>' : '') + '</td></tr>'; }).join('') + '</tbody></table></div>';
}

function tasks() {
  const f = filters.tasks; const rank = { Critical: 0, High: 1, Medium: 2, Low: 3 }; const srank = { Blocked: 0, 'In progress': 1, 'To do': 2, Done: 3 };
  let list = data.tasks.filter(t => (!f.project || t.projectId === f.project) && (!f.status || t.status === f.status) && (!f.priority || t.priority === f.priority) && (!f.owner || t.owner === f.owner) && (!f.overdue || E.isTaskOverdue(t, TODAY)) && (!f.q || (t.title + ' ' + t.owner).toLowerCase().includes(f.q.toLowerCase())));
  const sorters = { due: (a, b) => a.due.localeCompare(b.due), priority: (a, b) => rank[a.priority] - rank[b.priority] || a.due.localeCompare(b.due), status: (a, b) => srank[a.status] - srank[b.status] || a.due.localeCompare(b.due), owner: (a, b) => a.owner.localeCompare(b.owner) };
  list.sort(sorters[f.sort] || sorters.due);
  return '<div class="view-head"><h2>Tasks</h2><button class="btn" data-act="new-task"' + (data.projects.length ? '' : ' disabled') + '>New task</button></div>' +
    '<div class="filters" role="search"><label class="f-search"><span class="sr">Search tasks</span><input type="search" data-filter="tasks.q" value="' + esc(f.q) + '" placeholder="Search by task or owner"></label>' +
    '<label><span>Project</span><select data-filter="tasks.project">' + opts(data.projects.map(p => [p.id, p.name]), f.project, 'All') + '</select></label>' +
    '<label><span>Status</span><select data-filter="tasks.status">' + opts(E.TASK_STATUSES, f.status, 'All') + '</select></label>' +
    '<label><span>Priority</span><select data-filter="tasks.priority">' + opts(E.PRIORITIES, f.priority, 'All') + '</select></label>' +
    '<label><span>Owner</span><select data-filter="tasks.owner">' + opts(owners(), f.owner, 'All') + '</select></label>' +
    '<label><span>Sort by</span><select data-filter="tasks.sort">' + opts([['due', 'Due date'], ['priority', 'Priority'], ['status', 'Status'], ['owner', 'Owner']], f.sort) + '</select></label>' +
    '<label class="f-check"><input type="checkbox" data-filter="tasks.overdue"' + (f.overdue ? ' checked' : '') + '> Only overdue</label></div>' +
    '<p class="result-count" aria-live="polite">' + list.length + ' of ' + data.tasks.length + ' tasks</p>' +
    (data.projects.length ? taskTable(list) : emptyState('No projects yet', 'Tasks belong to a project. Create a project first.', '<a class="btn" href="#/projects">Go to projects</a>'));
}

function riskTable(list, showProject = true) {
  if (!list.length) return emptyState('No risks here', 'Register what could go wrong before it does.');
  return '<div class="tbl-wrap"><table class="tbl"><thead><tr><th scope="col">Score</th><th scope="col">Risk</th>' + (showProject ? '<th scope="col">Project</th>' : '') + '<th scope="col">Impact × probability</th><th scope="col">Owner</th><th scope="col">Status</th><th scope="col">Mitigation</th></tr></thead><tbody>' +
    list.map(r => { const s = E.riskScore(r); return '<tr class="' + (r.status === 'Closed' ? 'is-done' : '') + '"><td data-label="Score"><span class="score ' + riskClass(s) + '">' + s + '</span></td><td data-label="Risk"><button class="cell-link" data-act="edit-risk" data-id="' + esc(r.id) + '">' + esc(r.title) + '</button></td>' + (showProject ? '<td data-label="Project"><a href="#/project/' + esc(r.projectId) + '">' + esc(proj(r.projectId)?.name) + '</a></td>' : '') + '<td data-label="Impact × probability" class="num">' + r.impact + ' × ' + r.probability + '</td><td data-label="Owner">' + esc(r.owner || '—') + '</td><td data-label="Status"><span class="pill ' + statusClass(r.status) + '">' + esc(r.status) + '</span></td><td data-label="Mitigation">' + (r.mitigation ? esc(r.mitigation) : '<span class="missing">None yet</span>') + '</td></tr>'; }).join('') + '</tbody></table></div>';
}

function risks() {
  const f = filters.risks;
  const base = data.risks.filter(r => (!f.project || r.projectId === f.project) && (f.status === 'all' || (f.status === 'open' ? r.status !== 'Closed' : r.status === f.status)));
  const list = base.filter(r => !f.cell || (r.impact === f.cell[0] && r.probability === f.cell[1])).sort((a, b) => E.riskScore(b) - E.riskScore(a));
  let grid = '';
  for (let i = 5; i >= 1; i--) {
    grid += '<div class="mx-ylab" aria-hidden="true">' + i + '</div>';
    for (let pr = 1; pr <= 5; pr++) {
      const n = base.filter(r => r.impact === i && r.probability === pr).length; const s = i * pr; const on = f.cell && f.cell[0] === i && f.cell[1] === pr;
      grid += '<button class="mx-cell ' + riskClass(s) + (on ? ' on' : '') + (n ? ' has' : '') + '" data-act="cell" data-i="' + i + '" data-p="' + pr + '" aria-pressed="' + (on ? 'true' : 'false') + '" aria-label="Impact ' + i + ', probability ' + pr + ': ' + n + ' risk' + (n === 1 ? '' : 's') + '">' + (n || '') + '</button>';
    }
  }
  grid += '<div></div>' + [1, 2, 3, 4, 5].map(n => '<div class="mx-xlab" aria-hidden="true">' + n + '</div>').join('');
  return '<div class="view-head"><h2>Risk register</h2><button class="btn" data-act="new-risk"' + (data.projects.length ? '' : ' disabled') + '>New risk</button></div>' +
    '<div class="grid g-1-2">' +
      '<section class="panel"><div class="p-head"><h3>Impact × probability</h3>' + (f.cell ? '<button class="lnk" data-act="cell-clear">Show all</button>' : '') + '</div><div class="matrix-wrap"><span class="mx-axis-y">Impact</span><div class="matrix">' + grid + '</div><span class="mx-axis-x">Probability</span></div><p class="small muted">Score = impact × probability. 15 and above is critical, 10 to 14 high. Select a square to filter the list.</p></section>' +
      '<section class="panel"><div class="filters tight"><label><span>Project</span><select data-filter="risks.project">' + opts(data.projects.map(p => [p.id, p.name]), f.project, 'All') + '</select></label><label><span>Status</span><select data-filter="risks.status">' + opts([['open', 'Open and mitigating'], ['all', 'All'], ...E.RISK_STATUSES.map(s => [s, s])], f.status) + '</select></label></div>' + riskTable(list) + '</section>' +
    '</div>';
}

function dependencies() {
  if (!data.projects.length) return '<h2>Dependencies</h2>' + emptyState('No projects yet', 'Create a project and tasks to see how they depend on each other.');
  const f = filters.deps;
  if (!proj(f.project)) f.project = (data.projects.find(p => p.status === 'Active') || data.projects[0]).id;
  const p = proj(f.project); const tasks = E.projectTasks(data, p.id);
  const head = '<div class="view-head"><h2>Dependencies</h2><label class="inline-f"><span>Project</span><select data-filter="deps.project">' + opts(data.projects.map(x => [x.id, x.name]), f.project) + '</select></label></div>';
  if (!tasks.length) return head + emptyState('No tasks in ' + p.name, 'Add tasks, then link them with "Waits for".', '<button class="btn" data-act="new-task" data-project="' + esc(p.id) + '">Add task</button>');
  const lv = E.levels(tasks); const cp = E.criticalPath(tasks); const cpSet = new Set(cp.ids);
  const cols = {}; for (const t of tasks) (cols[lv[t.id]] = cols[lv[t.id]] || []).push(t);
  Object.values(cols).forEach(c => c.sort((a, b) => a.due.localeCompare(b.due)));
  const W = 196, H = 64, GX = 64, GY = 22, PAD = 16;
  const pos = {}; let maxRows = 0;
  Object.entries(cols).forEach(([l, c]) => { maxRows = Math.max(maxRows, c.length); c.forEach((t, i) => { pos[t.id] = { x: PAD + Number(l) * (W + GX), y: PAD + i * (H + GY) }; }); });
  const width = PAD * 2 + (Math.max(...Object.keys(cols).map(Number)) + 1) * (W + GX) - GX, height = PAD * 2 + maxRows * (H + GY) - GY;
  let edges = '';
  for (const t of tasks) for (const d of t.deps) { if (!pos[d]) continue; const a = pos[d], b = pos[t.id]; const x1 = a.x + W, y1 = a.y + H / 2, x2 = b.x - 6, y2 = b.y + H / 2; const crit = cpSet.has(t.id) && cpSet.has(d) && cp.ids.indexOf(t.id) === cp.ids.indexOf(d) + 1; const dep = data.tasks.find(x => x.id === d);
    edges += '<path class="edge' + (crit ? ' crit' : '') + (dep && dep.status !== 'Done' ? '' : ' met') + '" d="M' + x1 + ',' + y1 + ' C' + (x1 + GX / 2) + ',' + y1 + ' ' + (x2 - GX / 2) + ',' + y2 + ' ' + x2 + ',' + y2 + '" marker-end="url(#' + (crit ? 'arrC' : 'arr') + ')"/>'; }
  const short = s => s.length > 26 ? s.slice(0, 25) + '…' : s;
  const nodes = tasks.map(t => { const o = pos[t.id]; const waits = E.isWaiting(t, tasks); const od = E.isTaskOverdue(t, TODAY); const cls = t.status === 'Done' ? 'done' : t.status === 'Blocked' ? 'blocked' : od ? 'late' : waits ? 'waiting' : 'ready';
    return '<g class="node ' + cls + (cpSet.has(t.id) ? ' crit' : '') + '" transform="translate(' + o.x + ',' + o.y + ')" tabindex="0" role="button" data-act="edit-task" data-id="' + esc(t.id) + '" aria-label="' + esc(t.title + ', ' + t.status + ', due ' + fmtDate(t.due) + (cpSet.has(t.id) ? ', on the critical path' : '')) + '"><rect width="' + W + '" height="' + H + '" rx="10"/><text x="12" y="25" class="n-t">' + esc(short(t.title)) + '</text><text x="12" y="46" class="n-s">' + esc(t.owner.split(' ')[0] + ' · ' + t.status + ' · ' + fmtDate(t.due).replace(/ \d{4}$/, '')) + '</text></g>'; }).join('');
  const blockers = tasks.filter(t => t.status !== 'Done' && E.dependents(tasks, t.id).length).map(t => ({ t, n: E.downstream(tasks, t.id).length })).sort((a, b) => b.n - a.n);
  return head +
    '<div class="legend-row"><span><i class="lg n-ready"></i>Ready</span><span><i class="lg n-waiting"></i>Waiting</span><span><i class="lg n-late"></i>Overdue</span><span><i class="lg n-blocked"></i>Blocked</span><span><i class="lg n-done"></i>Done</span><span><i class="lg n-crit"></i>Critical path</span></div>' +
    '<section class="panel graph-panel"><div class="graph-scroll"><svg class="graph" viewBox="0 0 ' + width + ' ' + height + '" width="' + width + '" height="' + height + '" role="group" aria-label="Dependency map of ' + esc(p.name) + '"><defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0L10,5L0,10z" class="ah"/></marker><marker id="arrC" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0L10,5L0,10z" class="ahc"/></marker></defs>' + edges + nodes + '</svg></div><p class="small muted">Arrows point from a task to the tasks that wait for it. Select a task to edit it.</p></section>' +
    '<div class="grid g-1-1"><section class="panel"><h3>Critical path</h3>' + (cp.ids.length ? '<p class="muted small">The longest chain of unfinished work: ' + cp.days + ' days. A delay on any of these delays the project.</p><ol class="path">' + cp.ids.map(id => { const t = tasks.find(x => x.id === id); return '<li><b>' + esc(t.title) + '</b><small>' + esc(t.owner) + ' · ' + t.estimate + ' d · due ' + esc(fmtDate(t.due)) + '</small></li>'; }).join('') + '</ol>' : '<p class="muted">All tasks are done.</p>') + '</section>' +
    '<section class="panel"><h3>What blocks the most</h3>' + (blockers.length ? '<ul class="list">' + blockers.slice(0, 6).map(({ t, n }) => '<li><span class="score ' + (E.isTaskOverdue(t, TODAY) || t.status === 'Blocked' ? 'rk-critical' : 'rk-low') + '">' + n + '</span><span class="grow"><b>' + esc(t.title) + '</b><small>' + n + ' task' + (n === 1 ? '' : 's') + ' wait for it · ' + esc(t.status) + (E.isTaskOverdue(t, TODAY) ? ' · overdue' : '') + '</small></span></li>').join('') + '</ul>' : '<p class="muted">No unfinished task holds up another.</p>') + '</section></div>';
}

function evidenceLink(ev) {
  if (ev.type === 'project') { const p = proj(ev.id); return p ? '<a href="#/project/' + esc(p.id) + '">' + esc(p.name) + '</a>' : ''; }
  if (ev.type === 'task') { const t = data.tasks.find(x => x.id === ev.id); return t ? '<button class="ev" data-act="edit-task" data-id="' + esc(t.id) + '">' + esc(t.title) + '</button>' : ''; }
  if (ev.type === 'risk') { const r = data.risks.find(x => x.id === ev.id); return r ? '<button class="ev" data-act="edit-risk" data-id="' + esc(r.id) + '">' + esc(r.title) + '</button>' : ''; }
  if (ev.type === 'milestone') { const m = data.milestones.find(x => x.id === ev.id); return m ? '<button class="ev" data-act="edit-milestone" data-id="' + esc(m.id) + '">' + esc(m.name) + '</button>' : ''; }
  return '';
}

function insightsView() {
  const list = E.insights(data, TODAY);
  return '<div class="view-head"><h2>Insights</h2></div><p class="intro-note">Clear rules applied to the records in this workspace: dates, dependencies, scores and owners. Each insight lists the records it comes from, so you can check it.</p>' +
    (list.length ? '<ul class="ins-list">' + list.map(i => '<li class="ins lv-' + i.level + '"><div class="ins-h"><span class="lvl">' + (i.level === 'high' ? 'Act now' : 'Keep an eye') + '</span><h3>' + esc(i.title) + '</h3></div><p>' + esc(i.text) + '</p><p class="act"><b>Suggested action:</b> ' + esc(i.action) + '</p><p class="evs"><span>Based on:</span> ' + i.evidence.slice(0, 6).map(evidenceLink).join('') + (i.evidence.length > 6 ? '<span class="muted"> and ' + (i.evidence.length - 6) + ' more</span>' : '') + '</p></li>').join('') + '</ul>' : emptyState('Nothing to flag', data.projects.length ? 'No rule found a late milestone, a blocking task, an unmitigated risk or an overloaded owner.' : 'Add projects and tasks first.'));
}

// ---------- reports ----------
function reportData(type, pid) {
  const s = E.portfolioSummary(data, TODAY);
  if (type === 'project') {
    const p = proj(pid) || data.projects[0]; if (!p) return null;
    const h = E.health(data, p, TODAY);
    return { title: 'Project status: ' + p.name, intro: E.statusSummary(data, p, TODAY),
      sections: [
        { h: 'Milestones', head: ['Milestone', 'Target', 'State'], rows: E.projectMilestones(data, p.id).map(m => [m.name, m.target, m.done ? 'Done' : E.isMilestoneOverdue(m, TODAY) ? 'Overdue' : 'Planned']) },
        { h: 'Open tasks', head: ['Task', 'Owner', 'Priority', 'Status', 'Due'], rows: E.projectTasks(data, p.id).filter(t => t.status !== 'Done').sort((a, b) => a.due.localeCompare(b.due)).map(t => [t.title, t.owner, t.priority, t.status + (E.isTaskOverdue(t, TODAY) ? ' (overdue)' : ''), t.due]) },
        { h: 'Open risks', head: ['Risk', 'Score', 'Owner', 'Mitigation'], rows: h.openRisks.sort((a, b) => E.riskScore(b) - E.riskScore(a)).map(r => [r.title, String(E.riskScore(r)), r.owner || '', r.mitigation || 'None yet']) },
      ] };
  }
  if (type === 'milestones') return { title: 'Milestone report', intro: s.upcoming.length + ' milestone(s) due in the next 30 days; ' + data.milestones.filter(m => E.isMilestoneOverdue(m, TODAY)).length + ' overdue.',
    sections: [{ h: 'All open milestones', head: ['Project', 'Milestone', 'Target', 'State'], rows: data.milestones.filter(m => !m.done).sort((a, b) => a.target.localeCompare(b.target)).map(m => [proj(m.projectId)?.name || '', m.name, m.target, E.isMilestoneOverdue(m, TODAY) ? 'Overdue' : 'Planned']) }] };
  if (type === 'risks') { const open = data.risks.filter(r => r.status !== 'Closed'); return { title: 'Risk report', intro: open.length + ' open risk(s); ' + open.filter(r => E.riskScore(r) >= 10).length + ' high or critical; ' + open.filter(r => !String(r.mitigation || '').trim()).length + ' without a mitigation.',
    sections: [{ h: 'Open risks by score', head: ['Project', 'Risk', 'Impact', 'Probability', 'Score', 'Level', 'Owner', 'Mitigation'], rows: open.sort((a, b) => E.riskScore(b) - E.riskScore(a)).map(r => [proj(r.projectId)?.name || '', r.title, String(r.impact), String(r.probability), String(E.riskScore(r)), E.riskLevel(E.riskScore(r)), r.owner || '', r.mitigation || 'None yet']) }] }; }
  return { title: 'Portfolio overview', intro: s.total + ' projects: ' + s.active + ' active, ' + s.completed + ' completed, ' + s.delayed + ' delayed. ' + s.openTasks + ' open tasks, ' + s.overdueTasks + ' overdue.',
    sections: [{ h: 'Projects', head: ['Project', 'Owner', 'Status', 'Deadline', 'Progress', 'Expected', 'Health', 'Score'], rows: s.health.map(({ project: p, h }) => [p.name, p.owner, p.status, p.deadline, pct(h.progress), p.status === 'Completed' ? '' : pct(h.expected), h.label, p.status === 'Active' || p.status === 'On hold' ? String(h.score) : '']) }] };
}

function reports() {
  const f = filters.reports;
  if (!data.projects.length) return '<h2>Reports</h2>' + emptyState('Nothing to report yet', 'Reports are made from the projects in this workspace.');
  if (!proj(f.project)) f.project = data.projects[0].id;
  const r = reportData(f.type, f.project);
  return '<div class="view-head no-print"><h2>Reports</h2><div class="row-btns"><button class="btn line" data-act="print">Print or save as PDF</button><button class="btn" data-act="csv">Download CSV</button></div></div>' +
    '<div class="filters no-print"><label><span>Report</span><select data-filter="reports.type">' + opts([['portfolio', 'Portfolio overview'], ['project', 'Project status'], ['milestones', 'Milestones'], ['risks', 'Risks']], f.type) + '</select></label>' + (f.type === 'project' ? '<label><span>Project</span><select data-filter="reports.project">' + opts(data.projects.map(p => [p.id, p.name]), f.project) + '</select></label>' : '') + '</div>' +
    '<article class="report" id="report"><header><p class="r-brand">Command Center · Orbis Studio (sample data)</p><h3>' + esc(r.title) + '</h3><p class="r-date">Made on ' + esc(fmtDate(TODAY)) + ' from the records in this workspace.</p></header><p class="r-intro">' + esc(r.intro) + '</p>' +
      r.sections.map(sec => '<h4>' + esc(sec.h) + '</h4>' + (sec.rows.length ? '<div class="tbl-wrap"><table class="tbl r-tbl"><thead><tr>' + sec.head.map(x => '<th scope="col">' + esc(x) + '</th>').join('') + '</tr></thead><tbody>' + sec.rows.map(row => '<tr>' + row.map((c, i) => '<td data-label="' + esc(sec.head[i]) + '">' + esc(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>' : '<p class="muted">None.</p>')).join('') +
    '</article>';
}

function downloadCsv() {
  const f = filters.reports; const r = reportData(f.type, f.project); if (!r) return;
  const rows = [[r.title], ['Made on', TODAY], []];
  for (const s of r.sections) { rows.push([s.h]); rows.push(s.head); s.rows.forEach(x => rows.push(x)); rows.push([]); }
  const blob = new Blob(['﻿' + E.toCsv(rows)], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'command-center-' + f.type + '-' + TODAY + '.csv';
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('CSV downloaded.');
}

// ---------- forms ----------
const dlg = $('#dlg');
function field(name, label, control, hint) { return '<div class="fld" data-field="' + name + '"><label for="f-' + name + '">' + label + '</label>' + control + (hint ? '<small class="hint" id="h-' + name + '">' + hint + '</small>' : '') + '<small class="err" id="e-' + name + '" hidden></small></div>'; }
const input = (name, val, type = 'text', extra = '') => '<input id="f-' + name + '" name="' + name + '" type="' + type + '" value="' + esc(val ?? '') + '" ' + extra + '>';
const select = (name, list, val, blank) => '<select id="f-' + name + '" name="' + name + '">' + opts(list, val, blank) + '</select>';
const ownerList = () => '<datalist id="ownerList">' + owners().map(o => '<option value="' + esc(o) + '">').join('') + '</datalist>';

function openForm(title, body, onSubmit, extraBtn = '') {
  dlg.innerHTML = '<form method="dialog" novalidate class="form"><header><h2 id="dlgTitle">' + esc(title) + '</h2><button type="button" class="icon-btn" data-close aria-label="Close">✕</button></header><div class="form-body">' + body + '</div><footer>' + extraBtn + '<span class="grow"></span><button type="button" class="btn line" data-close>Cancel</button><button type="submit" class="btn">Save</button></footer></form>';
  const form = dlg.querySelector('form');
  form.addEventListener('submit', e => {
    e.preventDefault();
    form.querySelectorAll('.err').forEach(x => { x.hidden = true; x.textContent = ''; });
    form.querySelectorAll('[aria-invalid]').forEach(x => x.removeAttribute('aria-invalid'));
    const errors = onSubmit(new FormData(form), form);
    if (errors && Object.keys(errors).length) {
      let first = null;
      for (const [k, msg] of Object.entries(errors)) {
        const el = form.querySelector('#e-' + k); const ctl = form.querySelector('[name="' + k + '"]');
        if (el) { el.textContent = msg; el.hidden = false; }
        if (ctl) { ctl.setAttribute('aria-invalid', 'true'); ctl.setAttribute('aria-describedby', 'e-' + k); first = first || ctl; }
      }
      if (!first) toast(Object.values(errors)[0], 'error');
      (first || form.querySelector('input,select,textarea')).focus();
      return;
    }
    dlg.close();
  });
  dlg.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => dlg.close()));
  dlg.showModal();
  const f = form.querySelector('input,select,textarea'); if (f) f.focus();
}

function confirmBox(title, text, okLabel, onOk) {
  dlg.innerHTML = '<form method="dialog" class="form confirm"><header><h2 id="dlgTitle">' + esc(title) + '</h2></header><div class="form-body"><p>' + esc(text) + '</p></div><footer><span class="grow"></span><button type="button" class="btn line" data-close>Cancel</button><button type="submit" class="btn danger">' + esc(okLabel) + '</button></footer></form>';
  dlg.querySelector('form').addEventListener('submit', e => { e.preventDefault(); dlg.close(); onOk(); });
  dlg.querySelector('[data-close]').addEventListener('click', () => dlg.close());
  dlg.showModal(); dlg.querySelector('[data-close]').focus();
}

function projectForm(p) {
  const isNew = !p; p = p || { id: E.uid('p'), name: '', code: '', objective: '', description: '', owner: '', start: TODAY, deadline: E.addDays(TODAY, 60), status: 'Planned', priority: 'Medium' };
  openForm(isNew ? 'New project' : 'Edit project',
    field('name', 'Name', input('name', p.name, 'text', 'maxlength="60" required autocomplete="off"')) +
    '<div class="two">' + field('code', 'Short code', input('code', p.code, 'text', 'maxlength="6" autocomplete="off"'), 'Optional, up to 6 letters') + field('owner', 'Owner', input('owner', p.owner, 'text', 'list="ownerList" maxlength="40" required autocomplete="off"')) + '</div>' + ownerList() +
    field('objective', 'Objective', '<textarea id="f-objective" name="objective" rows="2" maxlength="240">' + esc(p.objective) + '</textarea>') +
    field('description', 'Description', '<textarea id="f-description" name="description" rows="3" maxlength="1000">' + esc(p.description) + '</textarea>') +
    '<div class="two">' + field('start', 'Start', input('start', p.start, 'date', 'required')) + field('deadline', 'Deadline', input('deadline', p.deadline, 'date', 'required')) + '</div>' +
    '<div class="two">' + field('status', 'Status', select('status', E.PROJECT_STATUSES, p.status)) + field('priority', 'Priority', select('priority', E.PRIORITIES, p.priority)) + '</div>',
    fd => {
      const next = { ...p, name: fd.get('name').trim(), code: fd.get('code').trim().toUpperCase(), owner: fd.get('owner').trim(), objective: fd.get('objective').trim(), description: fd.get('description').trim(), start: fd.get('start'), deadline: fd.get('deadline'), status: fd.get('status'), priority: fd.get('priority') };
      const errors = E.validateProject(next, data.projects); if (Object.keys(errors).length) return errors;
      commit({ ...data, projects: isNew ? [...data.projects, next] : data.projects.map(x => x.id === next.id ? next : x) }, isNew ? 'Project created.' : 'Project saved.');
      if (isNew) location.hash = '#/project/' + next.id;
    });
}

function milestoneForm(m, projectId) {
  const isNew = !m; m = m || { id: E.uid('m'), projectId: projectId || (data.projects[0] || {}).id, name: '', target: E.addDays(TODAY, 14), done: false };
  openForm(isNew ? 'New milestone' : 'Edit milestone',
    field('name', 'Name', input('name', m.name, 'text', 'maxlength="80" required autocomplete="off"')) +
    '<div class="two">' + field('projectId', 'Project', select('projectId', data.projects.map(p => [p.id, p.name]), m.projectId)) + field('target', 'Target date', input('target', m.target, 'date', 'required')) + '</div>' +
    '<label class="chk-line"><input type="checkbox" name="done"' + (m.done ? ' checked' : '') + '> Reached</label>',
    fd => {
      const next = { ...m, name: fd.get('name').trim(), projectId: fd.get('projectId'), target: fd.get('target'), done: fd.get('done') === 'on' };
      const errors = E.validateMilestone(next, proj(next.projectId)); if (Object.keys(errors).length) return errors;
      commit({ ...data, milestones: isNew ? [...data.milestones, next] : data.milestones.map(x => x.id === next.id ? next : x) }, isNew ? 'Milestone added.' : 'Milestone saved.');
    },
    isNew ? '' : '<button type="button" class="btn danger line" id="delMs">Delete</button>');
  const del = $('#delMs', dlg); if (del) del.addEventListener('click', () => { const linked = data.tasks.filter(t => t.milestoneId === m.id).length; confirmBox('Delete this milestone?', '"' + m.name + '" will be removed.' + (linked ? ' ' + linked + ' task(s) linked to it stay, without a milestone.' : ''), 'Delete milestone', () => commit(E.deleteMilestone(data, m.id), 'Milestone deleted.')); });
}

function taskForm(t, projectId) {
  const isNew = !t; t = t || { id: E.uid('t'), projectId: projectId || filters.tasks.project || (data.projects[0] || {}).id, title: '', owner: '', priority: 'Medium', status: 'To do', due: E.addDays(TODAY, 7), estimate: 2, deps: [], milestoneId: '' };
  const depChoices = pid => data.tasks.filter(x => x.projectId === pid && x.id !== t.id);
  const depsHtml = pid => { const list = depChoices(pid); return list.length ? list.map(x => '<label class="dep"><input type="checkbox" name="deps" value="' + esc(x.id) + '"' + (t.deps.includes(x.id) ? ' checked' : '') + '> <span>' + esc(x.title) + ' <small class="muted">' + esc(x.status) + '</small></span></label>').join('') : '<p class="muted small">No other task in this project yet.</p>'; };
  const msOpts = pid => opts(data.milestones.filter(m => m.projectId === pid).map(m => [m.id, m.name]), t.milestoneId, 'None');
  openForm(isNew ? 'New task' : 'Edit task',
    field('title', 'Title', input('title', t.title, 'text', 'maxlength="100" required autocomplete="off"')) +
    '<div class="two">' + field('projectId', 'Project', select('projectId', data.projects.map(p => [p.id, p.name]), t.projectId)) + field('owner', 'Owner', input('owner', t.owner, 'text', 'list="ownerList" maxlength="40" required autocomplete="off"')) + '</div>' + ownerList() +
    '<div class="three">' + field('priority', 'Priority', select('priority', E.PRIORITIES, t.priority)) + field('status', 'Status', select('status', E.TASK_STATUSES, t.status)) + field('estimate', 'Days of work', input('estimate', t.estimate, 'number', 'min="1" max="60" step="1" inputmode="numeric" required')) + '</div>' +
    '<div class="two">' + field('due', 'Due date', input('due', t.due, 'date', 'required')) + field('milestoneId', 'Milestone', '<select id="f-milestoneId" name="milestoneId">' + msOpts(t.projectId) + '</select>') + '</div>' +
    '<div class="fld" data-field="deps"><span class="lab" id="depsLab">Waits for</span><div class="deps" id="depsBox" role="group" aria-labelledby="depsLab">' + depsHtml(t.projectId) + '</div><small class="err" id="e-deps" hidden></small></div>',
    fd => {
      const next = { ...t, title: fd.get('title').trim(), projectId: fd.get('projectId'), owner: fd.get('owner').trim(), priority: fd.get('priority'), status: fd.get('status'), estimate: Number(fd.get('estimate')), due: fd.get('due'), milestoneId: fd.get('milestoneId') || '', deps: fd.getAll('deps') };
      const errors = E.validateTask(next, data); if (Object.keys(errors).length) return errors;
      commit({ ...data, tasks: isNew ? [...data.tasks, next] : data.tasks.map(x => x.id === next.id ? next : x) }, isNew ? 'Task created.' : 'Task saved.');
    },
    isNew ? '' : '<button type="button" class="btn danger line" id="delTask">Delete</button>');
  $('#f-projectId', dlg).addEventListener('change', e => { t = { ...t, deps: [], milestoneId: '' }; $('#depsBox', dlg).innerHTML = depsHtml(e.target.value); $('#f-milestoneId', dlg).innerHTML = msOpts(e.target.value); });
  const del = $('#delTask', dlg); if (del) del.addEventListener('click', () => { const n = E.dependents(data.tasks, t.id).length; confirmBox('Delete this task?', '"' + t.title + '" will be removed.' + (n ? ' ' + n + ' task(s) that wait for it will no longer wait for it.' : ''), 'Delete task', () => commit(E.deleteTask(data, t.id), 'Task deleted.')); });
}

function riskForm(r, projectId) {
  const isNew = !r; r = r || { id: E.uid('r'), projectId: projectId || filters.risks.project || (data.projects[0] || {}).id, title: '', impact: 3, probability: 3, owner: '', mitigation: '', status: 'Open' };
  const scale = [[1, '1 · Very low'], [2, '2 · Low'], [3, '3 · Medium'], [4, '4 · High'], [5, '5 · Very high']];
  openForm(isNew ? 'New risk' : 'Edit risk',
    field('title', 'What could go wrong', input('title', r.title, 'text', 'maxlength="120" required autocomplete="off"')) +
    '<div class="two">' + field('projectId', 'Project', select('projectId', data.projects.map(p => [p.id, p.name]), r.projectId)) + field('owner', 'Owner', input('owner', r.owner, 'text', 'list="ownerList" maxlength="40" autocomplete="off"')) + '</div>' + ownerList() +
    '<div class="three">' + field('impact', 'Impact', select('impact', scale, r.impact)) + field('probability', 'Probability', select('probability', scale, r.probability)) + field('status', 'Status', select('status', E.RISK_STATUSES, r.status)) + '</div>' +
    '<p class="score-live" id="scoreLive" aria-live="polite"></p>' +
    field('mitigation', 'Mitigation action', '<textarea id="f-mitigation" name="mitigation" rows="3" maxlength="400">' + esc(r.mitigation) + '</textarea>'),
    fd => {
      const next = { ...r, title: fd.get('title').trim(), projectId: fd.get('projectId'), owner: fd.get('owner').trim(), impact: Number(fd.get('impact')), probability: Number(fd.get('probability')), status: fd.get('status'), mitigation: fd.get('mitigation').trim() };
      const errors = E.validateRisk(next); if (Object.keys(errors).length) return errors;
      commit({ ...data, risks: isNew ? [...data.risks, next] : data.risks.map(x => x.id === next.id ? next : x) }, isNew ? 'Risk registered.' : 'Risk saved.');
    },
    isNew ? '' : '<button type="button" class="btn danger line" id="delRisk">Delete</button>');
  const live = () => { const s = Number($('#f-impact', dlg).value) * Number($('#f-probability', dlg).value); $('#scoreLive', dlg).innerHTML = 'Score <b class="score ' + riskClass(s) + '">' + s + '</b> ' + E.riskLevel(s); };
  $('#f-impact', dlg).addEventListener('change', live); $('#f-probability', dlg).addEventListener('change', live); live();
  const del = $('#delRisk', dlg); if (del) del.addEventListener('click', () => confirmBox('Delete this risk?', '"' + r.title + '" will be removed from the register.', 'Delete risk', () => commit({ ...data, risks: data.risks.filter(x => x.id !== r.id) }, 'Risk deleted.')));
}

// ---------- events ----------
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]'); if (!el || el.tagName === 'SELECT' || (el.tagName === 'INPUT' && el.type !== 'checkbox')) return;
  const act = el.dataset.act, id = el.dataset.id;
  if (act === 'toggle-ms') { const m = data.milestones.find(x => x.id === id); if (m) commit({ ...data, milestones: data.milestones.map(x => x.id === id ? { ...x, done: el.checked } : x) }, el.checked ? 'Milestone reached.' : 'Milestone reopened.'); return; }
  if (act === 'new-project') projectForm();
  else if (act === 'edit-project') projectForm(proj(id));
  else if (act === 'del-project') { const p = proj(id); const n = [E.projectMilestones(data, id).length, E.projectTasks(data, id).length, E.projectRisks(data, id).length]; confirmBox('Delete ' + p.name + '?', 'This also deletes its ' + n[0] + ' milestone(s), ' + n[1] + ' task(s) and ' + n[2] + ' risk(s). You can bring the sample data back with Reset demo.', 'Delete project', () => { commit(E.deleteProject(data, id), 'Project deleted.'); location.hash = '#/projects'; }); }
  else if (act === 'new-milestone') milestoneForm(null, el.dataset.project);
  else if (act === 'edit-milestone') milestoneForm(data.milestones.find(x => x.id === id));
  else if (act === 'new-task') taskForm(null, el.dataset.project);
  else if (act === 'edit-task') taskForm(data.tasks.find(x => x.id === id));
  else if (act === 'new-risk') riskForm(null, el.dataset.project);
  else if (act === 'edit-risk') riskForm(data.risks.find(x => x.id === id));
  else if (act === 'cell') { const c = [Number(el.dataset.i), Number(el.dataset.p)]; filters.risks.cell = filters.risks.cell && filters.risks.cell[0] === c[0] && filters.risks.cell[1] === c[1] ? null : c; render(); }
  else if (act === 'cell-clear') { filters.risks.cell = null; render(); }
  else if (act === 'print') window.print();
  else if (act === 'csv') downloadCsv();
  else if (act === 'copy-summary') { const txt = $('#sumText').textContent; (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(() => toast('Status summary copied.'), () => toast('Copy is not allowed here. Select the text instead.', 'error')); }
  else if (act === 'reset') resetDemo();
});
document.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('g.node')) { e.preventDefault(); taskForm(data.tasks.find(x => x.id === e.target.dataset.id)); } });
document.addEventListener('change', e => {
  const el = e.target;
  if (el.dataset.act === 'task-status') {
    const t = data.tasks.find(x => x.id === el.dataset.id); const next = { ...t, status: el.value };
    const errors = E.validateTask(next, data);
    if (errors.status) { toast(errors.status, 'error'); el.value = t.status; return; }
    commit({ ...data, tasks: data.tasks.map(x => x.id === t.id ? next : x) }, 'Status changed to ' + el.value + '.');
    return;
  }
  if (el.dataset.filter && el.tagName !== 'INPUT' || (el.dataset.filter && el.type === 'checkbox')) setFilter(el);
});
let searchTimer;
document.addEventListener('input', e => { const el = e.target; if (el.dataset.filter && el.type === 'search') { clearTimeout(searchTimer); searchTimer = setTimeout(() => { setFilter(el); const again = document.querySelector('[data-filter="' + el.dataset.filter + '"]'); if (again) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); } }, 180); } });
function setFilter(el) {
  const [group, key] = el.dataset.filter.split('.');
  filters[group][key] = el.type === 'checkbox' ? el.checked : el.value;
  if (group === 'risks') filters.risks.cell = filters.risks.cell && key !== 'cell' ? filters.risks.cell : null;
  if (group === 'tasks' && key === 'project' && route().params.get('p') !== null) { history.replaceState(null, '', '#/tasks'); }
  render();
  const again = document.querySelector('[data-filter="' + el.dataset.filter + '"]'); if (again && el.type !== 'search') again.focus();
}
function resetDemo() { confirmBox('Reset the demo?', 'Your changes in this browser are replaced by the original sample data.', 'Reset demo', () => { data = seed(TODAY); save(); toast('Sample data restored.'); if (!route().name || route().name === 'project') location.hash = '#/dashboard'; render(); }); }
$('#resetDemo').addEventListener('click', resetDemo);
$('#enterDemo').addEventListener('click', e => { e.preventDefault(); if (location.hash !== '#/dashboard') location.hash = '#/dashboard'; else { $('#app').scrollIntoView({ behavior: 'smooth', block: 'start' }); } });
$('#startEmpty').addEventListener('click', () => confirmBox('Start with an empty workspace?', 'All projects, milestones, tasks and risks in this browser are removed. Reset demo brings the sample data back.', 'Empty the workspace', () => { data = { version: 1, projects: [], milestones: [], tasks: [], risks: [] }; save(); location.hash = '#/dashboard'; render(); toast('The workspace is empty.'); }));
window.addEventListener('hashchange', render);
window.addEventListener('storage', e => { if (e.key === KEY) { data = load(); render(); } });

if (!location.hash) history.replaceState(null, '', '#/dashboard');
lastRoute = '';
render();
if (startNotice) toast(startNotice, 'error');

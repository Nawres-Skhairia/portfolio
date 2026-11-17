// Command Center engine: pure functions, no screen code. Every number on screen comes from here.
// Dates are ISO strings (YYYY-MM-DD). "today" is always passed in, so tests can fix it.

export const PROJECT_STATUSES = ['Planned', 'Active', 'On hold', 'Completed'];
export const TASK_STATUSES = ['To do', 'In progress', 'Blocked', 'Done'];
export const PRIORITIES = ['Low', 'Medium', 'High', 'Critical'];
export const RISK_STATUSES = ['Open', 'Mitigating', 'Closed'];

const DAY = 86400000;
export function toDate(iso) { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d); }
export function isoOf(ms) { return new Date(ms).toISOString().slice(0, 10); }
export function addDays(iso, n) { return isoOf(toDate(iso) + n * DAY); }
export function daysBetween(a, b) { return Math.round((toDate(b) - toDate(a)) / DAY); }
export function isIso(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && isoOf(toDate(s)) === s; }

export function uid(prefix) {
  const r = (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  return prefix + '-' + r;
}

// ---------- validation (every write goes through these) ----------
function req(errors, field, value, label) { if (value === undefined || value === null || String(value).trim() === '') errors[field] = label + ' is required.'; }
function maxLen(errors, field, value, n, label) { if (value && String(value).length > n) errors[field] = label + ' must be ' + n + ' characters or fewer.'; }

export function validateProject(p, all = []) {
  const e = {};
  req(e, 'name', p.name, 'Name'); maxLen(e, 'name', p.name, 60, 'Name');
  req(e, 'owner', p.owner, 'Owner'); maxLen(e, 'owner', p.owner, 40, 'Owner');
  maxLen(e, 'objective', p.objective, 240, 'Objective');
  maxLen(e, 'description', p.description, 1000, 'Description');
  if (!isIso(p.start)) e.start = 'Start date is required.';
  if (!isIso(p.deadline)) e.deadline = 'Deadline is required.';
  else if (isIso(p.start) && p.deadline < p.start) e.deadline = 'Deadline must be on or after the start date.';
  if (!PROJECT_STATUSES.includes(p.status)) e.status = 'Choose a status.';
  if (!PRIORITIES.includes(p.priority)) e.priority = 'Choose a priority.';
  if (p.name && all.some(o => o.id !== p.id && o.name.trim().toLowerCase() === p.name.trim().toLowerCase())) e.name = 'Another project already has this name.';
  return e;
}

export function validateMilestone(m, project) {
  const e = {};
  req(e, 'name', m.name, 'Name'); maxLen(e, 'name', m.name, 80, 'Name');
  if (!m.projectId) e.projectId = 'Choose a project.';
  if (!isIso(m.target)) e.target = 'Target date is required.';
  else if (project && m.target < project.start) e.target = 'Target date is before the project starts (' + project.start + ').';
  return e;
}

export function validateTask(t, data) {
  const e = {};
  req(e, 'title', t.title, 'Title'); maxLen(e, 'title', t.title, 100, 'Title');
  req(e, 'owner', t.owner, 'Owner'); maxLen(e, 'owner', t.owner, 40, 'Owner');
  if (!t.projectId) e.projectId = 'Choose a project.';
  if (!isIso(t.due)) e.due = 'Due date is required.';
  if (!PRIORITIES.includes(t.priority)) e.priority = 'Choose a priority.';
  if (!TASK_STATUSES.includes(t.status)) e.status = 'Choose a status.';
  const est = Number(t.estimate);
  if (!Number.isInteger(est) || est < 1 || est > 60) e.estimate = 'Estimate must be a whole number of days from 1 to 60.';
  const deps = t.deps || [];
  if (deps.includes(t.id)) e.deps = 'A task cannot depend on itself.';
  else if (data) {
    for (const d of deps) {
      const other = data.tasks.find(x => x.id === d);
      if (!other) { e.deps = 'A chosen dependency no longer exists.'; break; }
      if (other.projectId !== t.projectId) { e.deps = 'Dependencies must be in the same project.'; break; }
    }
    if (!e.deps) {
      const loop = findCycle(data.tasks.filter(x => x.id !== t.id).concat([{ ...t, deps }]));
      if (loop) e.deps = 'This would create a loop: ' + loop.map(id => (data.tasks.find(x => x.id === id) || t).title).join(' → ') + '.';
    }
  }
  if (t.status === 'Done' && data && deps.some(d => { const o = data.tasks.find(x => x.id === d); return o && o.status !== 'Done'; })) e.status = 'This task waits for a task that is not done yet.';
  return e;
}

export function validateRisk(r) {
  const e = {};
  req(e, 'title', r.title, 'Title'); maxLen(e, 'title', r.title, 120, 'Title');
  if (!r.projectId) e.projectId = 'Choose a project.';
  const i = Number(r.impact), p = Number(r.probability);
  if (!(i >= 1 && i <= 5 && Number.isInteger(i))) e.impact = 'Impact must be from 1 to 5.';
  if (!(p >= 1 && p <= 5 && Number.isInteger(p))) e.probability = 'Probability must be from 1 to 5.';
  if (!RISK_STATUSES.includes(r.status)) e.status = 'Choose a status.';
  maxLen(e, 'mitigation', r.mitigation, 400, 'Mitigation');
  maxLen(e, 'owner', r.owner, 40, 'Owner');
  return e;
}

// ---------- dependencies ----------
// Returns the ids of a loop (first id repeated at the end), or null.
export function findCycle(tasks) {
  const byId = new Map(tasks.map(t => [t.id, t]));
  const state = new Map(); const stack = [];
  function visit(id) {
    state.set(id, 1); stack.push(id);
    for (const d of (byId.get(id)?.deps || [])) {
      if (!byId.has(d)) continue;
      if (state.get(d) === 1) return stack.slice(stack.indexOf(d)).concat([d]);
      if (!state.get(d)) { const r = visit(d); if (r) return r; }
    }
    state.set(id, 2); stack.pop(); return null;
  }
  for (const t of tasks) if (!state.get(t.id)) { const r = visit(t.id); if (r) return r; }
  return null;
}

export function dependents(tasks, id) { return tasks.filter(t => (t.deps || []).includes(id)); }

// All tasks that (directly or not) wait for this one.
export function downstream(tasks, id) {
  const out = new Set(); const queue = [id];
  while (queue.length) { const cur = queue.shift(); for (const t of dependents(tasks, cur)) if (!out.has(t.id)) { out.add(t.id); queue.push(t.id); } }
  return [...out];
}

// A task is waiting when at least one task it depends on is not done.
export function isWaiting(task, tasks) {
  return (task.deps || []).some(d => { const o = tasks.find(x => x.id === d); return o && o.status !== 'Done'; });
}

export function isTaskOverdue(t, today) { return t.status !== 'Done' && t.due < today; }

// Depth of each task in the dependency network (0 = depends on nothing).
export function levels(tasks) {
  const byId = new Map(tasks.map(t => [t.id, t])); const memo = new Map();
  function lv(id, seen = new Set()) {
    if (memo.has(id)) return memo.get(id);
    if (seen.has(id)) return 0; seen.add(id);
    const deps = (byId.get(id)?.deps || []).filter(d => byId.has(d));
    const v = deps.length ? 1 + Math.max(...deps.map(d => lv(d, seen))) : 0;
    memo.set(id, v); return v;
  }
  const out = {}; for (const t of tasks) out[t.id] = lv(t.id); return out;
}

// Critical path: the longest chain of unfinished work (sum of estimates). Returns ids in order and total days.
export function criticalPath(tasks) {
  const open = tasks.filter(t => t.status !== 'Done');
  const byId = new Map(open.map(t => [t.id, t])); const memo = new Map();
  function best(id) {
    if (memo.has(id)) return memo.get(id);
    const t = byId.get(id); let top = { len: 0, path: [] };
    for (const d of (t.deps || [])) if (byId.has(d)) { const r = best(d); if (r.len > top.len) top = r; }
    const res = { len: top.len + Number(t.estimate || 0), path: top.path.concat([id]) };
    memo.set(id, res); return res;
  }
  let winner = { len: 0, path: [] };
  for (const t of open) { const r = best(t.id); if (r.len > winner.len) winner = r; }
  return { ids: winner.path, days: winner.len };
}

// ---------- project figures ----------
export function projectTasks(data, pid) { return data.tasks.filter(t => t.projectId === pid); }
export function projectMilestones(data, pid) { return data.milestones.filter(m => m.projectId === pid).sort((a, b) => a.target.localeCompare(b.target)); }
export function projectRisks(data, pid) { return data.risks.filter(r => r.projectId === pid); }

export function riskScore(r) { return Number(r.impact) * Number(r.probability); }
export function riskLevel(score) { return score >= 15 ? 'Critical' : score >= 10 ? 'High' : score >= 5 ? 'Medium' : 'Low'; }

// Progress = finished work / all work, weighted by estimate in days.
export function progress(tasks) {
  const total = tasks.reduce((s, t) => s + Number(t.estimate || 0), 0);
  if (!total) return 0;
  const done = tasks.filter(t => t.status === 'Done').reduce((s, t) => s + Number(t.estimate || 0), 0);
  return done / total;
}

// Expected progress if work were spread evenly from start to deadline.
export function expectedProgress(project, today) {
  const span = daysBetween(project.start, project.deadline);
  if (span <= 0) return today >= project.deadline ? 1 : 0;
  return Math.min(1, Math.max(0, daysBetween(project.start, today) / span));
}

export function isMilestoneOverdue(m, today) { return !m.done && m.target < today; }

export function health(data, project, today) {
  const tasks = projectTasks(data, project.id);
  const ms = projectMilestones(data, project.id);
  const risks = projectRisks(data, project.id).filter(r => r.status !== 'Closed');
  const prog = progress(tasks);
  const expected = project.status === 'Planned' ? 0 : expectedProgress(project, today);
  const lag = Math.max(0, expected - prog);
  const overdueMs = ms.filter(m => isMilestoneOverdue(m, today));
  const blocked = tasks.filter(t => t.status !== 'Done' && (t.status === 'Blocked' || (isWaiting(t, tasks) && isTaskOverdue(t, today))));
  const highRisks = risks.filter(r => riskScore(r) >= 10);
  const midRisks = risks.filter(r => riskScore(r) >= 5 && riskScore(r) < 10);
  const pastDeadline = project.status !== 'Completed' && project.deadline < today;
  const penalties = {
    schedule: Math.min(40, Math.round(lag * 100)),
    milestones: Math.min(20, overdueMs.length * 10),
    risks: Math.min(25, highRisks.length * 8 + midRisks.length * 3),
    blockers: Math.min(15, blocked.length * 5),
  };
  if (pastDeadline) penalties.schedule = 40;
  const score = project.status === 'Completed' ? 100 : Math.max(0, 100 - penalties.schedule - penalties.milestones - penalties.risks - penalties.blockers);
  const label = project.status === 'Completed' ? 'Delivered' : project.status === 'Planned' ? 'Not started' : score >= 75 ? 'On track' : score >= 50 ? 'At risk' : 'Critical';
  return {
    score, label, progress: prog, expected, lag, penalties, pastDeadline,
    overdueMilestones: overdueMs, blocked, highRisks, openRisks: risks,
    delayed: project.status !== 'Completed' && (pastDeadline || overdueMs.length > 0),
    exposure: risks.reduce((s, r) => s + riskScore(r), 0),
  };
}

export function portfolioSummary(data, today) {
  const ps = data.projects;
  const hs = ps.map(p => ({ project: p, h: health(data, p, today) }));
  const upcoming = data.milestones.filter(m => !m.done && m.target >= today && m.target <= addDays(today, 30)).sort((a, b) => a.target.localeCompare(b.target));
  const topRisks = data.risks.filter(r => r.status !== 'Closed').sort((a, b) => riskScore(b) - riskScore(a) || a.title.localeCompare(b.title)).slice(0, 5);
  return {
    total: ps.length,
    active: ps.filter(p => p.status === 'Active').length,
    completed: ps.filter(p => p.status === 'Completed').length,
    delayed: hs.filter(x => x.h.delayed).length,
    onHold: ps.filter(p => p.status === 'On hold').length,
    health: hs, upcoming, topRisks,
    openTasks: data.tasks.filter(t => t.status !== 'Done').length,
    overdueTasks: data.tasks.filter(t => isTaskOverdue(t, today)).length,
  };
}

// ---------- insights: rules over real records, each with its evidence ----------
export function insights(data, today) {
  const out = [];
  const name = pid => (data.projects.find(p => p.id === pid) || {}).name || 'Unknown project';
  for (const p of data.projects) {
    if (p.status === 'Completed') continue;
    const h = health(data, p, today);
    const tasks = projectTasks(data, p.id);
    if (p.status === 'Active' && h.lag >= 0.15) {
      const cp = criticalPath(tasks);
      out.push({ level: 'high', kind: 'schedule', project: p.id,
        title: p.name + ' is behind plan',
        text: Math.round(h.progress * 100) + '% of the work is done, while ' + Math.round(h.expected * 100) + '% was expected by today. ' +
          (cp.ids.length ? 'Focus on the critical path first: ' + cp.ids.map(id => tasks.find(t => t.id === id).title).join(' → ') + ' (' + cp.days + ' days of work left on that chain).' : ''),
        action: 'Re-plan the deadline (' + p.deadline + ') or move capacity to the critical path.',
        evidence: [{ type: 'project', id: p.id }] });
    }
    if (h.pastDeadline) out.push({ level: 'high', kind: 'deadline', project: p.id, title: p.name + ' has passed its deadline',
      text: 'The deadline was ' + p.deadline + ' (' + daysBetween(p.deadline, today) + ' days ago) and the project is not completed.',
      action: 'Agree a new date with the owner, ' + p.owner + ', and record it.', evidence: [{ type: 'project', id: p.id }] });
    for (const m of h.overdueMilestones) out.push({ level: 'high', kind: 'milestone', project: p.id, title: 'Milestone overdue: ' + m.name,
      text: name(p.id) + ' · target was ' + m.target + ', ' + daysBetween(m.target, today) + ' days ago.',
      action: 'Close it if it is done, or move the target date and tell the people who depend on it.', evidence: [{ type: 'milestone', id: m.id }] });
    // blocking tasks: unfinished, others wait for them, and they are late or blocked
    for (const t of tasks) {
      if (t.status === 'Done') continue;
      const waiting = downstream(tasks, t.id);
      if (waiting.length >= 2 && (isTaskOverdue(t, today) || t.status === 'Blocked')) out.push({ level: 'high', kind: 'blocker', project: p.id,
        title: 'Unblock "' + t.title + '" first',
        text: waiting.length + ' tasks in ' + p.name + ' wait for it, and it is ' + (t.status === 'Blocked' ? 'marked Blocked' : 'overdue since ' + t.due) + '. Owner: ' + t.owner + '.',
        action: 'Resolve what stops it, or split it so the waiting tasks can start.', evidence: [{ type: 'task', id: t.id }].concat(waiting.map(id => ({ type: 'task', id }))) });
    }
  }
  for (const r of data.risks) {
    if (r.status === 'Closed') continue;
    const s = riskScore(r);
    if (s >= 10 && !String(r.mitigation || '').trim()) out.push({ level: 'high', kind: 'risk', project: r.projectId, title: 'High risk without a mitigation: ' + r.title,
      text: name(r.projectId) + ' · score ' + s + ' (impact ' + r.impact + ' × probability ' + r.probability + ').', action: 'Write a mitigation action and give it an owner.', evidence: [{ type: 'risk', id: r.id }] });
    else if (s >= 15) out.push({ level: 'medium', kind: 'risk', project: r.projectId, title: 'Critical risk still open: ' + r.title,
      text: name(r.projectId) + ' · score ' + s + '. Mitigation: ' + r.mitigation, action: 'Check progress on the mitigation with ' + (r.owner || 'its owner') + '.', evidence: [{ type: 'risk', id: r.id }] });
  }
  // workload: owners with more than 3 open tasks due within 7 days
  const soon = data.tasks.filter(t => t.status !== 'Done' && t.due >= today && t.due <= addDays(today, 7));
  const byOwner = {};
  for (const t of soon) (byOwner[t.owner] = byOwner[t.owner] || []).push(t);
  for (const [owner, list] of Object.entries(byOwner)) if (list.length > 3) out.push({ level: 'medium', kind: 'workload', title: owner + ' has ' + list.length + ' tasks due this week',
    text: 'Across ' + [...new Set(list.map(t => name(t.projectId)))].join(', ') + '.', action: 'Move one or two to someone with capacity, or re-date the lowest priority ones.',
    evidence: list.map(t => ({ type: 'task', id: t.id })) });
  const overdueTasks = data.tasks.filter(t => isTaskOverdue(t, today));
  if (overdueTasks.length) out.push({ level: 'medium', kind: 'overdue', title: overdueTasks.length + ' overdue task' + (overdueTasks.length > 1 ? 's' : ''),
    text: overdueTasks.slice(0, 4).map(t => t.title + ' (' + name(t.projectId) + ', due ' + t.due + ')').join('; ') + (overdueTasks.length > 4 ? '; and more.' : '.'),
    action: 'Update their status or due date so the plan stays true.', evidence: overdueTasks.map(t => ({ type: 'task', id: t.id })) });
  const rank = { high: 0, medium: 1, low: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}

export function statusSummary(data, project, today) {
  const h = health(data, project, today);
  const tasks = projectTasks(data, project.id);
  const ms = projectMilestones(data, project.id);
  const next = ms.find(m => !m.done);
  const parts = [];
  parts.push(project.name + ' is ' + h.label.toLowerCase() + ' (health ' + h.score + '/100).');
  if (project.status === 'Completed') return parts.join(' ');
  parts.push(Math.round(h.progress * 100) + '% of the work is done (' + tasks.filter(t => t.status === 'Done').length + ' of ' + tasks.length + ' tasks); ' + Math.round(h.expected * 100) + '% was expected by today.');
  if (next) parts.push('Next milestone: ' + next.name + ' on ' + next.target + (isMilestoneOverdue(next, today) ? ' (overdue).' : '.'));
  if (h.openRisks.length) parts.push(h.openRisks.length + ' open risk' + (h.openRisks.length > 1 ? 's' : '') + ', ' + h.highRisks.length + ' high or critical.');
  if (h.blocked.length) parts.push(h.blocked.length + ' task' + (h.blocked.length > 1 ? 's are' : ' is') + ' blocked.');
  return parts.join(' ');
}

// ---------- export ----------
// CSV with protection against spreadsheet formula injection.
export function csvCell(v) {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
export function toCsv(rows) { return rows.map(r => r.map(csvCell).join(',')).join('\r\n'); }

// ---------- deletion (explicit cascade rules) ----------
export function deleteProject(data, id) {
  return { ...data,
    projects: data.projects.filter(p => p.id !== id),
    milestones: data.milestones.filter(m => m.projectId !== id),
    tasks: data.tasks.filter(t => t.projectId !== id),
    risks: data.risks.filter(r => r.projectId !== id) };
}
export function deleteTask(data, id) {
  return { ...data, tasks: data.tasks.filter(t => t.id !== id).map(t => (t.deps || []).includes(id) ? { ...t, deps: t.deps.filter(d => d !== id) } : t) };
}
export function deleteMilestone(data, id) {
  return { ...data, milestones: data.milestones.filter(m => m.id !== id), tasks: data.tasks.map(t => t.milestoneId === id ? { ...t, milestoneId: '' } : t) };
}

// Shape check for data read back from the browser.
export function isValidData(d) {
  return d && Array.isArray(d.projects) && Array.isArray(d.milestones) && Array.isArray(d.tasks) && Array.isArray(d.risks) &&
    d.projects.every(p => p && typeof p.id === 'string' && typeof p.name === 'string' && isIso(p.start) && isIso(p.deadline)) &&
    d.tasks.every(t => t && typeof t.id === 'string' && Array.isArray(t.deps) && isIso(t.due)) &&
    d.milestones.every(m => m && typeof m.id === 'string' && isIso(m.target)) &&
    d.risks.every(r => r && typeof r.id === 'string');
}

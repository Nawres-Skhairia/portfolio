// Command Center server rules: every change sent by the browser is checked here with the same
// rules as the browser (engine.js) before anything is written. Pure functions, no database.
import * as E from '../../projects/command-center/engine.js';

export const TYPES = ['project', 'milestone', 'task', 'risk'];
const LIST = { project: 'projects', milestone: 'milestones', task: 'tasks', risk: 'risks' };
// Only these fields are kept; anything else the browser sends is dropped.
const FIELDS = {
  project: ['id', 'code', 'name', 'owner', 'objective', 'description', 'start', 'deadline', 'status', 'priority', 'archivedAt'],
  milestone: ['id', 'projectId', 'name', 'target', 'done'],
  task: ['id', 'key', 'projectId', 'title', 'owner', 'priority', 'status', 'due', 'estimate', 'labels', 'deps', 'milestoneId', 'holdReason', 'heldFrom', 'remindOn', 'rank', 'comments', 'checklist', 'archivedAt'],
  risk: ['id', 'projectId', 'title', 'impact', 'probability', 'status', 'mitigation', 'owner'],
};
export const LIMITS = { ops: 2000, projects: 100, tasks: 3000, milestones: 1000, risks: 1000, comments: 200, filters: 20, docBytes: 64 * 1024 };
const ID = /^[A-Za-z0-9_-]{1,48}$/;
const TRACKED = { title: 'Title', owner: 'Assignee', priority: 'Priority', status: 'Status', due: 'Due date', estimate: 'Estimate', labels: 'Labels', milestoneId: 'Milestone', deps: 'Waits for', holdReason: 'Hold reason', checklist: 'Checklist', archivedAt: 'Archived' };

export const emptyData = () => ({ projects: [], milestones: [], tasks: [], risks: [], filters: [] });

function pick(type, doc) {
  const o = {};
  for (const k of FIELDS[type]) if (doc[k] !== undefined) o[k] = doc[k];
  return o;
}
const str = (v, n) => typeof v === 'string' && v.length <= n;

// Light shape check of one entity before the engine rules (types the engine assumes).
function shapeError(type, d) {
  if (!ID.test(d.id || '')) return 'An id is not valid.';
  if (d.archivedAt !== undefined && !(d.archivedAt === '' || (typeof d.archivedAt === 'string' && E.isIso(d.archivedAt)))) return 'An archive date is not valid.';
  if (type !== 'project' && !ID.test(d.projectId || '')) return 'A project reference is not valid.';
  if (type === 'project') { for (const k of ['code', 'name', 'owner', 'start', 'deadline', 'status', 'priority']) if (!str(d[k], 1000)) return 'Project ' + k + ' is missing.'; if (d.objective !== undefined && !str(d.objective, 240)) return 'Objective is not valid.'; if (d.description !== undefined && !str(d.description, 1000)) return 'Description is not valid.'; }
  if (type === 'milestone') { if (!str(d.name, 80) || !str(d.target, 10)) return 'A milestone is not valid.'; if (d.done !== undefined && typeof d.done !== 'boolean') return 'A milestone is not valid.'; }
  if (type === 'task') {
    for (const k of ['key', 'title', 'owner', 'priority', 'status', 'due']) if (!str(d[k], 200)) return 'Task ' + k + ' is missing.';
    if (!/^[A-Z]{2,5}-\d{1,6}$/.test(d.key)) return 'A task key is not valid.';
    if (!Array.isArray(d.labels || []) || !Array.isArray(d.deps || []) || !Array.isArray(d.comments || [])) return 'A task is not valid.';
    if ((d.deps || []).some(x => !ID.test(x)) || (d.deps || []).length > 50) return 'A dependency is not valid.';
    if (d.rank !== undefined && !Number.isFinite(d.rank)) return 'A task position is not valid.';
    for (const k of ['milestoneId', 'holdReason', 'heldFrom']) if (d[k] !== undefined && !str(d[k], 200)) return 'A task is not valid.';
    if (d.milestoneId && !ID.test(d.milestoneId)) return 'A milestone reference is not valid.';
    if (d.heldFrom && !E.TASK_STATUSES.includes(d.heldFrom)) return 'A task is not valid.';
    if (d.remindOn !== undefined && d.remindOn !== '' && !(typeof d.remindOn === 'string' && E.isIso(d.remindOn))) return 'A reminder date is not valid.';
    if (d.checklist !== undefined && (!Array.isArray(d.checklist) || d.checklist.length > 30)) return 'A checklist is not valid.';
  }
  if (type === 'risk') { if (!str(d.title, 120) || !str(d.status, 20)) return 'A risk is not valid.'; if (d.owner !== undefined && !str(d.owner, 40)) return 'A risk is not valid.'; if (d.mitigation !== undefined && !str(d.mitigation, 400)) return 'A risk is not valid.'; }
  return '';
}

function cleanChecklist(doc) { if (doc.checklist !== undefined) doc.checklist = doc.checklist.map(c => ({ id: c && c.id, text: String((c && c.text) || ''), done: !!(c && c.done) })); }

function validComment(c) { return c && ID.test(c.id || '') && str(c.text, 1000) && c.text.trim() && str(c.by, 60) && str(c.at, 40); }

// Check comments: earlier ones may not be changed or removed; new ones get the signed-in name and the server time.
function mergeComments(oldT, newT, actor, at) {
  const before = (oldT && oldT.comments) || [];
  const after = Array.isArray(newT.comments) ? newT.comments : [];
  if (after.length > LIMITS.comments) return { error: 'Up to ' + LIMITS.comments + ' comments per task.' };
  for (let i = 0; i < before.length; i++) {
    const a = before[i], b = after[i];
    if (!b || b.id !== a.id || b.text !== a.text) return { error: 'Comments cannot be changed or removed.' };
  }
  const added = after.slice(before.length).map(c => ({ id: c && c.id, text: String((c && c.text) || '').trim(), by: actor, at }));
  if (added.some(c => !validComment(c))) return { error: 'A comment is empty, too long or not valid.' };
  return { comments: [...before, ...added] };
}

// Every entity checked against the whole workspace, as the browser does.
export function validateAll(data) {
  if (!E.isValidData({ ...data, tasks: data.tasks.map(t => ({ ...t, deps: t.deps || [] })) })) return 'The workspace has a missing or broken field.';
  for (const k of ['projects', 'tasks', 'milestones', 'risks']) if (data[k].length > LIMITS[k]) return 'Too many ' + k + ' (limit ' + LIMITS[k] + ').';
  const pids = new Set(data.projects.map(p => p.id));
  for (const k of ['projects', 'milestones', 'tasks', 'risks']) { const ids = data[k].map(x => x.id); if (new Set(ids).size !== ids.length) return 'Two ' + k + ' share the same id.'; }
  const keys = data.tasks.map(t => t.key); if (new Set(keys).size !== keys.length) return 'Two tasks share the same key.';
  for (const p of data.projects) { const e = E.validateProject(p, data.projects); if (Object.keys(e).length) return 'Project "' + p.name + '": ' + Object.values(e)[0]; }
  for (const m of data.milestones) { if (!pids.has(m.projectId)) return 'A milestone belongs to a project that does not exist.'; const e = E.validateMilestone(m, data.projects.find(p => p.id === m.projectId)); if (Object.keys(e).length) return 'Milestone "' + m.name + '": ' + Object.values(e)[0]; }
  for (const t of data.tasks) {
    if (!pids.has(t.projectId)) return 'A task belongs to a project that does not exist.';
    const p = data.projects.find(x => x.id === t.projectId);
    if (!t.key.startsWith(p.code + '-')) return 'Task ' + t.key + ' does not match its project key.';
    if (t.milestoneId && !data.milestones.some(m => m.id === t.milestoneId && m.projectId === t.projectId)) return 'Task ' + t.key + ' points to a milestone that does not exist.';
    const e = E.validateTask(t, data); if (Object.keys(e).length) return 'Task ' + t.key + ': ' + Object.values(e)[0];
  }
  for (const r of data.risks) { if (!pids.has(r.projectId)) return 'A risk belongs to a project that does not exist.'; const e = E.validateRisk(r); if (Object.keys(e).length) return 'Risk "' + r.title + '": ' + Object.values(e)[0]; }
  const loop = E.findCycle(data.tasks); if (loop) return 'The dependencies contain a loop.';
  return validateFilters(data.filters || []);
}

export function validateFilters(filters) {
  if (!Array.isArray(filters) || filters.length > LIMITS.filters) return 'Up to ' + LIMITS.filters + ' saved filters.';
  const seen = [];
  for (const f of filters) {
    if (!f || !ID.test(f.id || '') || typeof f.query !== 'object' || f.query === null || JSON.stringify(f.query).length > 2000) return 'A saved filter is not valid.';
    const err = E.validateFilterName(f.name, seen); if (err) return 'Saved filter: ' + err;
    seen.push(f);
  }
  return '';
}

// Apply the browser's changes to the current workspace. Returns { data, error, events, touched }.
// events: activity lines to write (task changes and deletions), touched: entities to write.
export function applyOps(current, ops, actor, at) {
  if (!Array.isArray(ops) || ops.length > LIMITS.ops) return { error: 'Too many changes at once.' };
  const data = { projects: [...current.projects], milestones: [...current.milestones], tasks: [...current.tasks], risks: [...current.risks], filters: current.filters || [] };
  const events = []; const touched = [];
  for (const op of ops) {
    if (!op || typeof op !== 'object') return { error: 'A change is not valid.' };
    if (op.type === 'filters') { data.filters = Array.isArray(op.filters) ? op.filters.map(f => ({ id: f && f.id, name: String((f && f.name) || '').trim(), query: f && f.query })) : null; touched.push({ type: 'filters' }); continue; }
    if (!TYPES.includes(op.type) || !ID.test(op.id || '') || !['put', 'del'].includes(op.op)) return { error: 'A change is not valid.' };
    const list = data[LIST[op.type]]; const i = list.findIndex(x => x.id === op.id); const old = i === -1 ? null : list[i];
    if (op.op === 'del') {
      if (!old) continue;
      list.splice(i, 1); touched.push({ type: op.type, id: op.id, op: 'del' });
      events.push({ entity: op.type, entityId: op.id, field: 'Deleted', from: old.key || old.name || old.title || '', to: '' });
      continue;
    }
    const raw = op.doc;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || JSON.stringify(raw).length > LIMITS.docBytes) return { error: 'A change is too large or not valid.' };
    const doc = pick(op.type, raw);
    if (doc.id !== op.id) return { error: 'A change is not valid.' };
    const se = shapeError(op.type, doc); if (se) return { error: se };
    if (op.type === 'task') {
      doc.labels = doc.labels || []; doc.deps = doc.deps || []; cleanChecklist(doc);
      const mc = mergeComments(old, doc, actor, at); if (mc.error) return { error: mc.error };
      doc.comments = mc.comments;
      if (old && old.projectId !== doc.projectId) return { error: 'A task cannot move to another project.' };
      if (!old) events.push({ entity: 'task', entityId: doc.id, field: 'Created', from: '', to: doc.key });
      else for (const k of Object.keys(TRACKED)) if (JSON.stringify(old[k] ?? '') !== JSON.stringify(doc[k] ?? '')) events.push({ entity: 'task', entityId: doc.id, field: TRACKED[k], from: fmt(k, old[k], current), to: fmt(k, doc[k], data) });
    }
    if (op.type !== 'project' && old && old.projectId !== doc.projectId) return { error: 'An item cannot move to another project.' };
    if (old) list[i] = doc; else list.push(doc);
    touched.push({ type: op.type, id: op.id, op: 'put' });
  }
  const error = validateAll(data);
  if (error) return { error };
  return { data, events, touched };
}

function fmt(k, v, data) {
  if (k === 'labels') return (v || []).join(', ') || 'none';
  if (k === 'checklist') return E.checklistText(v);
  if (k === 'deps') return (v || []).map(d => (data.tasks.find(x => x.id === d) || {}).key || '?').join(', ') || 'none';
  if (k === 'milestoneId') return (data.milestones.find(m => m.id === v) || {}).name || 'none';
  return v === '' || v === undefined || v === null ? 'none' : String(v);
}

// A workspace sent from a browser to be copied into an account: whole-shape check, then every rule.
export function checkImport(d) {
  if (!d || typeof d !== 'object') return { error: 'The workspace is empty or not valid.' };
  const out = emptyData();
  for (const type of TYPES) {
    const src = d[LIST[type]];
    if (!Array.isArray(src)) return { error: 'The workspace is missing its ' + LIST[type] + '.' };
    if (src.length > LIMITS[LIST[type]]) return { error: 'Too many ' + LIST[type] + ' (limit ' + LIMITS[LIST[type]] + ').' };
    for (const raw of src) {
      if (!raw || typeof raw !== 'object') return { error: 'The workspace has a broken item.' };
      const doc = pick(type, raw);
      const se = shapeError(type, doc); if (se) return { error: se };
      if (type === 'task') { doc.labels = doc.labels || []; doc.deps = doc.deps || []; cleanChecklist(doc); doc.comments = (doc.comments || []).map(c => ({ id: c && c.id, text: String((c && c.text) || ''), by: String((c && c.by) || ''), at: String((c && c.at) || '') })); if (doc.comments.some(c => !validComment(c))) return { error: 'Task ' + doc.key + ' has a comment that is not valid.' }; }
      out[LIST[type]].push(doc);
    }
  }
  out.filters = Array.isArray(d.filters) ? d.filters.map(f => ({ id: f && f.id, name: String((f && f.name) || '').trim(), query: f && f.query })) : [];
  const error = validateAll(out);
  if (error) return { error };
  // History lines travel with the workspace and are kept, marked as copied.
  const history = [];
  for (const t of d.tasks) for (const h of (Array.isArray(t.history) ? t.history.slice(0, 500) : [])) {
    if (!h || !str(h.field, 40) || !str(String(h.by ?? ''), 60) || !str(String(h.at ?? ''), 40)) continue;
    history.push({ entity: 'task', entityId: t.id, field: h.field, from: String(h.from ?? '').slice(0, 300), to: String(h.to ?? '').slice(0, 300), by: String(h.by ?? ''), at: String(h.at ?? '') });
  }
  return { data: out, history };
}

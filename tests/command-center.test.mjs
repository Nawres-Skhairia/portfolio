// Command Center: unit tests for every rule and figure. Run: node --test tests/command-center.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
const E = await import(new URL('../projects/command-center/engine.js', import.meta.url));
const { seed } = await import(new URL('../projects/command-center/seed.js', import.meta.url));
const TODAY = '2026-11-17';
const data = () => seed(TODAY);

test('dates', () => {
  assert.equal(E.addDays('2026-02-27', 2), '2026-03-01');
  assert.equal(E.daysBetween('2026-11-17', '2026-12-01'), 14);
  assert.ok(E.isIso('2026-11-17')); assert.ok(!E.isIso('2026-02-30')); assert.ok(!E.isIso('17/11/2026'));
});

test('seed data is valid and has no dependency loop', () => {
  const d = data();
  assert.ok(E.isValidData(d));
  assert.equal(E.findCycle(d.tasks), null);
  for (const p of d.projects) assert.deepEqual(E.validateProject(p, d.projects), {});
  for (const t of d.tasks) assert.deepEqual(E.validateTask(t, d), {}, t.id);
  for (const r of d.risks) assert.deepEqual(E.validateRisk(r), {});
});

test('project validation: required fields, dates, unique name', () => {
  const d = data();
  const e = E.validateProject({ name: '', owner: '', start: '2026-11-20', deadline: '2026-11-10', status: 'X', priority: 'Y' }, d.projects);
  assert.ok(e.name && e.owner && e.deadline && e.status && e.priority);
  const dup = E.validateProject({ ...d.projects[0], id: 'new', name: 'atlas ' }, d.projects);
  assert.match(dup.name, /already/);
});

test('task validation: estimate range, self-dependency, other project, loops, done before deps', () => {
  const d = data();
  const base = d.tasks.find(t => t.id === 't-a4');
  assert.ok(E.validateTask({ ...base, estimate: 0 }, d).estimate);
  assert.ok(E.validateTask({ ...base, estimate: 2.5 }, d).estimate);
  assert.match(E.validateTask({ ...base, deps: ['t-a4'] }, d).deps, /itself/);
  assert.match(E.validateTask({ ...base, deps: ['t-b1'] }, d).deps, /same project/);
  // t-a2 depends on t-a1; making t-a1 depend on t-a7 (which depends on t-a2 chain) creates a loop
  const a1 = d.tasks.find(t => t.id === 't-a1');
  assert.match(E.validateTask({ ...a1, deps: ['t-a7'] }, d).deps, /loop/);
  assert.match(E.validateTask({ ...d.tasks.find(t => t.id === 't-a5'), status: 'Done' }, d).status, /not done/);
});

test('cycle finder returns the loop', () => {
  const loop = E.findCycle([{ id: 'a', deps: ['c'] }, { id: 'b', deps: ['a'] }, { id: 'c', deps: ['b'] }]);
  assert.ok(loop && loop[0] === loop[loop.length - 1] && loop.length === 4);
});

test('downstream, waiting, levels', () => {
  const d = data(); const at = d.tasks.filter(t => t.projectId === 'p-atlas');
  assert.deepEqual(E.downstream(at, 't-a3').sort(), ['t-a5', 't-a6', 't-a7']);
  assert.equal(E.isWaiting(at.find(t => t.id === 't-a5'), at), true);
  assert.equal(E.isWaiting(at.find(t => t.id === 't-a3'), at), false);
  const lv = E.levels(at); assert.equal(lv['t-a1'], 0); assert.equal(lv['t-a7'], 4);
});

test('critical path is the longest chain of unfinished work', () => {
  const d = data(); const at = d.tasks.filter(t => t.projectId === 'p-atlas');
  const cp = E.criticalPath(at);
  assert.deepEqual(cp.ids, ['t-a3', 't-a6', 't-a7']); // 7 + 4 + 3 = 14 beats 7 + 2 + 3 and 5 + 2 + 3
  assert.equal(cp.days, 14);
});

test('progress is weighted by estimate', () => {
  assert.equal(E.progress([{ estimate: 3, status: 'Done' }, { estimate: 1, status: 'To do' }]), 0.75);
  assert.equal(E.progress([]), 0);
});

test('expected progress', () => {
  assert.equal(E.expectedProgress({ start: '2026-11-01', deadline: '2026-11-11' }, '2026-11-06'), 0.5);
  assert.equal(E.expectedProgress({ start: '2026-11-01', deadline: '2026-11-11' }, '2026-12-01'), 1);
  assert.equal(E.expectedProgress({ start: '2026-11-01', deadline: '2026-11-11' }, '2026-10-01'), 0);
});

test('risk score and level', () => {
  assert.equal(E.riskScore({ impact: 5, probability: 3 }), 15);
  assert.equal(E.riskLevel(15), 'Critical'); assert.equal(E.riskLevel(10), 'High'); assert.equal(E.riskLevel(5), 'Medium'); assert.equal(E.riskLevel(4), 'Low');
});

test('health: penalties add up and labels follow the score', () => {
  const d = data();
  const fj = E.health(d, d.projects.find(p => p.id === 'p-fjord'), TODAY);
  assert.equal(fj.pastDeadline, true); assert.equal(fj.delayed, true); assert.equal(fj.penalties.schedule, 40);
  assert.equal(fj.score, 100 - fj.penalties.schedule - fj.penalties.milestones - fj.penalties.risks - fj.penalties.blockers);
  assert.equal(fj.label, 'Critical');
  const delta = E.health(d, d.projects.find(p => p.id === 'p-delta'), TODAY);
  assert.equal(delta.score, 100); assert.equal(delta.label, 'Delivered'); assert.equal(delta.delayed, false);
  const ember = E.health(d, d.projects.find(p => p.id === 'p-ember'), TODAY);
  assert.equal(ember.label, 'Not started');
  // closing every risk raises the score
  const cobalt = d.projects.find(p => p.id === 'p-cobalt');
  const before = E.health(d, cobalt, TODAY).score;
  const after = E.health({ ...d, risks: d.risks.map(r => ({ ...r, status: 'Closed' })) }, cobalt, TODAY).score;
  assert.ok(after > before);
});

test('portfolio summary counts', () => {
  const s = E.portfolioSummary(data(), TODAY);
  assert.equal(s.total, 6); assert.equal(s.active, 4); assert.equal(s.completed, 1);
  assert.ok(s.delayed >= 2); // Atlas (overdue milestone) and Fjord (past deadline)
  assert.ok(s.upcoming.every(m => m.target >= TODAY));
  assert.equal(s.topRisks[0].id, 'r-6'); // 5 x 4 = 20
});

test('insights cite real records and never invent', () => {
  const d = data(); const list = E.insights(d, TODAY);
  assert.ok(list.length > 0);
  const ids = new Set([...d.projects, ...d.milestones, ...d.tasks, ...d.risks].map(x => x.id));
  for (const i of list) { assert.ok(i.evidence.length > 0); for (const ev of i.evidence) assert.ok(ids.has(ev.id), ev.id); }
  assert.ok(list.some(i => i.kind === 'risk' && /without a mitigation/.test(i.title))); // r-3
  assert.ok(list.some(i => i.kind === 'deadline' && i.project === 'p-fjord'));
  // an empty workspace gives no insights
  assert.equal(E.insights({ projects: [], milestones: [], tasks: [], risks: [] }, TODAY).length, 0);
});

test('status summary uses the real figures', () => {
  const d = data(); const p = d.projects.find(x => x.id === 'p-atlas');
  const s = E.statusSummary(d, p, TODAY);
  assert.match(s, /^Atlas is /); assert.match(s, /of 8 tasks/);
});

test('deletion rules', () => {
  const d = data();
  const a = E.deleteProject(d, 'p-atlas');
  assert.ok(!a.tasks.some(t => t.projectId === 'p-atlas') && !a.risks.some(r => r.projectId === 'p-atlas') && !a.milestones.some(m => m.projectId === 'p-atlas'));
  const b = E.deleteTask(d, 't-a3');
  assert.ok(!b.tasks.some(t => (t.deps || []).includes('t-a3')));
  const c = E.deleteMilestone(d, 'm-a2');
  assert.equal(c.tasks.find(t => t.id === 't-a3').milestoneId, '');
});

test('CSV export escapes and blocks formulas', () => {
  assert.equal(E.csvCell('=SUM(A1)'), "'=SUM(A1)");
  assert.equal(E.csvCell('a,b'), '"a,b"');
  assert.equal(E.csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(E.toCsv([['a', 1], ['b', null]]), 'a,1\r\nb,');
});

test('stored data shape check', () => {
  assert.ok(!E.isValidData(null)); assert.ok(!E.isValidData({ projects: [] }));
  assert.ok(!E.isValidData({ projects: [{ id: 'x', name: 'y', start: 'bad', deadline: '2026-01-01' }], milestones: [], tasks: [], risks: [] }));
});

// ---------- work management ----------
const AT = '2026-11-17T10:00';
test('task keys follow the project key', () => {
  const d = data();
  assert.equal(E.nextKey(d, 'p-atlas'), 'ATL-9');
  assert.equal(E.nextKey(d, 'p-delta'), 'DLT-3');
  assert.ok(new Set(d.tasks.map(t => t.key)).size === d.tasks.length, 'keys are unique');
});

test('project key is required, 2 to 5 capitals, unique', () => {
  const d = data(); const p = d.projects[0];
  assert.match(E.validateProject({ ...p, code: 'at' }, d.projects).code, /capital/);
  assert.match(E.validateProject({ ...p, id: 'x', name: 'Other', code: 'BCN' }, d.projects).code, /already/);
});

test('on hold needs a reason, resume goes back to the previous status', () => {
  const d = data();
  assert.match(E.hold(d, 't-a4', '  ', 'Lina Haddad', AT).errors.holdReason, /why/);
  const r = E.updateTask(d, 't-b3', { status: 'In progress' }, 'Lina Haddad', AT); // already in progress: no change
  assert.equal(r.changes.length, 0);
  const h = E.hold(d, 't-b3', 'Waiting for the vendor', 'Lina Haddad', AT);
  const t = h.data.tasks.find(x => x.id === 't-b3');
  assert.equal(t.status, 'On hold'); assert.equal(t.heldFrom, 'In progress'); assert.equal(t.holdReason, 'Waiting for the vendor');
  assert.deepEqual(t.history.slice(-2).map(x => x.field), ['Status', 'Hold reason']);
  const back = E.resume(h.data, 't-b3', 'Lina Haddad', AT).data.tasks.find(x => x.id === 't-b3');
  assert.equal(back.status, 'In progress'); assert.equal(back.holdReason, '');
  assert.match(E.resume(d, 't-a4', 'x', AT).errors.status, /not paused/);
});

test('on hold counts against project health', () => {
  const d = data(); const p = d.projects.find(x => x.id === 'p-beacon');
  const before = E.health(d, p, TODAY);
  const after = E.health(E.hold(d, 't-b3', 'Vendor', 'x', AT).data, p, TODAY);
  assert.equal(after.blocked.length, before.blocked.length + 1);
  assert.ok(after.score < before.score);
});

test('assignee change and labels are recorded in history and cleaned', () => {
  const d = data();
  const r = E.updateTask(d, 't-a4', { owner: 'Jonas Berg', labels: ['Frontend', 'ux', 'ux'] }, 'Lina Haddad', AT);
  const t = r.data.tasks.find(x => x.id === 't-a4');
  assert.equal(t.owner, 'Jonas Berg'); assert.deepEqual(t.labels, ['frontend', 'ux']);
  const a = t.history.find(x => x.field === 'Assignee');
  assert.equal(a.from, 'Lina Haddad'); assert.equal(a.to, 'Jonas Berg'); assert.equal(a.by, 'Lina Haddad');
  assert.match(E.updateTask(d, 't-a4', { labels: ['has space'] }, 'x', AT).errors.labels, /small letters/);
  assert.match(E.updateTask(d, 't-a4', { labels: ['a', 'b', 'c', 'd', 'e', 'f'] }, 'x', AT).errors.labels, /5/);
});

test('drag and drop: status, order, and refusal when dependencies are open', () => {
  const d = data();
  const r = E.placeTask(d, 't-a4', 'In progress', 't-b3', 'x', AT);
  const col = r.data.tasks.filter(t => t.status === 'In progress').sort(E.byRank).map(t => t.id);
  assert.ok(col.indexOf('t-a4') === col.indexOf('t-b3') - 1, 'placed just before');
  const end = E.placeTask(d, 't-a4', 'In review', null, 'x', AT).data.tasks.filter(t => t.status === 'In review').sort(E.byRank);
  assert.equal(end[end.length - 1].id, 't-a4');
  assert.match(E.placeTask(d, 't-a5', 'Done', null, 'x', AT).errors.status, /not done/);
  assert.ok(E.placeTask(d, 't-a4', 'On hold', null, 'x', AT).errors.holdReason, 'hold via drag needs a reason');
  assert.equal(E.placeTask(d, 't-a4', 'On hold', null, 'x', AT, 'Design change').data.tasks.find(t => t.id === 't-a4').status, 'On hold');
});

test('comments: kept in order, empty and too long refused', () => {
  const d = data();
  assert.ok(E.addComment(d, 't-a4', '   ', 'x', AT).errors.comment);
  assert.ok(E.addComment(d, 't-a4', 'a'.repeat(1001), 'x', AT).errors.comment);
  const r = E.addComment(d, 't-c2', 'Escalated.', 'Lina Haddad', AT);
  const c = r.data.tasks.find(t => t.id === 't-c2').comments;
  assert.equal(c.length, 3); assert.equal(c[2].text, 'Escalated.');
});

test('bulk edit applies valid changes and reports the others', () => {
  const d = data();
  const r = E.bulkUpdate(d, ['t-a4', 't-a5', 't-b4'], { status: 'Done' }, 'x', AT);
  assert.equal(r.done, 2); assert.equal(r.failed.length, 1); assert.equal(r.failed[0].key, 'ATL-5'); // ATL-5 waits for open tasks
  assert.equal(r.data.tasks.find(t => t.id === 't-a4').status, 'Done');
  const a = E.bulkUpdate(d, ['t-a4', 't-b4'], { owner: 'Sofia Klein' }, 'x', AT);
  assert.equal(a.done, 2);
});

test('filters: me, assignee, status, label, overdue, on hold, text', () => {
  const d = data(); const T = d.tasks;
  assert.ok(E.applyFilter(T, { assignee: 'me' }, 'Lina Haddad', TODAY).every(t => t.owner === 'Lina Haddad'));
  assert.ok(E.applyFilter(T, { status: ['On hold'] }, '', TODAY).every(t => t.status === 'On hold'));
  assert.deepEqual(E.applyFilter(T, { label: 'security' }, '', TODAY).map(t => t.key), ['FJD-2', 'FJD-3', 'FJD-4']);
  assert.ok(E.applyFilter(T, { overdue: true }, '', TODAY).every(t => E.isTaskOverdue(t, TODAY)));
  assert.equal(E.applyFilter(T, { text: 'cbt-2' }, '', TODAY).length, 1);
  assert.equal(E.applyFilter(T, {}, '', TODAY).length, T.length);
  assert.ok(E.validateFilterName('Security work', d.filters));
  assert.equal(E.validateFilterName('Mine', d.filters), '');
});

test('workload adds open work per person', () => {
  const w = E.workload(data());
  const total = data().tasks.filter(t => t.status !== 'Done').reduce((s, t) => s + t.estimate, 0);
  assert.equal(w.reduce((s, x) => s + x.days, 0), total);
});

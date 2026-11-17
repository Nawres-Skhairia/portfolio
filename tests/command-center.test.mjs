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
  assert.match(s, /^Atlas is /); assert.match(s, /of 7 tasks/);
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

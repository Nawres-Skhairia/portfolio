// Page wiring. Builds everything with text nodes only (no HTML from data).
(function () {
  'use strict';
  const { STOPS } = SH_REDESIGN, { TESTS } = SH_TESTS, H = SH_HEAL, E = SH_ENGINE;
  const $ = (id) => document.getElementById(id);
  const robot = new E.Robot($('shop'), $('cursor'), $('stage'));
  const state = { stop: 0, first: {}, results: null, busy: false };
  const LABEL = { passed: 'passed', failed: 'failed', broken: 'broken', healed: 'healed', 'real bug': 'real bug', 'needs a person': 'needs a person', running: 'running', waiting: 'not run' };
  const CLS = { passed: 'passed', failed: 'failed', broken: 'broken', healed: 'healed', 'real bug': 'realbug', 'needs a person': 'needs', running: 'running', waiting: '' };

  function node(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; }
  function pct(x) { return Math.round(x * 100) + '%'; }

  // ---------- slider ----------
  STOPS.forEach((s) => $('ticks').append(node('li', '', s.stop + ' ' + s.name)));
  function showStop() {
    const s = Number($('stop').value);
    state.stop = s; state.first = {}; state.results = null;
    Array.from($('ticks').children).forEach((li, i) => li.classList.toggle('on', i === s));
    const ul = $('changes'); ul.textContent = '';
    const ops = SH_REDESIGN.opsUpTo(s);
    if (!ops.length) ul.append(node('li', '', 'The original page. All 8 tests were written for it.'));
    ops.forEach((o) => ul.append(node('li', o.hidden ? 'mystery' : '', o.hidden ? 'One more change is a hidden developer mistake. Can the tests tell it apart from a redesign?' : o.note)));
    $('healBtn').disabled = true; $('downloads').hidden = true;
    $('shop').src = 'shop.html?stop=' + s;
    $('now').textContent = (s === 0 ? 'Original shop.' : 'Redesign stop ' + s + ': ' + STOPS[s].name.toLowerCase() + '.') + ' Press "Run the 8 tests".';
    draw();
  }
  $('stop').addEventListener('input', showStop);
  $('speed').addEventListener('change', () => { robot.delay = Number($('speed').value); });

  // ---------- test list ----------
  const open = new Set();
  function draw() {
    const ol = $('tests'); ol.textContent = '';
    let tally = {};
    TESTS.forEach((t) => {
      const r = state.results ? state.results.find((x) => x.test === t.id) : null;
      const f = state.first[t.id];
      const status = r ? r.outcome : f ? (f.running ? 'running' : f.status === 'pass' ? 'passed' : f.status === 'fail' ? 'failed' : 'broken') : 'waiting';
      tally[status] = (tally[status] || 0) + 1;
      const li = node('li', 't'), b = node('button');
      b.type = 'button'; b.setAttribute('aria-expanded', String(open.has(t.id)));
      b.append(node('span', 'tid', t.id), node('span', '', t.name), node('span', 'st ' + CLS[status], LABEL[status]));
      b.addEventListener('click', () => { open.has(t.id) ? open.delete(t.id) : open.add(t.id); draw(); });
      li.append(b);
      if (open.has(t.id)) li.append(detail(t, f, r));
      ol.append(li);
    });
    const order = ['passed', 'healed', 'real bug', 'needs a person', 'failed', 'broken'];
    $('tally').textContent = state.results || Object.keys(state.first).length ? '· ' + order.filter((k) => tally[k]).map((k) => tally[k] + ' ' + LABEL[k]).join(', ') : '';
  }
  function detail(t, f, r) {
    const d = node('div', 'detail');
    if (!f && !r) { d.append(node('p', 'hint', 'Steps: ' + t.steps.map((s) => s.say).join(' → ') + '.')); return d; }
    if (r && r.reason) d.append(node('p', 'reason', r.reason));
    if (r) r.attempts.forEach((a) => {
      const rep = r.repairs.find((p) => p.target === a.target) || {};
      const box = node('div', 'repair' + (/rejected/.test(a.result) ? ' rejected' : ''));
      const fp = rep.old || SH_TESTS.FINGERPRINTS[a.target];
      const cand = (rep.ranked || []).find((c) => c.id === a.id);
      box.append(node('span', 'old', 'Lost: ' + H.describe(fp) + ' (data-test="' + a.target + '")'));
      const p = node('span', ''); p.append('Proposed: ' + (cand ? H.describe(cand.fp) : '#' + a.id) + ' ', node('code', '', '#' + a.id), ' · match ' + pct(a.score) + ' · by ' + a.by);
      box.append(p, node('span', 'res' + (/accepted|kept: clear/.test(a.result) ? ' ok' : ''), a.result));
      d.append(box);
    });
    if (r && r.outcome === 'needs a person' && r.ranked) {
      d.append(node('p', 'hint', 'Best matches for the lost ' + H.describe(SH_TESTS.FINGERPRINTS[r.ranked.target]) + ': ' + r.ranked.list.slice(0, 3).map((c) => '#' + c.id + ' ' + pct(c.score)).join(', ') + '.'));
    }
    const runLog = (r && r.last) || f;
    if (runLog && runLog.log) d.append(node('pre', 'log', (r ? 'Last run:\n' : 'Run:\n') + runLog.log.join('\n')));
    return d;
  }

  // ---------- run, heal ----------
  function lock(on) { state.busy = on; ['runBtn', 'healBtn', 'stop'].forEach((id) => { $(id).disabled = on; }); }
  async function runAll() {
    lock(true); state.results = null; state.first = {};
    for (const t of TESTS) {
      state.first[t.id] = { running: true }; draw();
      $('now').textContent = t.id + ': ' + t.name + '…';
      state.first[t.id] = await robot.run(t, state.stop, {});
      draw();
    }
    lock(false);
    const red = TESTS.filter((t) => state.first[t.id].status !== 'pass').length;
    $('healBtn').disabled = red === 0;
    $('now').textContent = red ? red + ' of 8 tests are red. Press Heal.' : 'All 8 tests are green.' + (state.stop < 3 ? ' Move the redesign slider.' : '');
  }
  async function healAll(stop, delay) {
    const keep = robot.delay;
    if (delay !== undefined) robot.delay = delay;
    const results = [];
    for (const t of TESTS) {
      $('now').textContent = 'Healing ' + t.id + ': ' + t.name + '…';
      results.push(await E.heal(robot, t, stop));
    }
    robot.delay = keep;
    return results;
  }
  $('runBtn').addEventListener('click', runAll);
  $('healBtn').addEventListener('click', async () => {
    lock(true);
    state.results = await healAll(state.stop);
    lock(false); $('healBtn').disabled = true;
    state.results.filter((r) => r.outcome !== 'passed').forEach((r) => open.add(r.test));
    draw();
    const c = (o) => state.results.filter((r) => r.outcome === o).length;
    $('now').textContent = 'Healed ' + c('healed') + ', real bug ' + c('real bug') + ', needs a person ' + c('needs a person') + '. Open a test to see why.';
    $('downloads').hidden = false;
  });

  // ---------- downloads ----------
  function save(name, type, text) {
    const a = node('a'); a.download = name; a.href = URL.createObjectURL(new Blob([text], { type }));
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  $('dlTests').addEventListener('click', () => save('tests-after-healing-stop' + state.stop + '.json', 'application/json', JSON.stringify(E.patchedTests(TESTS, state.results), null, 2)));
  $('dlJunit').addEventListener('click', () => save('junit-stop' + state.stop + '.xml', 'application/xml', E.junit(state.results, state.stop)));

  // ---------- under the hood ----------
  const W = { words: 'its words (button text or label)', shape: 'what it is made of (the options of a list, the type and limits of a box)', near: 'the section it sits in', ids: 'its old test id and name', place: 'its place on the page' };
  Object.keys(H.WEIGHTS).forEach((k) => $('weights').append(node('li', '', pct(H.WEIGHTS[k]) + ' ' + W[k])));
  $('weights').append(node('li', '', 'another kind of element (a box instead of a button) keeps only ' + pct(H.OTHER_KIND) + ' of its score'));
  $('minScore').textContent = pct(H.MIN_SCORE) + ' (or ' + pct(H.LONE.score) + ' when no other element comes within ' + Math.round(H.LONE.margin * 100) + ' points)';

  function fit() {
    const k = Math.min(1, $('stagebox').clientWidth / 482);
    $('stage').style.transform = k < 1 ? 'scale(' + k + ')' : '';
    $('stagebox').style.height = Math.ceil(642 * k) + 'px';
  }
  window.addEventListener('resize', fit); fit();

  showStop();
  window.SH_APP = { ready: true, healAll };
})();

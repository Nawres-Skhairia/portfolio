// Test Pilot page: wires the story, the plan, the check, the robot and the report together.
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const CORE = window.TP_CORE, PRE = window.TP_PREMADE, CLOCK = window.TP_CLOCK;

  // Builds DOM nodes. Text is always set as text, never as HTML (story and AI text are untrusted).
  function el(tag, cls, ...kids) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    kids.flat().forEach((k) => { if (k !== null && k !== undefined && k !== false) n.append(k instanceof Node ? k : String(k)); });
    return n;
  }
  const badge = (kind, text) => el('span', 'b k-' + kind, text || kind);

  // ---------- setup ----------
  $('story').value = PRE.STORY;
  $('clockLine').textContent = CLOCK.label;
  PRE.BUGS.forEach((b) => {
    const o = el('option', null, b.n === 0 ? 'Clean form (no bug)' : b.short + ' (named after the run)');
    o.value = String(b.n);
    $('bug').append(o);
  });
  $('bug').value = '1'; // first visit: bug 1 on, so the first run shows a red test

  const robot = new window.TP_Robot($('frame'), $('cursor'), $('stage'));
  let last = null; // the real data of the last run, shown in the map boxes (AT12)
  let running = false;

  $('bug').addEventListener('change', () => { if (!running) { robot.bug = Number($('bug').value); robot.open(); } });
  $('story').addEventListener('input', storyNote);

  function storyNote() {
    const edited = $('story').value.trim() !== PRE.STORY;
    $('storyNote').hidden = !edited;
    $('storyNote').textContent = edited ? 'You changed the story. The pre-made plan only fits the original story, so an edited story needs the AI, which comes in a later version.' : '';
    $('go').disabled = edited;
    if (edited) {
      $('storyNote').append(' ');
      const b = el('button', 'linkbtn', 'Back to the original story');
      b.type = 'button';
      b.addEventListener('click', () => { $('story').value = PRE.STORY; storyNote(); });
      $('storyNote').append(b);
    }
  }

  // ---------- the map ----------
  const STEPS = {
    story: { title: 'Story (you)', what: 'In: your words. Out: the story the tests must follow.' },
    read: { title: 'Read', what: 'In: the story. Out: rules with values, one per acceptance criterion (AC).' },
    plan: { title: 'Plan', what: 'In: the rules. Out: tests from the fixed library, each with its values and a plain "why".' },
    check: { title: 'Check (fixed rules)', what: 'In: the plan. Out: the tests that may run, what the plan got wrong, and rules with no test.' },
    run: { title: 'Run (robot)', what: 'In: the checked tests. Out: what the form really did, step by step.' },
    report: { title: 'Report (fixed rules)', what: 'In: expected and actual results. Out: pass or fail per test and the verdict.' }
  };
  function mapState(step, state) {
    const b = document.querySelector('.box[data-step="' + step + '"]');
    b.classList.remove('active', 'done', 'warn');
    if (state) b.classList.add(state);
  }
  function resetMap() { Object.keys(STEPS).forEach((s) => mapState(s, '')); }
  document.querySelectorAll('.box').forEach((b) => b.addEventListener('click', () => showBox(b.dataset.step)));
  $('bdClose').addEventListener('click', () => { $('boxDetail').hidden = true; });
  function showBox(step) {
    const s = STEPS[step];
    $('bdTitle').textContent = s.title + ((step === 'read' || step === 'plan') ? (last && last.planner === 'premade' ? ' (pre-made, no AI)' : ' (AI)') : '');
    $('bdWhat').textContent = s.what;
    $('bdData').textContent = last ? last.box[step] : 'No run yet. Press "Test it" and come back.';
    $('boxDetail').hidden = false;
  }

  // ---------- a run ----------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  $('go').addEventListener('click', run);

  async function run() {
    if (running) return;
    running = true; $('go').disabled = true; $('go').textContent = 'Testing…';
    robot.delay = Number($('speed').value);
    robot.bug = Number($('bug').value);
    const pace = Math.min(robot.delay, 300);
    resetMap(); $('boxDetail').hidden = true;
    $('results').hidden = false; $('tests').replaceChildren(); $('failures').replaceChildren();
    $('vTitle').textContent = 'Running…'; $('vLine').textContent = ''; $('report').className = 'report';
    $('wrongBox').hidden = true; $('gapBox').hidden = true;
    const box = {};
    const narrow = window.matchMedia('(max-width: 860px)').matches;
    if (narrow) $('stage').scrollIntoView({ block: 'start', behavior: 'smooth' }); // on a phone, watch the form while the robot works
    const t0 = performance.now();

    // 1. Story
    mapState('story', 'active'); await sleep(pace);
    box.story = $('story').value.trim();
    mapState('story', 'done');

    // 2 and 3. Read and Plan. In this preview the pre-made plan is used, labelled "no AI" (R8).
    const planner = 'premade';
    document.querySelectorAll('[data-who]').forEach((n) => { n.textContent = planner === 'premade' ? 'pre-made' : 'AI'; n.className = 'b ' + (planner === 'premade' ? 'k-pre' : 'k-ai'); });
    mapState('read', 'active'); await sleep(pace);
    const rules = PRE.RULES;
    box.read = rules.map((r) => r.id + '  ' + r.text).join('\n');
    mapState('read', 'done');
    mapState('plan', 'active'); await sleep(pace);
    const plan = PRE.PLAN;
    box.plan = plan.map((p, i) => (i + 1) + '. ' + p.rule + ' · ' + p.technique + ' · ' + p.field + (p.value !== null ? ' = ' + (p.value === '' ? '(empty)' : p.value) : '') + '\n   why: ' + p.why).join('\n');
    mapState('plan', 'done');

    // 4. Check
    mapState('check', 'active'); await sleep(pace);
    const checked = CORE.checkPlan(rules, plan);
    box.check = checked.valid.length + ' tests may run.\n' + checked.wrong.length + ' plan items rejected.' + checked.wrong.map((w) => '\n - item ' + (w.index + 1) + ': ' + w.reasons.join('; ')).join('') + '\n' + checked.notTested.length + ' rules with no test.' + checked.notTested.map((r) => '\n - ' + r.id + ' ' + r.text).join('');
    mapState('check', checked.wrong.length || checked.notTested.length ? 'warn' : 'done');
    showWrong(checked);

    // 5. Run: the robot really drives the form
    mapState('run', 'active');
    $('testCount').textContent = '(' + checked.valid.length + ')';
    const cards = checked.valid.map((t) => { const c = card(t, planner); $('tests').append(c.li); return c; });
    const results = [], runLog = [];
    for (let i = 0; i < checked.valid.length; i++) {
      const t = checked.valid[i], c = cards[i];
      c.li.classList.add('running');
      if (!narrow) c.li.scrollIntoView({ block: 'nearest', behavior: robot.delay > 100 ? 'smooth' : 'auto' });
      const exp = CORE.expected(rules, t);
      const { actual, log } = await robot.run(t, CORE.BASE);
      const j = CORE.judge(exp, actual);
      results.push({ test: t, exp, actual, pass: j.pass, reason: j.reason });
      runLog.push(t.id + ' (' + t.rule + ', ' + t.technique + ')\n   ' + log.join('\n   ') + '\n   => ' + (j.pass ? 'PASS' : 'FAIL') + ': ' + j.reason);
      c.li.classList.remove('running'); c.li.classList.add(j.pass ? 'pass' : 'fail');
      c.status.textContent = j.pass ? 'Passed' : 'Failed';
      c.result.textContent = j.reason;
    }
    $('cursor').hidden = true;
    box.run = runLog.join('\n\n');
    const robotSeconds = (performance.now() - t0) / 1000;
    mapState('run', 'done');

    // 6. Report: verdict from fixed rules only (R2, R5)
    mapState('report', 'active'); await sleep(pace);
    const v = CORE.verdict(results, checked.notTested);
    $('report').className = 'report v-' + v.key;
    $('vTitle').textContent = v.title;
    $('vLine').textContent = v.line + (v.key === 'not_ready' ? ' ' + results.filter((x) => !x.pass).map((x) => x.reason).join(' ') : '');
    results.filter((x) => !x.pass).forEach((x) => $('failures').append(failure(x)));
    box.report = v.title + '. ' + v.line + '\nRun time: ' + robotSeconds.toFixed(1) + ' s.\nForm under test: ' + PRE.BUGS[robot.bug].short + ' (' + PRE.BUGS[robot.bug].long + ')';
    mapState('report', v.key === 'ready' ? 'done' : 'warn');

    // After the run: name the bugs, labelled as planted on purpose (R14)
    showBugs(robot.bug);
    last = { planner, box };
    running = false; $('go').disabled = false; $('go').textContent = 'Test it again';
    $('report').scrollIntoView({ block: 'start', behavior: robot.delay > 100 ? 'smooth' : 'auto' });
  }

  function card(t, planner) {
    const tech = CORE.LIBRARY[t.technique];
    const status = el('span', 'status', 'Waiting');
    const result = el('p', 'result');
    const value = t.value === 'tonight' ? 'press "Tonight at 19:30"' : t.field === 'booking' ? 'a valid booking' : t.field + ' = ' + (t.value === '' ? '(empty)' : t.value);
    const li = el('li', 'test',
      el('div', 'trow', el('b', null, t.id), el('span', 'tech', tech.label + ' · ' + tech.family), el('span', 'ac', t.rule), status),
      el('p', 'what', value),
      el('p', 'why', planner === 'premade' ? badge('pre', 'pre-made') : badge('ai', 'AI'), ' ', t.why),
      result);
    return { li, status, result };
  }
  function failure(x) {
    const box = el('div', 'failure',
      el('p', 'f-title', x.test.id + ' failed · ' + x.test.rule + ' · ' + CORE.LIBRARY[x.test.technique].label),
      el('p', null, x.reason),
      el('p', 'f-sub', 'Steps to reproduce'),
      el('ol', null, CORE.steps(x.test, x.exp).map((s) => el('li', null, s))));
    return box;
  }
  function showWrong(checked) {
    $('wrong').replaceChildren(...checked.wrong.map((w) => el('li', null, 'Item ' + (w.index + 1) + ': ' + w.reasons.join('; ') + '.')));
    $('wrongBox').hidden = !checked.wrong.length;
    $('gaps').replaceChildren(...checked.notTested.map((r) => el('li', null, r.id + ': ' + r.text)));
    $('gapBox').hidden = !checked.notTested.length;
  }
  function showBugs(current) {
    $('bugList').replaceChildren(...PRE.BUGS.map((b) => el('li', b.n === current ? 'on' : null, el('b', null, b.short + ': '), b.long, b.n ? ' Planted on purpose for this demo.' : '', b.n === current ? ' (this run)' : '')));
    $('how').hidden = false;
    [...$('bug').options].forEach((o) => { const b = PRE.BUGS[Number(o.value)]; o.textContent = b.n === 0 ? 'Clean form (no bug)' : b.short + ': ' + b.long; });
  }

  // Test hook for the automatic checks (AT7): run the check on any plan without the page.
  window.TP_TEST_HOOK = { checkPlan: CORE.checkPlan };
  robot.bug = 1;
})();

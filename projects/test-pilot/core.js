// Test Pilot core: the test library, the plan check, the expected results ("oracle") and the verdict.
// Pure functions with no page access, so the same code runs in the page and in the automatic checks.
// Rule of the design: in a later version an AI may READ the story and PLAN tests (this version uses a
// pre-made plan, no AI); the AI never decides pass, fail or the verdict.
(function (root) {
  'use strict';
  const C = root.TP_CLOCK;

  // R6/R16: the only things the robot can do. Each technique lists the fields it may touch.
  const LIBRARY = {
    happy_path:     { label: 'Happy path',              family: 'positive test',        fields: ['booking'] },
    boundary:       { label: 'Boundary values',         family: 'boundary values',      fields: ['guests', 'time'] },
    required_empty: { label: 'Required field empty',    family: 'negative test',        fields: ['date', 'time', 'guests', 'email'] },
    format:         { label: 'Valid and invalid format', family: 'equivalence classes', fields: ['email', 'guests'] },
    day_rule:       { label: 'Date or day rule',        family: 'equivalence classes',  fields: ['date'] },
    time_window:    { label: 'Time window',             family: 'boundary values',      fields: ['time'] },
    past_date:      { label: 'Past date',               family: 'negative test',        fields: ['date'] },
    summary:        { label: 'Summary matches input',   family: 'positive test',        fields: ['booking'] },
    state:          { label: 'Double click',            family: 'state',                fields: ['booking'] }
  };
  const FIELD_TYPES = {
    date: (v) => v === '' || v === 'tonight' || /^\d{4}-\d{2}-\d{2}$/.test(v),
    time: (v) => v === '' || /^\d{2}:\d{2}$/.test(v),
    guests: (v) => typeof v === 'string' && v.length <= 6,
    email: (v) => typeof v === 'string' && v.length <= 80,
    booking: (v) => v === null || v === undefined || v === ''
  };
  const MAX_TESTS = 20; // R7
  // A valid booking the robot starts every test from (fictional data only, R12).
  const BASE = { date: '2026-12-02', time: '19:30', guests: '2', email: 'alex.martin@example.com' };
  const RULE_KINDS = ['guests_range', 'closed_days', 'opening_hours', 'no_past', 'email', 'summary', 'untestable'];

  const minutes = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const str = (v) => (v === null || v === undefined ? '' : String(v));

  // Step 4 (R3, R4, R7): check the plan before anything runs. Bad items are kept aside and shown.
  function checkPlan(rules, plan) {
    const ruleIds = new Set(rules.map((r) => r.id));
    const valid = [], wrong = [];
    (Array.isArray(plan) ? plan : []).forEach((item, i) => {
      const why = [];
      const tech = item && LIBRARY[item.technique];
      if (!item || typeof item !== 'object') why.push('not a test');
      else {
        if (!tech) why.push(`"${str(item.technique)}" is not in the test library`);
        if (!FIELD_TYPES[item.field]) why.push(`the form has no field "${str(item.field)}"`);
        else if (tech && !tech.fields.includes(item.field)) why.push(`${tech.label} cannot be used on "${item.field}"`);
        else if (!FIELD_TYPES[item.field](item.value === undefined ? '' : item.value)) why.push(`"${str(item.value)}" is not a possible value for ${item.field}`);
        if (!ruleIds.has(item.rule)) why.push(`it points to a criterion that does not exist ("${str(item.rule)}")`);
      }
      if (!why.length && valid.length >= MAX_TESTS) why.push(`more than ${MAX_TESTS} tests`);
      if (why.length) wrong.push({ index: i, item, reasons: why });
      else valid.push(Object.assign({ id: 'T' + (valid.length + 1) }, item, { why: str(item.why).slice(0, 240) }));
    });
    const covered = new Set(valid.map((t) => t.rule));
    const notTested = rules.filter((r) => !covered.has(r.id));
    return { valid, wrong, notTested };
  }

  // What the story says should happen for one test. Built only from the rules, never from the form.
  function expected(rules, test) {
    const input = Object.assign({}, BASE);
    if (test.field in input) input[test.field] = test.value === 'tonight' ? input[test.field] : str(test.value);
    if (test.value === 'tonight') { input.date = C.today; input.time = '19:30'; }
    const r = (kind) => rules.find((x) => x.kind === kind);
    const refuse = (because, ac) => ({ input, outcome: 'refused', because, ac });
    if (!input.date || !input.time || input.guests === '') return refuse('a booking needs a date, a time and the number of guests', null);
    const past = r('no_past');
    if (past && input.date < C.today) return refuse(`the story says no booking in the past (today is ${C.today})`, past.id);
    const closed = r('closed_days');
    if (closed && closed.days.includes(C.weekday(input.date))) return refuse(`the story says closed on ${C.weekday(input.date)}`, closed.id);
    const hours = r('opening_hours');
    if (hours && !hours.windows.some(([a, b]) => minutes(input.time) >= minutes(a) && minutes(input.time) <= minutes(b)))
      return refuse(`the story says bookings ${hours.windows.map((w) => w.join(' to ')).join(' and ')}`, hours.id);
    const g = r('guests_range');
    if (!/^\d+$/.test(input.guests)) return refuse('the number of guests must be a whole number', g ? g.id : null);
    if (g && (Number(input.guests) < g.min || Number(input.guests) > g.max)) return refuse(`the story allows ${g.min} to ${g.max} guests`, g.id);
    const em = r('email');
    if (em && !input.email) return refuse('the story says email is required', em.id);
    if (em && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) return refuse('the story says the email must look like an email', em.id);
    const out = { input, outcome: 'accepted', because: 'it follows every rule in the story', ac: test.rule };
    if (test.technique === 'summary' || test.value === 'tonight') out.summary = { date: input.date, time: input.time, guests: input.guests };
    if (test.technique === 'state') out.bookingsAdded = 1;
    return out;
  }

  // Compare what the form really did with what the story expects. Fixed rules only (R2).
  function judge(exp, actual) {
    if (actual.timedOut) return { pass: false, reason: 'The form did not answer within 5 seconds.' };
    if (actual.outcome !== exp.outcome)
      return { pass: false, reason: `Expected: ${exp.outcome}, because ${exp.because}. Actual: ${actual.outcome}${actual.message ? ` ("${actual.message}")` : ''}.` };
    if (exp.summary) {
      const diff = ['date', 'time', 'guests'].filter((k) => str(actual.summary && actual.summary[k]) !== exp.summary[k]);
      if (diff.length) return { pass: false, reason: `Expected the summary to show ${diff.map((k) => `${k} ${exp.summary[k]}`).join(', ')}. Actual: ${diff.map((k) => `${k} ${str(actual.summary && actual.summary[k]) || '(empty)'}`).join(', ')}.` };
    }
    if (exp.bookingsAdded !== undefined && actual.bookingsAdded !== exp.bookingsAdded)
      return { pass: false, reason: `Expected ${exp.bookingsAdded} new booking after a double click. Actual: ${actual.bookingsAdded} new bookings.` };
    return { pass: true, reason: `As expected: ${exp.outcome}.` };
  }

  // R4, R5: the verdict, from fixed rules only.
  function verdict(results, notTested) {
    const failed = results.filter((x) => !x.pass).length;
    if (failed) return { key: 'not_ready', title: 'Not ready to ship', line: `${failed} of ${results.length} tests failed.` };
    if (notTested.length) return { key: 'gaps', title: 'Ready, with gaps', line: `All ${results.length} tests passed, but ${notTested.length} rule${notTested.length > 1 ? 's have' : ' has'} no test.` };
    return { key: 'ready', title: 'Ready to ship', line: `All ${results.length} tests passed and every rule was tested.` };
  }

  // Steps to reproduce a failure, written by fixed code from the real test.
  function steps(test, exp) {
    const i = exp.input;
    if (test.value === 'tonight') return ['Open the form.', 'Press "Tonight at 19:30".', `Set guests to ${i.guests}, keep the email ${i.email}.`, 'Press "Book a table".', 'Read the date in the summary.'];
    const lines = ['Open the form.', `Fill date ${i.date || '(empty)'}, time ${i.time || '(empty)'}, guests ${i.guests || '(empty)'}, email ${i.email || '(empty)'}.`];
    lines.push(test.technique === 'state' ? 'Double-click "Book a table".' : 'Press "Book a table".');
    lines.push(test.technique === 'state' ? 'Read "Bookings made".' : 'Read the answer under the form.');
    return lines;
  }

  root.TP_CORE = { LIBRARY, FIELD_TYPES, BASE, MAX_TESTS, RULE_KINDS, checkPlan, expected, judge, verdict, steps };
})(typeof window !== 'undefined' ? window : globalThis);

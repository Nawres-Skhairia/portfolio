/* Traceability Hub: requirement -> test -> result -> defect, with stale-test detection. Data stays in localStorage. */
(function () {
  'use strict';
  const KEY = 'trace-hub-v1';
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const today = () => new Date().toISOString().slice(0, 10);
  const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
  const RESULT = { pass: 'Pass', fail: 'Fail', blocked: 'Blocked', notrun: 'Not run' };
  const COLORS = { pass: '#2f7a4f', fail: '#a23b1c', blocked: '#c98a1a', notrun: '#cfc3ae' };

  /* ---------- demo data ---------- */
  function demo() {
    const R = (id, feature, priority, title, text, history) => ({ id, feature, priority, title, text, version: (history || []).length + 1, history: history || [], createdAt: daysAgo(40) });
    const reqs = [
      R('REQ-01', 'Access', 'High', 'Log in with fingerprint or PIN', 'As a customer, I can log in with my fingerprint or a 6-digit PIN. After 3 wrong PINs, the account is locked for 30 minutes.'),
      R('REQ-02', 'Beneficiaries', 'High', 'Add a beneficiary', 'I can add a beneficiary with a name and an IBAN. The IBAN is checked before saving. A one-time code sent by SMS confirms the new beneficiary.'),
      R('REQ-03', 'Transfers', 'High', 'Transfer limits', 'A single transfer cannot exceed 5,000 TND. The daily total is limited to 8,000 TND, and to 1,000 TND for a beneficiary added less than 24 hours ago.',
        [{ v: 1, text: 'A single transfer cannot exceed 5,000 TND. The daily total is limited to 10,000 TND.', at: daysAgo(2) }]),
      R('REQ-04', 'Transfers', 'Medium', 'Confirm and receipt', 'Before sending, the customer sees a summary with the amount, the fees and the beneficiary, and confirms. A receipt is shown and sent by email.'),
      R('REQ-05', 'Transfers', 'Medium', 'Scheduled transfers', 'The customer can schedule a transfer for a future date or repeat it every month. A scheduled transfer can be cancelled until the day before.'),
      R('REQ-06', 'History', 'Low', 'Transfer history', 'The customer sees the transfers of the last 90 days, can search them by beneficiary or amount, and can export the list as a PDF.'),
      R('REQ-07', 'Access', 'Medium', 'Accessible transfer screens', 'All transfer screens work with a screen reader. Text can be enlarged up to 200% without losing content. Buttons are at least 44 pixels high.'),
      R('REQ-08', 'Transfers', 'High', 'Fraud alert on large transfers', 'A transfer above 3,000 TND to a beneficiary added in the last 7 days triggers a push notification. The transfer waits until the customer approves it in the app.')
    ];
    const T = (id, title, steps, links, result, owner, ran) => ({ id, title, steps, links, result, owner, runAt: daysAgo(ran) });
    const tests = [
      T('TC-01', 'Log in with a valid fingerprint', 'Enrolled fingerprint → home screen opens in under 2 seconds.', { 'REQ-01': 1 }, 'pass', 'Amira', 3),
      T('TC-02', 'Log in with a valid PIN', 'Enter the correct 6-digit PIN → home screen opens.', { 'REQ-01': 1 }, 'pass', 'Amira', 3),
      T('TC-03', 'Account locked after 3 wrong PINs', 'Enter a wrong PIN 3 times → account locked; retry after 29 minutes is refused, after 30 minutes accepted.', { 'REQ-01': 1 }, 'fail', 'Amira', 3),
      T('TC-04', 'Add a beneficiary with a valid IBAN and SMS code', 'Valid IBAN, correct one-time code → beneficiary saved and listed.', { 'REQ-02': 1 }, 'pass', 'Karim', 4),
      T('TC-05', 'Reject an invalid IBAN', 'IBAN with a wrong checksum → error message, nothing saved.', { 'REQ-02': 1 }, 'pass', 'Karim', 4),
      T('TC-06', 'Single transfer limit', 'Transfer 5,000 TND → accepted. Transfer 5,001 TND → refused with a clear message.', { 'REQ-03': 1 }, 'pass', 'Karim', 6),
      T('TC-07', 'Daily total limit', 'Send 6,000 TND then 4,000 TND the same day → both accepted (10,000 TND total). A third transfer of 1 TND → refused.', { 'REQ-03': 1 }, 'pass', 'Karim', 6),
      T('TC-08', 'Summary before sending', 'Summary shows amount, fees and beneficiary; nothing is sent before Confirm.', { 'REQ-04': 1 }, 'pass', 'Sofia', 2),
      T('TC-09', 'Receipt sent by email', 'After confirming, the receipt arrives by email within 1 minute.', { 'REQ-04': 1 }, 'blocked', 'Sofia', 2),
      T('TC-10', 'Schedule a transfer for next month', 'Pick a date next month → transfer listed as scheduled and executed on that date.', { 'REQ-05': 1 }, 'pass', 'Sofia', 5),
      T('TC-11', 'Cancel a scheduled transfer the day before', 'Cancel on the day before the date → cancelled. Cancel on the same day → refused.', { 'REQ-05': 1 }, 'notrun', 'Sofia', 9),
      T('TC-12', 'Search history by beneficiary', 'Type part of a beneficiary name → only matching transfers from the last 90 days.', { 'REQ-06': 1 }, 'pass', 'Youssef', 1),
      T('TC-13', 'Export history as PDF', 'Export → PDF contains every transfer shown on screen, with full names.', { 'REQ-06': 1 }, 'fail', 'Youssef', 1),
      T('TC-14', 'Push alert for 3,500 TND to a new beneficiary', 'Beneficiary added yesterday, transfer 3,500 TND → push notification; transfer waits for approval.', { 'REQ-08': 1 }, 'fail', 'Youssef', 1),
      T('TC-15', 'Fees shown for an international transfer', 'Choose a foreign IBAN → fees are displayed before the summary.', {}, 'pass', 'Sofia', 2)
    ];
    const D = (id, title, testId, severity, status, ago) => ({ id, title, testId, severity, status, createdAt: daysAgo(ago) });
    const defects = [
      D('BUG-01', 'Account unlocks after 5 minutes instead of 30', 'TC-03', 'High', 'Open', 3),
      D('BUG-02', 'PDF export cuts long beneficiary names', 'TC-13', 'Medium', 'Open', 1),
      D('BUG-03', 'No push notification on Android 14', 'TC-14', 'Critical', 'Open', 1),
      D('BUG-04', 'SMS code sent twice', 'TC-04', 'Medium', 'Closed', 12)
    ];
    return { reqs, tests, defects };
  }

  let S;
  function load() { try { S = JSON.parse(localStorage.getItem(KEY)); } catch (e) { S = null; } if (!S || !Array.isArray(S.reqs)) S = demo(); }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* private mode: keep in memory */ } }
  function nextId(prefix, list) { const n = list.reduce((m, x) => Math.max(m, parseInt(x.id.split('-')[1], 10) || 0), 0) + 1; return prefix + '-' + String(n).padStart(2, '0'); }

  /* ---------- words ---------- */
  const STOP = new Set('the a an of in on at to for is are be can and or with from by as it its this that than then into not no all any each every their there when after before until under above more less least most up down out over i my we our you your he she they them has have had was were will would should must may into also only same le la les de du des un une et ou en au aux à a est sont pour par sur dans avec sans plus moins que qui ne pas ce ces son sa ses leur client customer'.split(' '));
  const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/(\d)[,\s.](?=\d{3}\b)/g, '$1');
  const words = (s) => norm(s).split(/[^a-z0-9%]+/).filter(Boolean);
  const sig = (w) => !STOP.has(w) && (w.length >= 3 || /\d/.test(w));
  const stem = (w) => (w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w);
  const showW = (w) => (/^\d{4,}$/.test(w) ? Number(w).toLocaleString('en-US') : w);
  const sigSet = (s) => new Set(words(s).filter(sig).map(stem));

  function diffWords(a, b) {
    const A = a.split(/\s+/).filter(Boolean), B = b.split(/\s+/).filter(Boolean);
    const n = A.length, m = B.length, L = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    const eq = (x, y) => norm(x).replace(/[^a-z0-9%]/g, '') === norm(y).replace(/[^a-z0-9%]/g, '') && x.replace(/[.,;:]$/, '') === y.replace(/[.,;:]$/, '');
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = eq(A[i], B[j]) ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    const out = []; let i = 0, j = 0;
    const push = (t, w) => { const last = out[out.length - 1]; if (last && last.t === t) last.w.push(w); else out.push({ t, w: [w] }); };
    while (i < n && j < m) { if (eq(A[i], B[j])) { push('same', B[j]); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) push('del', A[i++]); else push('add', B[j++]); }
    while (i < n) push('del', A[i++]); while (j < m) push('add', B[j++]);
    return out;
  }
  const diffHtml = (d) => d.map((p) => p.t === 'same' ? esc(p.w.join(' ')) : `<${p.t === 'del' ? 'del' : 'ins'}>${esc(p.w.join(' '))}</${p.t === 'del' ? 'del' : 'ins'}>`).join(' ');
  function changedWords(d) {
    const removed = new Set(), added = new Set();
    d.forEach((p) => { if (p.t === 'same') return; p.w.forEach((w) => words(w).filter(sig).forEach((x) => (p.t === 'del' ? removed : added).add(stem(x)))); });
    return { removed, added };
  }

  /* ---------- model queries ---------- */
  const reqById = (id) => S.reqs.find((r) => r.id === id);
  const testById = (id) => S.tests.find((t) => t.id === id);
  const testsOf = (r) => S.tests.filter((t) => t.links[r.id] !== undefined);
  const staleFor = (t, r) => t.links[r.id] !== undefined && t.links[r.id] < r.version;
  const staleReqs = (t) => Object.keys(t.links).map(reqById).filter((r) => r && staleFor(t, r));
  const openDefects = () => S.defects.filter((d) => d.status === 'Open');
  const defectsOfTest = (t) => S.defects.filter((d) => d.testId === t.id);
  const defectsOfReq = (r) => S.defects.filter((d) => { const t = testById(d.testId); return t && t.links[r.id] !== undefined; });

  function reqStatus(r) {
    const ts = testsOf(r);
    if (!ts.length) return ['Not covered', 'bad', 'uncovered'];
    if (ts.some((t) => t.result === 'fail')) return ['Failing', 'bad', 'failing'];
    if (ts.some((t) => staleFor(t, r))) return ['Changed: re-check tests', 'warn', 'stale'];
    if (ts.some((t) => t.result === 'blocked')) return ['Blocked', 'warn', 'blocked'];
    if (ts.some((t) => t.result === 'notrun')) return ['In progress', 'mute', 'partial'];
    return ['Passing', 'ok', 'passing'];
  }

  /* Why a test is stale: which removed words it still mentions. */
  function staleReason(t, r) {
    const lastTextAtTestVersion = (r.history.find((h) => h.v === t.links[r.id]) || r.history[r.history.length - 1] || { text: r.text }).text;
    const d = diffWords(lastTextAtTestVersion, r.text);
    const { removed } = changedWords(d);
    const tw = sigSet(t.title + ' ' + t.steps);
    const hits = [...removed].filter((w) => tw.has(w));
    return { hits, diff: d };
  }

  /* ---------- suggestions (word-matching rules) ---------- */
  function idf() {
    const docs = S.reqs.map((r) => sigSet(r.title + ' ' + r.text));
    const df = new Map(); docs.forEach((s) => s.forEach((w) => df.set(w, (df.get(w) || 0) + 1)));
    return (w) => Math.log(1 + S.reqs.length / (df.get(w) || 1));
  }
  function similarity(t, r, w) {
    const a = sigSet(t.title + ' ' + t.steps), b = sigSet(r.title + ' ' + r.text);
    const shared = [...a].filter((x) => b.has(x));
    return { score: shared.reduce((s, x) => s + w(x), 0), shared };
  }
  function suggestions() {
    const out = []; const w = idf();
    S.tests.filter((t) => !Object.keys(t.links).length).forEach((t) => {
      const best = S.reqs.map((r) => Object.assign({ r }, similarity(t, r, w))).sort((a, b) => b.score - a.score)[0];
      if (best && best.score >= 2) out.push({ kind: 'link', t, r: best.r, text: `<b>${esc(t.id)}</b> isn't linked to any requirement. It looks like it tests <b>${esc(best.r.id)} ${esc(best.r.title)}</b> (shared words: ${best.shared.slice(0, 4).map(esc).join(', ')}).`, action: 'Link them' });
    });
    S.reqs.filter((r) => !testsOf(r).length).forEach((r) => {
      const n = draftsFor(r).length;
      if (n) out.push({ kind: 'draft', r, text: `<b>${esc(r.id)} ${esc(r.title)}</b> has no test. I can draft ${n} test${n > 1 ? 's' : ''}, one per acceptance criterion.`, action: `Draft ${n} test${n > 1 ? 's' : ''}` });
    });
    return out.slice(0, 6);
  }
  function draftsFor(r) {
    return r.text.split(/(?<=[.!?])\s+/).map((s) => s.trim().replace(/[.!?]+$/, '')).filter((s) => s.length > 12 && !/^(as an? |en tant que)/i.test(s))
      .slice(0, 4).map((s) => 'Check: ' + s.charAt(0).toLowerCase() + s.slice(1));
  }

  /* ---------- readiness ---------- */
  function readiness() {
    const reasons = []; let level = 'yes';
    const crit = openDefects().filter((d) => d.severity === 'Critical' || d.severity === 'High');
    if (crit.length) { level = 'no'; reasons.push(`${crit.length} open critical or high defect${crit.length > 1 ? 's' : ''}: ${crit.map((d) => `<button type="button" class="id" data-open-def="${esc(d.id)}">${esc(d.id)}</button> ${esc(d.title)}`).join('; ')}`); }
    const hiFail = S.reqs.filter((r) => r.priority === 'High' && reqStatus(r)[2] === 'failing');
    if (hiFail.length) { level = 'no'; reasons.push(`High-priority requirement${hiFail.length > 1 ? 's' : ''} failing: ${hiFail.map((r) => esc(r.id)).join(', ')}`); }
    const hiGap = S.reqs.filter((r) => r.priority === 'High' && !testsOf(r).length);
    if (hiGap.length) { level = 'no'; reasons.push(`High-priority requirement${hiGap.length > 1 ? 's' : ''} with no test: ${hiGap.map((r) => esc(r.id)).join(', ')}`); }
    const stale = S.tests.filter((t) => staleReqs(t).length);
    if (stale.length) { if (level === 'yes') level = 'maybe'; reasons.push(`${stale.length} test${stale.length > 1 ? 's were' : ' was'} written for an older version of a requirement. ${stale.length > 1 ? 'Their' : 'Its'} "pass" may no longer mean anything.`); }
    const gap = S.reqs.filter((r) => r.priority !== 'High' && !testsOf(r).length);
    if (gap.length) { if (level === 'yes') level = 'maybe'; reasons.push(`${gap.length} requirement${gap.length > 1 ? 's' : ''} not covered: ${gap.map((r) => esc(r.id)).join(', ')}`); }
    const pending = S.tests.filter((t) => t.result === 'blocked' || t.result === 'notrun' || t.result === 'fail');
    const otherFail = pending.filter((t) => !Object.keys(t.links).some((id) => (reqById(id) || {}).priority === 'High'));
    if (otherFail.length) { if (level === 'yes') level = 'maybe'; reasons.push(`${otherFail.length} other test${otherFail.length > 1 ? 's' : ''} failing, blocked or not run yet`); }
    return { level, reasons };
  }

  /* ---------- rendering ---------- */
  function renderAll() { renderOverview(); renderMatrix(); renderReqs(); renderTests(); renderDefects(); const n = S.tests.filter((t) => staleReqs(t).length).length; $('#staleBadge').textContent = n; $('#staleBadge').hidden = !n; }

  function renderOverview() {
    const cov = S.reqs.length ? Math.round(S.reqs.filter((r) => testsOf(r).length).length / S.reqs.length * 100) : 0;
    const pass = S.tests.length ? Math.round(S.tests.filter((t) => t.result === 'pass').length / S.tests.length * 100) : 0;
    const stale = S.tests.filter((t) => staleReqs(t).length).length;
    const open = openDefects().length;
    $('#kpis').innerHTML = [
      ['Requirements covered', cov + '<small>%</small>', `${S.reqs.filter((r) => testsOf(r).length).length} of ${S.reqs.length} have a test`, ''],
      ['Tests passing', pass + '<small>%</small>', `${S.tests.filter((t) => t.result === 'pass').length} of ${S.tests.length}`, ''],
      ['Stale tests', stale, 'requirement changed since', stale ? 'alert' : ''],
      ['Open defects', open, `${openDefects().filter((d) => d.severity === 'Critical').length} critical`, open ? '' : '']
    ].map(([l, v, s, c]) => `<div class="kpi ${c}"><span class="k-label">${l}</span><span class="k-val">${v}</span><span class="k-sub">${s}</span></div>`).join('');

    const R = readiness();
    const title = { no: 'Not ready to release', maybe: 'Ready with known risks', yes: 'Ready to release' }[R.level];
    $('#readyPanel').innerHTML = `<div class="verdict ${R.level}"><span class="dot" aria-hidden="true">${R.level === 'yes' ? '✓' : R.level === 'maybe' ? '!' : '×'}</span><div><span class="k-label hint">Release 2.4 readiness</span><h2>${title}</h2></div></div>
      ${R.reasons.length ? `<ul class="reasons">${R.reasons.map((x) => `<li>${x}</li>`).join('')}</ul>` : '<p>Every requirement is covered, every test passes, and nothing is stale.</p>'}`;

    const items = [];
    S.tests.forEach((t) => staleReqs(t).forEach((r) => { const why = staleReason(t, r); items.push({ p: why.hits.length ? 0 : 2, html: `<span class="txt"><b>${esc(t.id)}</b> ${esc(t.title)}<small>${why.hits.length ? `Mentions <b>${why.hits.map(showW).map(esc).join(', ')}</b>, which ${r.id} no longer says` : `${esc(r.id)} changed; wording of this test looks unaffected`}</small></span><button type="button" class="link-btn" data-goto-test="${esc(t.id)}">Review</button>` }); }));
    S.tests.filter((t) => t.result === 'fail' && !defectsOfTest(t).some((d) => d.status === 'Open')).forEach((t) => items.push({ p: 1, html: `<span class="txt"><b>${esc(t.id)}</b> ${esc(t.title)}<small>Failing, but no defect logged</small></span><button type="button" class="link-btn" data-log="${esc(t.id)}">Log defect</button>` }));
    S.reqs.filter((r) => !testsOf(r).length).forEach((r) => items.push({ p: 1, html: `<span class="txt"><b>${esc(r.id)}</b> ${esc(r.title)}<small>No test covers it</small></span><button type="button" class="link-btn" data-draft="${esc(r.id)}">Draft tests</button>` }));
    items.sort((a, b) => a.p - b.p);
    $('#attention').innerHTML = items.map((x) => `<li>${x.html}</li>`).join('') || '<li class="empty">Nothing needs attention.</li>';

    const sug = suggestions();
    $('#suggestions').innerHTML = sug.map((s, i) => `<li><span class="txt">${s.text}</span><button type="button" class="btn btn-line" data-sug="${i}">${esc(s.action)}</button></li>`).join('') || '<li class="empty">No suggestions right now.</li>';
    $$('#suggestions [data-sug]').forEach((b) => b.addEventListener('click', () => {
      const s = sug[+b.dataset.sug];
      if (s.kind === 'link') { s.t.links[s.r.id] = s.r.version; toast(`${s.t.id} now covers ${s.r.id}`); }
      else draftTests(s.r);
      save(); renderAll();
    }));
  }

  function draftTests(r) {
    const titles = draftsFor(r);
    titles.forEach((title) => S.tests.push({ id: nextId('TC', S.tests), title, steps: 'Drafted from ' + r.id + '. Add steps and the expected result.', links: { [r.id]: r.version }, result: 'notrun', owner: '', runAt: '' }));
    toast(`${titles.length} draft test${titles.length > 1 ? 's' : ''} added for ${r.id}`);
  }

  function renderMatrix() {
    const host = $('#heat');
    if (!S.reqs.length) { host.innerHTML = '<p class="empty">Add a requirement to start the matrix.</p>'; return; }
    const order = [];
    S.reqs.forEach((r) => testsOf(r).forEach((t) => { if (!order.includes(t)) order.push(t); }));
    S.tests.forEach((t) => { if (!order.includes(t)) order.push(t); });
    const feats = [...new Set(S.reqs.map((r) => r.feature || 'Other'))];
    let rows = '';
    feats.forEach((f) => {
      rows += `<tr class="feat"><th colspan="${order.length + 2}">${esc(f)}</th></tr>`;
      S.reqs.filter((r) => (r.feature || 'Other') === f).forEach((r) => {
        const st = reqStatus(r);
        const nd = defectsOfReq(r).filter((d) => d.status === 'Open').length;
        rows += `<tr class="${st[2] === 'uncovered' ? 'gap' : ''}"><th class="rq" scope="row"><button type="button" data-open-req="${esc(r.id)}"><span class="id">${esc(r.id)}</span><b>${esc(r.title)}</b></button></th>` +
          order.map((t) => {
            if (t.links[r.id] === undefined) return '<td class="c"><span class="cell none"></span></td>';
            const stale = staleFor(t, r);
            return `<td class="c"><button type="button" class="cell ${t.result}${stale ? ' is-stale' : ''}" data-open-test="${esc(t.id)}" title="${esc(t.id + ' · ' + RESULT[t.result] + (stale ? ' · stale' : ''))}" aria-label="${esc(t.id + ' ' + RESULT[t.result] + (stale ? ', stale' : ''))}"></button></td>`;
          }).join('') + `<td class="st"><span class="pill ${st[1]}">${st[0]}</span>${nd ? ` <span class="hint">${nd} open defect${nd > 1 ? 's' : ''}</span>` : ''}</td></tr>`;
      });
    });
    host.innerHTML = `<table class="heat"><thead><tr><th></th>${order.map((t) => `<th scope="col"><span>${esc(t.id)}</span></th>`).join('')}<th></th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  function tchip(t, r) {
    const stale = r && staleFor(t, r);
    return `<button type="button" class="tchip${stale ? ' stale' : ''}" data-open-test="${esc(t.id)}" title="${esc(t.title + ' · ' + RESULT[t.result] + (stale ? ' · stale' : ''))}"><i style="background:${COLORS[t.result]}"></i>${esc(t.id)}</button>`;
  }
  function renderReqs() {
    const f = $('#reqFilter').value;
    const list = S.reqs.filter((r) => f === 'all' || reqStatus(r)[2] === f || (f === 'stale' && testsOf(r).some((t) => staleFor(t, r))));
    $('#reqList').innerHTML = list.map((r) => {
      const st = reqStatus(r); const ts = testsOf(r);
      const last = r.history[r.history.length - 1];
      return `<article class="rcard" id="card-${esc(r.id)}"><div class="head"><span class="id">${esc(r.id)} · v${r.version} · ${esc(r.feature || '')}</span><span class="meta"><span class="pill ${esc(r.priority)}">${esc(r.priority)}</span><span class="pill ${st[1]}">${st[0]}</span></span></div>
        <h3>${esc(r.title)}</h3><p class="text">${esc(r.text)}</p>
        ${last ? `<div class="change"><b>Changed on ${esc(last.at)} (v${last.v} → v${r.version})</b>${diffHtml(diffWords(last.text, r.text))}</div>` : ''}
        <div class="foot-row"><div class="tchips">${ts.map((t) => tchip(t, r)).join('') || '<span class="hint">No tests yet</span>'}</div>
        <span>${ts.length ? '' : `<button type="button" class="link-btn" data-draft="${esc(r.id)}">Draft tests</button>`}<button type="button" class="btn btn-line" data-open-req="${esc(r.id)}">Edit</button></span></div></article>`;
    }).join('') || '<p class="empty">Nothing matches this filter.</p>';
  }

  function renderTests() {
    const f = $('#testFilter').value;
    const list = S.tests.filter((t) => f === 'all' || (f === 'stale' && staleReqs(t).length) || (f === 'fail' && (t.result === 'fail' || t.result === 'blocked')) || (f === 'orphan' && !Object.keys(t.links).length));
    $('#testList').innerHTML = list.map((t) => {
      const sr = staleReqs(t);
      const notes = sr.map((r) => { const w = staleReason(t, r); return `<div class="stale-note"><b>${esc(r.id)} changed</b> after this test was written (v${t.links[r.id]} → v${r.version}). ${w.hits.length ? `This test still mentions <mark>${w.hits.map(showW).map(esc).join('</mark>, <mark>')}</mark>, which the requirement no longer says: <b>very likely out of date.</b>` : 'Its wording doesn’t mention anything that was removed: a quick review is probably enough.'} <span class="hint">Change: ${diffHtml(w.diff.filter((p) => p.t !== 'same'))}</span></div>`; }).join('');
      const defs = defectsOfTest(t);
      const needsDef = t.result === 'fail' && !defs.some((d) => d.status === 'Open');
      return `<div class="trow2${sr.length ? ' stale' : ''}" id="test-${esc(t.id)}"><span class="id">${esc(t.id)}</span>
        <div class="main"><button type="button" class="title" data-open-test="${esc(t.id)}">${esc(t.title)}</button>
          <span class="sub">${Object.keys(t.links).map((id) => `<span class="pill mute">${esc(id)}</span>`).join('') || '<span class="pill warn">No requirement</span>'}${defs.map((d) => `<button type="button" class="id" data-open-def="${esc(d.id)}">${esc(d.id)}${d.status !== 'Open' ? ' (' + esc(d.status.toLowerCase()) + ')' : ''}</button>`).join(' ')}${t.owner ? ` · ${esc(t.owner)}` : ''}${t.runAt ? ` · run ${esc(t.runAt)}` : ''}</span></div>
        <div class="acts">${sr.length ? `<button type="button" class="btn btn-line" data-reviewed="${esc(t.id)}">Mark as reviewed</button>` : ''}${needsDef ? `<button type="button" class="link-btn" data-log="${esc(t.id)}">Log defect</button>` : ''}
          <label class="sr" for="res-${esc(t.id)}">Result of ${esc(t.id)}</label><select id="res-${esc(t.id)}" data-result="${esc(t.id)}">${Object.entries(RESULT).map(([k, v]) => `<option value="${k}"${k === t.result ? ' selected' : ''}>${v}</option>`).join('')}</select></div>
        ${notes}</div>`;
    }).join('') || '<p class="empty">Nothing matches this filter.</p>';
  }

  function renderDefects() {
    const order = { Open: 0, Fixed: 1, Closed: 2 }, sev = { Critical: 0, High: 1, Medium: 2, Low: 3 };
    const list = S.defects.slice().sort((a, b) => order[a.status] - order[b.status] || sev[a.severity] - sev[b.severity]);
    $('#defectList').innerHTML = list.map((d) => {
      const t = testById(d.testId);
      return `<div class="trow2"><span class="id">${esc(d.id)}</span><div class="main"><button type="button" class="title" data-open-def="${esc(d.id)}">${esc(d.title)}</button>
        <span class="sub"><span class="pill ${esc(d.severity)}">${esc(d.severity)}</span>${t ? `found by <button type="button" class="id" data-open-test="${esc(t.id)}">${esc(t.id)}</button> · ${Object.keys(t.links).map(esc).join(', ') || 'no requirement'}` : ''} · logged ${esc(d.createdAt)}</span></div>
        <div class="acts"><label class="sr" for="ds-${esc(d.id)}">Status of ${esc(d.id)}</label><select id="ds-${esc(d.id)}" data-dstatus="${esc(d.id)}">${['Open', 'Fixed', 'Closed'].map((s) => `<option${s === d.status ? ' selected' : ''}>${s}</option>`).join('')}</select></div></div>`;
    }).join('') || '<p class="empty">No defects logged.</p>';
  }

  /* ---------- tabs and global clicks ---------- */
  function show(tab) {
    $$('.tabs [role=tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    $$('.view').forEach((v) => { v.hidden = v.id !== 'view-' + tab; });
  }
  $$('.tabs [role=tab]').forEach((b) => b.addEventListener('click', () => show(b.dataset.tab)));
  $('#reqFilter').addEventListener('change', renderReqs);
  $('#testFilter').addEventListener('change', renderTests);

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-open-req],[data-open-test],[data-open-def],[data-draft],[data-log],[data-reviewed],[data-goto-test]');
    if (!el) return;
    if (el.dataset.openReq) openReq(reqById(el.dataset.openReq));
    else if (el.dataset.openTest) openTest(testById(el.dataset.openTest));
    else if (el.dataset.openDef) openDef(S.defects.find((d) => d.id === el.dataset.openDef));
    else if (el.dataset.draft) { draftTests(reqById(el.dataset.draft)); save(); renderAll(); }
    else if (el.dataset.log) openDef(null, el.dataset.log);
    else if (el.dataset.reviewed) { const t = testById(el.dataset.reviewed); staleReqs(t).forEach((r) => { t.links[r.id] = r.version; }); save(); renderAll(); toast(`${t.id} marked as up to date`); }
    else if (el.dataset.gotoTest) { $('#testFilter').value = 'stale'; renderTests(); show('tests'); const row = document.getElementById('test-' + el.dataset.gotoTest); if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  });
  document.addEventListener('change', (e) => {
    const r = e.target.dataset.result, d = e.target.dataset.dstatus;
    if (r) { const t = testById(r); t.result = e.target.value; t.runAt = today(); save(); renderAll(); toast(`${t.id}: ${RESULT[t.result]}${t.result === 'fail' ? '. Log a defect from the row.' : ''}`); }
    if (d) { const x = S.defects.find((y) => y.id === d); x.status = e.target.value; save(); renderAll(); toast(`${x.id} is now ${x.status.toLowerCase()}`); }
  });

  /* ---------- dialogs ---------- */
  let editing = null;
  function openReq(r) {
    editing = r; const f = $('#reqForm');
    $('#reqTitle').textContent = r ? `${r.id} · v${r.version}` : 'New requirement';
    f.title.value = r ? r.title : ''; f.text.value = r ? r.text : ''; f.feature.value = r ? r.feature : ''; f.priority.value = r ? r.priority : 'Medium';
    $('#reqVersionHint').textContent = r && testsOf(r).length ? `Changing the text creates v${r.version + 1}. The ${testsOf(r).length} linked test${testsOf(r).length > 1 ? 's' : ''} will be flagged until someone reviews them.` : '';
    $('#reqDelete').hidden = !r;
    $('#reqDialog').showModal();
  }
  $('#reqForm').addEventListener('submit', (e) => {
    const f = e.target;
    const data = { title: f.title.value.trim(), text: f.text.value.trim().replace(/\s+/g, ' '), feature: f.feature.value.trim(), priority: f.priority.value };
    if (!data.title || !data.text) { e.preventDefault(); return; }
    if (editing) {
      const old = editing.text;
      Object.assign(editing, { title: data.title, feature: data.feature, priority: data.priority });
      if (old !== data.text) {
        editing.history.push({ v: editing.version, text: old, at: today() });
        editing.version++; editing.text = data.text;
        save(); renderAll(); showImpact(editing, old);
        return;
      }
    } else S.reqs.push(Object.assign({ id: nextId('REQ', S.reqs), version: 1, history: [], createdAt: today() }, data));
    save(); renderAll(); toast('Saved');
  });
  $('#reqCancel').addEventListener('click', () => $('#reqDialog').close());
  $('#reqDelete').addEventListener('click', () => {
    if (!editing || !confirm(`Delete ${editing.id}? Tests stay, but lose this link.`)) return;
    S.tests.forEach((t) => delete t.links[editing.id]);
    S.reqs = S.reqs.filter((r) => r !== editing); save(); renderAll(); $('#reqDialog').close();
  });

  function showImpact(r, oldText) {
    const d = diffWords(oldText, r.text);
    const { removed, added } = changedWords(d);
    const ts = testsOf(r);
    const rows = ts.map((t) => { const tw = sigSet(t.title + ' ' + t.steps); const hits = [...removed].filter((w) => tw.has(w)); return { t, hits }; }).sort((a, b) => b.hits.length - a.hits.length);
    $('#impactBody').innerHTML = `<p><b>${esc(r.id)} ${esc(r.title)}</b> is now v${r.version}.</p><div class="diff">${diffHtml(d)}</div>
      ${removed.size || added.size ? `<p class="hint">${removed.size ? `Removed: <b>${[...removed].map(showW).map(esc).join(', ')}</b>. ` : ''}${added.size ? `Added: <b>${[...added].map(showW).map(esc).join(', ')}</b>.` : ''}</p>` : ''}
      ${ts.length ? `<h3>${ts.length} linked test${ts.length > 1 ? 's are' : ' is'} now flagged as stale</h3><ul>${rows.map(({ t, hits }) => `<li><b>${esc(t.id)}</b> ${esc(t.title)}: ${hits.length ? `<span style="color:#a23b1c">very likely out of date</span> (still mentions ${hits.map(showW).map(esc).join(', ')})` : 'wording unaffected, quick review'}</li>`).join('')}</ul>` : '<p>No test is linked to this requirement yet, so nothing went stale. It still needs a test.</p>'}
      ${added.size && ts.length ? `<p class="hint">New words (${[...added].slice(0, 5).map(showW).map(esc).join(', ')}) may need new tests: no existing test mentions them.</p>` : ''}`;
    $('#impactDialog').showModal();
  }
  $('#impactClose').addEventListener('click', () => { $('#impactDialog').close(); $('#testFilter').value = 'stale'; renderTests(); show('tests'); });

  function openTest(t) {
    editing = t; const f = $('#testForm');
    $('#testTitle').textContent = t ? t.id : 'New test';
    f.title.value = t ? t.title : ''; f.steps.value = t ? t.steps : ''; f.result.value = t ? t.result : 'notrun'; f.owner.value = t ? t.owner : '';
    $('#testReqs').innerHTML = S.reqs.map((r) => `<label><input type="checkbox" value="${esc(r.id)}"${t && t.links[r.id] !== undefined ? ' checked' : ''}> <span class="id">${esc(r.id)}</span> ${esc(r.title)}${t && staleFor(t, r) ? ' <span class="pill warn">stale</span>' : ''}</label>`).join('') || '<p class="hint">No requirements yet.</p>';
    $('#testDelete').hidden = !t;
    $('#testDialog').showModal();
  }
  $('#testForm').addEventListener('submit', (e) => {
    const f = e.target;
    const links = {};
    $$('#testReqs input:checked').forEach((c) => { const r = reqById(c.value); links[r.id] = r.version; }); // saving a test = it was reviewed against today's wording
    const data = { title: f.title.value.trim(), steps: f.steps.value.trim(), result: f.result.value, owner: f.owner.value.trim(), links };
    if (!data.title) { e.preventDefault(); return; }
    if (editing) { if (editing.result !== data.result) data.runAt = today(); Object.assign(editing, data); }
    else S.tests.push(Object.assign({ id: nextId('TC', S.tests), runAt: data.result === 'notrun' ? '' : today() }, data));
    save(); renderAll(); toast('Saved');
  });
  $('#testCancel').addEventListener('click', () => $('#testDialog').close());
  $('#testDelete').addEventListener('click', () => { if (!editing || !confirm(`Delete ${editing.id}?`)) return; S.tests = S.tests.filter((t) => t !== editing); save(); renderAll(); $('#testDialog').close(); });

  function openDef(d, testId) {
    editing = d; const f = $('#defForm');
    $('#defTitle').textContent = d ? d.id : 'New defect';
    $('#defTest').innerHTML = '<option value="">None</option>' + S.tests.map((t) => `<option value="${esc(t.id)}">${esc(t.id)} · ${esc(t.title.slice(0, 50))}</option>`).join('');
    f.title.value = d ? d.title : ''; f.testId.value = d ? d.testId : (testId || ''); f.severity.value = d ? d.severity : 'Medium'; f.status.value = d ? d.status : 'Open';
    $('#defDelete').hidden = !d;
    $('#defDialog').showModal();
    if (!d) f.title.focus();
  }
  $('#defForm').addEventListener('submit', (e) => {
    const f = e.target;
    const data = { title: f.title.value.trim(), testId: f.testId.value, severity: f.severity.value, status: f.status.value };
    if (!data.title) { e.preventDefault(); return; }
    if (editing) Object.assign(editing, data); else S.defects.push(Object.assign({ id: nextId('BUG', S.defects), createdAt: today() }, data));
    save(); renderAll(); toast('Saved');
  });
  $('#defCancel').addEventListener('click', () => $('#defDialog').close());
  $('#defDelete').addEventListener('click', () => { if (!editing || !confirm(`Delete ${editing.id}?`)) return; S.defects = S.defects.filter((x) => x !== editing); save(); renderAll(); $('#defDialog').close(); });

  $('#addReq').addEventListener('click', () => openReq(null));
  $('#addTest').addEventListener('click', () => openTest(null));
  $('#addDefect').addEventListener('click', () => openDef(null));
  $('#resetDemo').addEventListener('click', () => { if (!confirm('Replace everything with the demo release?')) return; S = demo(); save(); renderAll(); show('overview'); toast('Demo restored'); });
  $('#clearAll').addEventListener('click', () => { if (!confirm('Delete all requirements, tests and defects in this browser?')) return; S = { reqs: [], tests: [], defects: [] }; save(); renderAll(); toast('Empty. Start with + Requirement'); });

  $('#exportCsv').addEventListener('click', () => {
    const q = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const lines = [['Requirement', 'Title', 'Version', 'Priority', 'Status', 'Test', 'Test title', 'Result', 'Stale', 'Defects'].map(q).join(',')];
    S.reqs.forEach((r) => {
      const ts = testsOf(r); const st = reqStatus(r)[0];
      if (!ts.length) lines.push([r.id, r.title, r.version, r.priority, st, '', '', '', '', ''].map(q).join(','));
      ts.forEach((t) => lines.push([r.id, r.title, r.version, r.priority, st, t.id, t.title, RESULT[t.result], staleFor(t, r) ? 'yes' : 'no', defectsOfTest(t).map((d) => d.id + ' (' + d.status + ')').join(' ')].map(q).join(',')));
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv' }));
    a.download = 'traceability-matrix.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });

  /* ---------- guided tour ---------- */
  $$('[data-tour]').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.tour;
    if (k === 'change') {
      const r = reqById('REQ-05') || S.reqs[0]; if (!r) return toast('Add a requirement first');
      openReq(r);
      const ta = $('#reqForm').text, phrase = 'the day before';
      const i = ta.value.indexOf(phrase);
      if (i >= 0) { ta.value = ta.value.replace(phrase, '2 hours before'); ta.focus(); ta.setSelectionRange(i, i + 14); }
      toast(i >= 0 ? 'I changed "the day before" to "2 hours before". Press Save to see the impact.' : 'Edit the text, then Save');
    } else if (k === 'ready') { show('overview'); const p = $('#readyPanel'); p.scrollIntoView({ behavior: 'smooth', block: 'center' }); p.classList.remove('flash'); void p.offsetWidth; p.classList.add('rcard', 'flash'); }
    else if (k === 'gaps') { $('#reqFilter').value = 'uncovered'; renderReqs(); show('reqs'); $('#reqList').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  }));

  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 3200); }

  load(); renderAll();
})();

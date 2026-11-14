(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const KEY = 'hiring-desk-v1';
  const STAGES = ['Applied', 'Screening', 'Interview', 'Offer', 'Hired', 'Rejected'];
  const ACTIVE = ['Applied', 'Screening', 'Interview', 'Offer'];
  const DAY = 86400000;

  /* ---------- helpers ---------- */
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Math.random().toString(36).slice(2, 10);
  const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
  const iso = (d) => { const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return z.toISOString().slice(0, 10); };
  const plus = (n) => iso(new Date(today().getTime() + n * DAY));
  const daysFrom = (s) => s ? Math.round((new Date(s + 'T00:00:00').getTime() - today().getTime()) / DAY) : null;
  const splitSkills = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);
  const norm = (s) => s.toLowerCase();
  const stars = (n) => n ? '★'.repeat(n) + '<span style="opacity:.25">' + '★'.repeat(5 - n) + '</span>' : '';
  function whenLabel(s) {
    const d = daysFrom(s);
    if (d === null) return '';
    if (d < 0) return `<span class="when over">${-d} day${d === -1 ? '' : 's'} late</span>`;
    if (d === 0) return '<span class="when today">Today</span>';
    if (d === 1) return '<span class="when soon">Tomorrow</span>';
    return `<span class="when soon">In ${d} days</span>`;
  }
  function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2200);
  }

  /* ---------- demo data (fictional) ---------- */
  function demo() {
    const P = (title, team, location, needed, priority, skills, target, status) =>
      ({ id: uid(), title, team, location, needed, priority, status: status || 'Open', skills, target: plus(target), opened: plus(-30) });
    const positions = [
      P('QA Test Engineer', 'Product', 'Paris · Hybrid', 2, 'High', ['Selenium', 'Test automation', 'SQL', 'Jira', 'API testing'], 30),
      P('Business Consultant', 'Advisory', 'Tunis', 1, 'Medium', ['Process mapping', 'Excel', 'Stakeholder management', 'Power BI'], 45),
      P('Data Analyst', 'Finance', 'Remote', 1, 'High', ['SQL', 'Power BI', 'Python', 'Excel'], 21),
      P('HR Assistant', 'People', 'Lyon', 1, 'Low', ['Recruiting', 'Onboarding', 'Excel'], 60, 'On hold')
    ];
    const [qa, bc, da, hr] = positions.map((p) => p.id);
    const C = (name, positionId, stage, skills, rating, source, follow, last, notes, since, addedAgo) => {
      const added = plus(addedAgo || last - 3), stageSince = plus(since || last);
      const history = [{ d: added, t: 'Applied via ' + source }];
      if (stage !== 'Applied') history.push({ d: stageSince, t: 'Moved to ' + stage });
      return { id: uid(), name, email: name.toLowerCase().replace(/[^a-z]+/g, '.') + '@example.com', positionId, stage, skills, rating, source,
        followUp: follow === null ? '' : plus(follow), lastContact: plus(last), notes: notes || '', added, stageSince, history,
        hiredOn: stage === 'Hired' ? stageSince : '' };
    };
    const candidates = [
      C('Lina Haddad', qa, 'Interview', ['Selenium', 'Test automation', 'Java', 'Jira'], 4, 'LinkedIn', 0, -6, 'Strong on automation. Second interview with the tech lead.'),
      C('Omar Ferchichi', qa, 'Screening', ['Manual testing', 'Jira', 'SQL'], 3, 'Job board', -2, -9, 'Waiting for availability dates.', -19, -24),
      C('Julie Martin', qa, 'Offer', ['Selenium', 'API testing', 'SQL', 'Postman', 'Test automation'], 5, 'Referral', 1, -2, 'Offer sent, expecting answer this week.', -2, -27),
      C('Karim Ben Ali', qa, 'Applied', ['Cypress', 'JavaScript', 'API testing'], 0, 'Website', 3, -1),
      C('Sofia Rossi', bc, 'Interview', ['Process mapping', 'Excel', 'Change management'], 4, 'LinkedIn', -1, -8, 'Case study to review.'),
      C('Thomas Leroy', bc, 'Screening', ['Stakeholder management', 'Power BI', 'Excel'], 3, 'Agency', 2, -4),
      C('Amira Trabelsi', da, 'Interview', ['SQL', 'Python', 'Power BI', 'Excel'], 5, 'LinkedIn', 0, -5, 'Excellent technical test.'),
      C('Hugo Bernard', da, 'Applied', ['Excel', 'Tableau'], 2, 'Job board', 4, -1),
      C('Nadia Saidi', da, 'Rejected', ['SQL', 'Python', 'Statistics'], 3, 'Website', null, -40, 'Great profile, chose another offer. Keep for future roles.'),
      C('Paul Garnier', qa, 'Hired', ['Selenium', 'Test automation', 'SQL', 'Jira'], 5, 'Referral', null, -20, 'Started last month.', -20, -52),
      C('Ines Mansour', bc, 'Rejected', ['Process mapping', 'Power BI', 'Agile'], 4, 'LinkedIn', null, -60, 'Too junior then, worth re-contacting.'),
      C('Leo Dubois', hr, 'Applied', ['Recruiting', 'Onboarding'], 0, 'Website', null, -12, '', -16, -16),
      C('Yasmine Gharbi', da, 'Screening', ['SQL', 'Excel', 'Power BI'], 3, 'Referral', -4, -11, 'Chase for references.')
    ];
    return { positions, candidates };
  }

  /* ---------- storage ---------- */
  let db;
  function load() {
    try { const raw = localStorage.getItem(KEY); if (raw) { const d = JSON.parse(raw); if (d && d.positions && d.candidates) db = d; } } catch (e) { /* ignore */ }
    if (!db) db = demo();
    db.candidates.forEach((c) => {
      if (!c.stageSince) c.stageSince = c.lastContact || c.added || iso(today());
      if (!Array.isArray(c.history)) c.history = [];
      if (!Array.isArray(c.skills)) c.skills = splitSkills(c.skills);
    });
    save();
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { /* storage unavailable: keep in memory */ } }
  const posById = (id) => db.positions.find((p) => p.id === id);
  const posTitle = (id) => (posById(id) || {}).title || 'No position';

  /* ---------- tabs ---------- */
  let tab = 'dashboard';
  function setTab(t) {
    tab = t;
    document.querySelectorAll('.tabs [role=tab]').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === t));
    document.querySelectorAll('.view').forEach((v) => { v.hidden = v.id !== 'view-' + t; });
    render();
  }

  /* ---------- renderers ---------- */
  function renderDashboard() {
    const open = db.positions.filter((p) => p.status === 'Open');
    const needed = open.reduce((s, p) => s + Math.max(0, p.needed - hiredFor(p.id)), 0);
    const active = db.candidates.filter((c) => ACTIVE.includes(c.stage));
    const overdue = active.filter((c) => c.followUp && daysFrom(c.followUp) < 0).length;
    const dueToday = active.filter((c) => c.followUp && daysFrom(c.followUp) === 0).length;
    const hired = db.candidates.filter((c) => c.stage === 'Hired').length;
    $('kpis').innerHTML = `
      <div class="kpi dark"><span class="k-label">Open positions</span><span class="k-val">${open.length}</span><span class="k-sub">${needed} people still to hire</span></div>
      <div class="kpi"><span class="k-label">Active candidates</span><span class="k-val">${active.length}</span><span class="k-sub">${db.candidates.filter((c) => c.stage === 'Interview').length} in interview · ${active.filter(isStuck).length} stuck</span></div>
      <div class="kpi ${overdue ? 'alert' : ''}"><span class="k-label">Follow-ups</span><span class="k-val">${overdue + dueToday}</span><span class="k-sub">${overdue} late · ${dueToday} today</span></div>
      <div class="kpi"><span class="k-label">Hired</span><span class="k-val">${hired}</span><span class="k-sub">${avgDaysToHire() === null ? db.candidates.length + ' people in your talent pool' : 'in ' + avgDaysToHire() + ' days on average'}</span></div>`;

    const srcs = {};
    db.candidates.forEach((c) => { const s = srcs[c.source] || (srcs[c.source] = { n: 0, adv: 0, hired: 0 }); s.n++; if (['Interview', 'Offer', 'Hired'].includes(c.stage)) s.adv++; if (c.stage === 'Hired') s.hired++; });
    const smax = Math.max(1, ...Object.values(srcs).map((x) => x.n));
    $('sources').innerHTML = Object.entries(srcs).sort((a, b) => b[1].n - a[1].n).map(([k, v]) =>
      `<div class="f-row src"><span>${esc(k)}</span><div class="f-bar"><span style="width:${(v.n / smax) * 100}%"></span><span class="adv" style="width:${(v.adv / smax) * 100}%"></span></div><b>${v.n}</b></div>`
    ).join('') || '<p class="empty">No candidates yet.</p>';

    const stuck = db.candidates.filter(isStuck).sort((a, b) => inStage(b) - inStage(a));
    $('stuckList').innerHTML = stuck.length ? stuck.map((c) =>
      `<li><span><button type="button" class="link-btn" data-open="${c.id}" style="padding:0;min-height:0">${esc(c.name)}</button><br><small style="color:var(--soft)">${esc(posTitle(c.positionId))} · ${esc(c.stage)}</small></span><span class="when over">${inStage(c)} days in ${esc(c.stage)}</span></li>`
    ).join('') : '<li class="empty">Nobody stuck. Everything is moving.</li>';

    const max = Math.max(1, ...STAGES.map((s) => db.candidates.filter((c) => c.stage === s).length));
    $('funnel').innerHTML = STAGES.map((s) => {
      const n = db.candidates.filter((c) => c.stage === s).length;
      return `<div class="f-row ${s.toLowerCase()}"><span>${s}</span><div class="f-bar"><span style="width:${(n / max) * 100}%"></span></div><b>${n}</b></div>`;
    }).join('');

    const due = active.filter((c) => c.followUp && daysFrom(c.followUp) <= 2).sort((a, b) => a.followUp.localeCompare(b.followUp)).slice(0, 6);
    $('dueSoon').innerHTML = due.length ? due.map((c) =>
      `<li><span><button type="button" class="link-btn" data-open="${c.id}" style="padding:0;min-height:0">${esc(c.name)}</button><br><small style="color:var(--soft)">${esc(posTitle(c.positionId))} · ${esc(c.stage)}</small></span>${whenLabel(c.followUp)}</li>`
    ).join('') : '<li class="empty">Nothing due. Nice.</li>';

    const list = db.positions.filter((p) => p.status !== 'Filled').sort((a, b) => ['High', 'Medium', 'Low'].indexOf(a.priority) - ['High', 'Medium', 'Low'].indexOf(b.priority));
    $('needs').innerHTML = list.length ? list.map((p) => {
      const h = hiredFor(p.id), pct = Math.min(100, (h / p.needed) * 100);
      const inPipe = db.candidates.filter((c) => c.positionId === p.id && ACTIVE.includes(c.stage)).length;
      const dd = daysFrom(p.target);
      return `<div class="need">
        <div><div class="need-title">${esc(p.title)} <span class="pill ${p.status === 'On hold' ? 'hold' : esc(p.priority)}">${p.status === 'On hold' ? 'On hold' : esc(p.priority)}</span></div>
          <div class="need-meta">${esc(p.team)} · ${inPipe} in pipeline${p.target ? ' · ' + (dd < 0 ? `target passed ${-dd} days ago` : `target in ${dd} days`) : ''}</div></div>
        <div class="progress-wrap"><div class="progress" aria-hidden="true"><span style="width:${pct}%"></span></div></div>
        <div class="need-count">${h} / ${p.needed} hired</div></div>`;
    }).join('') : '<p class="empty">No open positions. Add one with "+ Position".</p>';
  }
  const inStage = (c) => Math.max(0, -daysFrom(c.stageSince || iso(today())));
  const STUCK = 14;
  const isStuck = (c) => ACTIVE.includes(c.stage) && inStage(c) > STUCK;
  function avgDaysToHire() {
    const h = db.candidates.filter((c) => c.stage === 'Hired' && c.hiredOn && c.added);
    if (!h.length) return null;
    return Math.round(h.reduce((s, c) => s + (daysFrom(c.hiredOn) - daysFrom(c.added)), 0) / h.length);
  }
  const hiredFor = (pid) => db.candidates.filter((c) => c.positionId === pid && c.stage === 'Hired').length;

  function cardHTML(c) {
    const i = STAGES.indexOf(c.stage);
    return `<article class="ccard${isStuck(c) ? ' is-stuck' : ''}" draggable="true" data-id="${c.id}">
      <button type="button" class="name" data-open="${c.id}">${esc(c.name)}</button>
      <span class="role">${esc(posTitle(c.positionId))}</span>
      <div class="chips">${c.skills.slice(0, 4).map((s) => `<span class="chip">${esc(s)}</span>`).join('')}</div>
      <div class="row"><span class="stars" aria-label="${c.rating || 0} out of 5">${stars(c.rating)}</span>${c.followUp && ACTIVE.includes(c.stage) ? whenLabel(c.followUp) : ''}</div>
      <div class="row"><small class="${isStuck(c) ? 'stuck' : ''}" style="color:${isStuck(c) ? 'var(--rust)' : 'var(--soft)'}">${ACTIVE.includes(c.stage) ? inStage(c) + 'd in stage' + (isStuck(c) ? ' · stuck' : '') : esc(c.source)}</small>
        <span class="arrows"><button type="button" data-move="${c.id}" data-dir="-1" aria-label="Move ${esc(c.name)} back" ${i === 0 ? 'disabled' : ''}>←</button><button type="button" data-move="${c.id}" data-dir="1" aria-label="Move ${esc(c.name)} forward" ${i === STAGES.length - 1 ? 'disabled' : ''}>→</button></span></div>
    </article>`;
  }
  function renderPipeline() {
    const sel = $('pipeFilter'), cur = sel.value || 'all';
    sel.innerHTML = '<option value="all">All positions</option>' + db.positions.map((p) => `<option value="${p.id}">${esc(p.title)}</option>`).join('');
    sel.value = db.positions.some((p) => p.id === cur) ? cur : 'all';
    const q = norm($('pipeSearch').value.trim());
    const list = db.candidates.filter((c) => (sel.value === 'all' || c.positionId === sel.value) &&
      (!q || norm(c.name).includes(q) || c.skills.some((s) => norm(s).includes(q))));
    $('board').innerHTML = STAGES.map((s) => {
      const items = list.filter((c) => c.stage === s);
      return `<section class="col" data-stage="${s}" aria-label="${s}"><div class="col-head">${s}<span>${items.length}</span></div>${items.map(cardHTML).join('')}</section>`;
    }).join('');
  }

  function renderPositions() {
    $('positionsList').innerHTML = db.positions.map((p) => {
      const cs = db.candidates.filter((c) => c.positionId === p.id);
      const pill = p.status === 'Open' ? `<span class="pill ${esc(p.priority)}">${esc(p.priority)} priority</span>` : `<span class="pill ${p.status === 'Filled' ? 'Filled' : 'hold'}">${esc(p.status)}</span>`;
      return `<article class="pos">
        <div class="row" style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start"><h3>${esc(p.title)}</h3>${pill}</div>
        <p class="meta">${esc(p.team)}${p.location ? ' · ' + esc(p.location) : ''}${p.target ? ' · target ' + esc(p.target) : ''}</p>
        <div class="chips">${p.skills.map((s) => `<span class="chip">${esc(s)}</span>`).join('')}</div>
        <div class="stats"><span><b>${hiredFor(p.id)}/${p.needed}</b>hired</span><span><b>${cs.filter((c) => ACTIVE.includes(c.stage)).length}</b>in pipeline</span><span><b>${cs.filter((c) => c.stage === 'Interview').length}</b>interviewing</span></div>
        <div class="foot-row"><button type="button" class="link-btn" data-match="${p.id}" style="padding:0">Find matching talent →</button><button type="button" class="btn btn-line" data-editpos="${p.id}">Edit</button></div>
      </article>`;
    }).join('') || '<p class="empty">No positions yet.</p>';
  }

  function renderFollowups() {
    const active = db.candidates.filter((c) => ACTIVE.includes(c.stage));
    const groups = [
      ['Late', active.filter((c) => c.followUp && daysFrom(c.followUp) < 0)],
      ['Today', active.filter((c) => c.followUp && daysFrom(c.followUp) === 0)],
      ['Coming up', active.filter((c) => c.followUp && daysFrom(c.followUp) > 0)],
      ['No follow-up planned', active.filter((c) => !c.followUp)]
    ];
    $('followList').innerHTML = groups.filter((g) => g[1].length).map(([title, items]) => `
      <div class="fgroup"><h2>${title} <small style="font-family:var(--sans);font-size:15px;color:var(--soft)">(${items.length})</small></h2>
      ${items.sort((a, b) => (a.followUp || '').localeCompare(b.followUp || '')).map((c) => `
        <div class="fitem">
          <div class="who"><button type="button" class="link-btn" data-open="${c.id}" style="padding:0;min-height:0;text-align:left;font-weight:700;font-size:16px">${esc(c.name)}</button>
            <small>${esc(posTitle(c.positionId))} · ${esc(c.stage)} · last contact ${c.lastContact ? Math.abs(daysFrom(c.lastContact)) + ' days ago' : 'never'}</small>
            ${c.notes ? `<small>“${esc(c.notes)}”</small>` : ''}</div>
          <div class="acts">${whenLabel(c.followUp)}
            ${c.email ? `<a class="link-btn" href="mailto:${esc(c.email)}?subject=${encodeURIComponent('Your application: ' + posTitle(c.positionId))}">Email</a>` : ''}
            <button type="button" class="btn btn-line" data-snooze="${c.id}">+3 days</button>
            <button type="button" class="btn" data-done="${c.id}">Done, next in 7 days</button></div>
        </div>`).join('')}</div>`).join('') || '<p class="empty">No active candidates.</p>';
    const n = active.filter((c) => c.followUp && daysFrom(c.followUp) <= 0).length;
    $('fuBadge').hidden = !n; $('fuBadge').textContent = n;
  }

  let skillFilter = [];
  function renderTalent() {
    const counts = {};
    db.candidates.forEach((c) => c.skills.forEach((s) => { const k = s.trim(); counts[k] = (counts[k] || 0) + 1; }));
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 18);
    $('skillCloud').innerHTML = top.map(([s, n]) => `<button type="button" class="chip ${skillFilter.some((f) => norm(f) === norm(s)) ? 'on' : ''}" data-skill="${esc(s)}">${esc(s)}<b>${n}</b></button>`).join('');

    const ms = $('matchPos'), cur = ms.value;
    ms.innerHTML = '<option value="">Choose a position…</option>' + db.positions.map((p) => `<option value="${p.id}">${esc(p.title)}</option>`).join('');
    ms.value = db.positions.some((p) => p.id === cur) ? cur : '';

    const typed = splitSkills($('skillSearch').value);
    const pos = posById(ms.value);
    const wanted = pos ? pos.skills : (typed.length ? typed : skillFilter);
    const W = wanted.map(norm);
    let rows = db.candidates.map((c) => {
      const has = c.skills.map(norm);
      const hits = W.filter((w) => has.some((h) => h.includes(w) || w.includes(h)));
      return { c, hits, score: W.length ? hits.length / W.length : 0 };
    });
    if (W.length) rows = rows.filter((r) => r.hits.length).sort((a, b) => b.score - a.score || (b.c.rating || 0) - (a.c.rating || 0));
    else rows.sort((a, b) => a.c.name.localeCompare(b.c.name));

    $('talentList').innerHTML = (W.length ? `<p class="hint">${rows.length} ${rows.length === 1 ? 'person matches' : 'people match'} ${pos ? '<b>' + esc(pos.title) + '</b>' : 'these skills'}, including past candidates.</p>` : '<p class="hint">Everyone you have ever added. Pick a skill or a position to rank them.</p>') +
      rows.map(({ c, hits, score }) => `
        <div class="trow">
          <div class="who"><button type="button" class="link-btn" data-open="${c.id}" style="padding:0;min-height:0;font-weight:700;font-size:16px;text-align:left">${esc(c.name)}</button>
            <small>${esc(c.stage)} · ${esc(posTitle(c.positionId))} <span class="stars">${stars(c.rating)}</span></small></div>
          <div class="chips">${c.skills.map((s) => `<span class="chip ${hits.length && W.some((w) => norm(s).includes(w) || w.includes(norm(s))) ? 'hit' : ''}">${esc(s)}</span>`).join('')}</div>
          <div class="score">${W.length ? Math.round(score * 100) + '%<small>match</small>' : ''}</div>
        </div>`).join('');
  }

  function render() {
    renderFollowups();
    if (tab === 'dashboard') renderDashboard();
    if (tab === 'pipeline') renderPipeline();
    if (tab === 'positions') renderPositions();
    if (tab === 'talent') renderTalent();
  }

  /* ---------- actions ---------- */
  function move(id, dir) {
    const c = db.candidates.find((x) => x.id === id); if (!c) return;
    const i = Math.max(0, Math.min(STAGES.length - 1, STAGES.indexOf(c.stage) + dir));
    setStage(c, STAGES[i]);
  }
  function setStage(c, stage) {
    if (c.stage === stage) return;
    c.stage = stage; c.lastContact = iso(today()); c.stageSince = iso(today());
    c.history.push({ d: iso(today()), t: 'Moved to ' + stage });
    if (stage === 'Hired') c.hiredOn = iso(today());
    if (stage === 'Hired' || stage === 'Rejected') c.followUp = '';
    save(); render();
    toast(`${c.name} → ${stage}`);
  }

  /* candidate dialog */
  let editingCand = null;
  function openCand(id) {
    const c = id ? db.candidates.find((x) => x.id === id) : null;
    editingCand = c;
    const f = $('candForm');
    $('candPos').innerHTML = db.positions.map((p) => `<option value="${p.id}">${esc(p.title)}</option>`).join('') || '<option value="">No position</option>';
    $('candStage').innerHTML = STAGES.map((s) => `<option>${s}</option>`).join('');
    $('candTitle').textContent = c ? c.name : 'New candidate';
    f.name.value = c ? c.name : ''; f.email.value = c ? c.email : '';
    f.positionId.value = c ? c.positionId : (db.positions[0] || {}).id || '';
    f.stage.value = c ? c.stage : 'Applied'; f.source.value = c ? c.source : 'LinkedIn';
    f.rating.value = c ? String(c.rating || 0) : '0'; f.skills.value = c ? c.skills.join(', ') : '';
    f.followUp.value = c ? c.followUp : plus(3); f.lastContact.value = c ? c.lastContact : iso(today());
    f.notes.value = c ? c.notes : '';
    $('candDelete').hidden = !c;
    const h = c ? c.history.slice().reverse() : [];
    $('candHistory').hidden = !h.length;
    $('candHistoryList').innerHTML = h.map((x) => `<li><time>${esc(x.d)}</time>${esc(x.t)}</li>`).join('');
    $('candDialog').showModal();
  }
  $('candForm').addEventListener('submit', (e) => {
    const f = e.target;
    const data = { name: f.name.value.trim(), email: f.email.value.trim(), positionId: f.positionId.value, stage: f.stage.value, source: f.source.value,
      rating: parseInt(f.rating.value, 10) || 0, skills: splitSkills(f.skills.value), followUp: f.followUp.value, lastContact: f.lastContact.value, notes: f.notes.value.trim() };
    if (!data.name) return;
    if (editingCand) {
      if (editingCand.stage !== data.stage) { data.stageSince = iso(today()); editingCand.history.push({ d: iso(today()), t: 'Moved to ' + data.stage }); if (data.stage === 'Hired') data.hiredOn = iso(today()); }
      Object.assign(editingCand, data);
    } else db.candidates.push(Object.assign({ id: uid(), added: iso(today()), stageSince: iso(today()), history: [{ d: iso(today()), t: 'Added (' + data.source + ')' }] }, data));
    save(); render(); toast(editingCand ? 'Saved' : 'Candidate added');
  });
  $('candCancel').addEventListener('click', () => $('candDialog').close());
  $('candDelete').addEventListener('click', () => {
    if (!editingCand || !confirm(`Delete ${editingCand.name}?`)) return;
    db.candidates = db.candidates.filter((c) => c !== editingCand);
    save(); $('candDialog').close(); render(); toast('Deleted');
  });

  /* position dialog */
  let editingPos = null;
  function openPos(id) {
    const p = id ? posById(id) : null;
    editingPos = p;
    const f = $('posForm');
    $('posTitle').textContent = p ? 'Edit position' : 'New position';
    f.title.value = p ? p.title : ''; f.team.value = p ? p.team : ''; f.location.value = p ? p.location : '';
    f.needed.value = p ? p.needed : 1; f.priority.value = p ? p.priority : 'Medium'; f.status.value = p ? p.status : 'Open';
    f.target.value = p ? p.target : plus(30); f.skills.value = p ? p.skills.join(', ') : '';
    $('posDelete').hidden = !p;
    $('posDialog').showModal();
  }
  $('posForm').addEventListener('submit', (e) => {
    const f = e.target;
    const data = { title: f.title.value.trim(), team: f.team.value.trim(), location: f.location.value.trim(), needed: Math.max(1, parseInt(f.needed.value, 10) || 1),
      priority: f.priority.value, status: f.status.value, target: f.target.value, skills: splitSkills(f.skills.value) };
    if (!data.title) return;
    if (editingPos) Object.assign(editingPos, data);
    else db.positions.push(Object.assign({ id: uid(), opened: iso(today()) }, data));
    save(); render(); toast(editingPos ? 'Saved' : 'Position added');
  });
  $('posCancel').addEventListener('click', () => $('posDialog').close());
  $('posDelete').addEventListener('click', () => {
    if (!editingPos) return;
    const n = db.candidates.filter((c) => c.positionId === editingPos.id).length;
    if (!confirm(`Delete "${editingPos.title}"?${n ? ` Its ${n} candidate(s) stay in your talent pool.` : ''}`)) return;
    db.positions = db.positions.filter((p) => p !== editingPos);
    save(); $('posDialog').close(); render(); toast('Deleted');
  });

  /* ---------- event delegation ---------- */
  document.addEventListener('click', (e) => {
    const t = e.target.closest('button, a'); if (!t) return;
    const d = t.dataset;
    if (d.tab) setTab(d.tab);
    else if (d.goto) setTab(d.goto);
    else if (d.open) openCand(d.open);
    else if (d.move) move(d.move, parseInt(d.dir, 10));
    else if (d.editpos) openPos(d.editpos);
    else if (d.match) { setTab('talent'); $('matchPos').value = d.match; $('skillSearch').value = ''; skillFilter = []; renderTalent(); }
    else if (d.skill) {
      const s = d.skill, i = skillFilter.findIndex((f) => norm(f) === norm(s));
      if (i >= 0) skillFilter.splice(i, 1); else skillFilter.push(s);
      $('skillSearch').value = skillFilter.join(', '); $('matchPos').value = ''; renderTalent();
    } else if (d.snooze || d.done) {
      const c = db.candidates.find((x) => x.id === (d.snooze || d.done)); if (!c) return;
      if (d.done) { c.lastContact = iso(today()); c.followUp = plus(7); c.history.push({ d: iso(today()), t: 'Followed up' }); toast(`Logged. Next follow-up with ${c.name} in 7 days`); }
      else { const base = c.followUp && daysFrom(c.followUp) > 0 ? new Date(c.followUp + 'T00:00:00') : today(); c.followUp = iso(new Date(base.getTime() + 3 * DAY)); c.history.push({ d: iso(today()), t: 'Follow-up moved to ' + c.followUp }); toast('Snoozed 3 days'); }
      save(); render();
    }
  });
  document.querySelectorAll('[data-tour]').forEach((b) => b.addEventListener('click', () => {
    const t = b.dataset.tour;
    if (t === 'follow') setTab('followups');
    if (t === 'pipe') setTab('pipeline');
    if (t === 'match') { const p = db.positions[0]; setTab('talent'); if (p) { $('matchPos').value = p.id; $('skillSearch').value = ''; skillFilter = []; renderTalent(); } }
    document.querySelector('.tabs').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));

  /* CSV import (accepts this app's export, or any sheet with a Name column) */
  function parseCSV(text) {
    const rows = []; let row = [], cell = '', q = false;
    text = text.replace(/^\ufeff/, '');
    const sep = (text.split('\n')[0].match(/;/g) || []).length > (text.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
      else if (ch === '"') q = true;
      else if (ch === sep) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += ch;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.some((c) => c.trim()));
  }
  $('importCsv').addEventListener('click', () => $('csvFile').click());
  $('csvFile').addEventListener('change', (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const rows = parseCSV(String(reader.result));
      if (rows.length < 2) { toast('No rows found in that file'); return; }
      const head = rows[0].map((h) => h.trim().toLowerCase());
      const col = (...names) => head.findIndex((h) => names.some((n) => h === n || h.includes(n)));
      const ix = { name: col('name', 'nom'), email: col('email', 'mail'), pos: col('position', 'poste', 'job'), stage: col('stage', 'status', 'statut'),
        skills: col('skill', 'compétence', 'competence'), rating: col('rating', 'note'), source: col('source'), follow: col('follow', 'relance'), last: col('last contact', 'dernier'), notes: col('notes', 'comment') };
      if (ix.name < 0) { toast('The file needs a "Name" column'); return; }
      const get = (r, k) => (ix[k] >= 0 ? (r[ix[k]] || '').trim() : '');
      const okDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '';
      let added = 0, newPos = 0;
      rows.slice(1).forEach((r) => {
        const name = get(r, 'name'); if (!name) return;
        const title = get(r, 'pos') || 'Imported candidates';
        let pos = db.positions.find((p) => norm(p.title) === norm(title));
        if (!pos) { pos = { id: uid(), title, team: '', location: '', needed: 1, priority: 'Medium', status: 'Open', skills: [], target: '', opened: iso(today()) }; db.positions.push(pos); newPos++; }
        const st = STAGES.find((s) => norm(s) === norm(get(r, 'stage'))) || 'Applied';
        const source = get(r, 'source') || 'Other';
        db.candidates.push({ id: uid(), name: name.slice(0, 80), email: get(r, 'email').slice(0, 120), positionId: pos.id, stage: st,
          skills: get(r, 'skills').split(/[;,|]/).map((x) => x.trim()).filter(Boolean), rating: Math.min(5, parseInt(get(r, 'rating'), 10) || 0),
          source, followUp: okDate(get(r, 'follow')), lastContact: okDate(get(r, 'last')) || iso(today()), notes: get(r, 'notes').slice(0, 1000),
          added: iso(today()), stageSince: iso(today()), history: [{ d: iso(today()), t: 'Imported from ' + file.name }] });
        added++;
      });
      save(); render(); toast(`Imported ${added} candidate${added === 1 ? '' : 's'}${newPos ? ` and ${newPos} position${newPos === 1 ? '' : 's'}` : ''}`);
      e.target.value = '';
    };
    reader.readAsText(file);
  });
  $('addCandidate').addEventListener('click', () => openCand(null));
  $('addPosition').addEventListener('click', () => openPos(null));
  $('pipeFilter').addEventListener('change', renderPipeline);
  $('pipeSearch').addEventListener('input', renderPipeline);
  $('skillSearch').addEventListener('input', () => { skillFilter = splitSkills($('skillSearch').value); $('matchPos').value = ''; renderTalent(); });
  $('matchPos').addEventListener('change', () => { $('skillSearch').value = ''; skillFilter = []; renderTalent(); });
  $('resetDemo').addEventListener('click', () => { if (confirm('Replace everything with the demo data?')) { db = demo(); save(); render(); toast('Demo data restored'); } });
  $('clearAll').addEventListener('click', () => { if (confirm('Delete everything and start with an empty desk?')) { db = { positions: [], candidates: [] }; save(); render(); toast('Empty desk. Add your first position.'); } });
  $('exportCsv').addEventListener('click', () => {
    const head = ['Name', 'Email', 'Position', 'Stage', 'Skills', 'Rating', 'Source', 'Next follow-up', 'Last contact', 'Notes'];
    const q = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const rows = db.candidates.map((c) => [c.name, c.email, posTitle(c.positionId), c.stage, c.skills.join('; '), c.rating, c.source, c.followUp, c.lastContact, c.notes].map(q).join(','));
    const blob = new Blob(['﻿' + [head.map(q).join(','), ...rows].join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'candidates.csv'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('CSV downloaded');
  });

  /* keyboard for tabs */
  document.querySelector('.tabs').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const tabs = [...document.querySelectorAll('.tabs [role=tab]')];
    const i = tabs.findIndex((b) => b.dataset.tab === tab);
    const n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    n.focus(); setTab(n.dataset.tab);
  });

  /* drag and drop on the board */
  const board = $('board');
  board.addEventListener('dragstart', (e) => { const c = e.target.closest('.ccard'); if (!c) return; c.classList.add('dragging'); e.dataTransfer.setData('text/plain', c.dataset.id); e.dataTransfer.effectAllowed = 'move'; });
  board.addEventListener('dragend', (e) => { const c = e.target.closest('.ccard'); if (c) c.classList.remove('dragging'); });
  board.addEventListener('dragover', (e) => { const col = e.target.closest('.col'); if (!col) return; e.preventDefault(); board.querySelectorAll('.col.over').forEach((x) => x !== col && x.classList.remove('over')); col.classList.add('over'); });
  board.addEventListener('dragleave', (e) => { const col = e.target.closest('.col'); if (col && !col.contains(e.relatedTarget)) col.classList.remove('over'); });
  board.addEventListener('drop', (e) => {
    const col = e.target.closest('.col'); if (!col) return; e.preventDefault();
    col.classList.remove('over');
    const c = db.candidates.find((x) => x.id === e.dataTransfer.getData('text/plain'));
    if (c) setStage(c, col.dataset.stage);
  });

  load();
  setTab('dashboard');
})();

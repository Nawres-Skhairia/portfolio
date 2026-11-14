/* Process to App: UI, diagram, data model, prototype and spec, all generated from the design that parser.js produces. */
(function () {
  'use strict';
  const KEY = 'process-app-v1';
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const isoIn = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
  const nowStr = () => new Date().toISOString().slice(0, 16).replace('T', ' ');
  const fmtN = (v) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(v);

  const TEMPLATES = [
    ['Leave request', 'Leave request: the employee submits a request with start and end dates and a reason. The manager approves or rejects it. If the leave is more than 10 days, the director must also approve. Then HR validates it and updates the leave balance, and the employee is notified.'],
    ['Purchase request', 'Purchase request: an employee fills in the item, quantity, estimated amount and supplier. The manager approves or rejects. If the amount is over 5,000 TND, finance must also approve. Purchasing then orders from the supplier and the employee is notified.'],
    ['Note de frais (FR)', "Note de frais : le salarié saisit la dépense avec le montant, la date et le justificatif. Le responsable valide ou refuse ; s'il refuse, la note est renvoyée au salarié pour correction. Si le montant dépasse 500 €, le DAF doit aussi approuver. Puis la comptabilité vérifie le justificatif et rembourse le salarié."],
    ['Software access', 'Access request: a new employee requests access to an application with a justification. The manager approves. IT creates the account and the employee is notified.']
  ];
  const TYPE_LABEL = { submit: 'Submit', approve: 'Approve / reject', review: 'Check', do: 'Do a task', notify: 'Notify' };
  const LANE_COLORS = ['#1e3a2f', '#a23b1c', '#8a5a00', '#3d5a80', '#6b4c7a', '#4a6b2a', '#7a4a2a'];

  let D = null;      // design
  let REQ = [];      // prototype requests
  let desc = '';
  let playAs = null, openId = null;

  function save() { try { localStorage.setItem(KEY, JSON.stringify({ desc, D, REQ })); } catch (e) { /* ignore */ } }
  function load() { try { const x = JSON.parse(localStorage.getItem(KEY)); if (x && x.D && x.D.steps) { desc = x.desc; D = x.D; REQ = x.REQ || []; return true; } } catch (e) { /* ignore */ } return false; }
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2800); }

  const roleOf = (k) => (D.roles.find((r) => r.key === k) || { label: k }).label;
  const roleColor = (k) => LANE_COLORS[Math.max(0, D.roles.findIndex((r) => r.key === k)) % LANE_COLORS.length];
  const condText = (c) => c ? `${c.field} ${c.op === '>=' ? '≥' : c.op} ${fmtN(c.value)}` : '';
  const submitter = () => (D.steps[0] || {}).roleKey;

  /* ---------- build ---------- */
  function build(fromText) {
    if (fromText) {
      desc = $('#desc').value.trim();
      if (!desc) { toast('Describe your process first'); return; }
      const d = ProcessReader.understand(desc);
      if (d.steps.length < 2) { toast('I found fewer than 2 steps. Name who does what, one sentence per step.'); if (!d.steps.length) return; }
      D = d; REQ = []; playAs = null; openId = null;
      seedRequests();
    }
    normalise();
    $('#result').hidden = false;
    renderAll();
    save();
  }
  function normalise() {
    D.roles = D.roles.filter((r) => D.steps.some((s) => s.roleKey === r.key) || r.keep);
    D.steps.forEach((s) => { if (s.type === 'approve' && !s.onReject) s.onReject = 'reject'; if (s.type !== 'approve') s.onReject = null; });
    D.steps.forEach((s) => { if (s.cond && !D.fields.some((f) => f.name === s.cond.field)) D.fields.push(s.cond.field === 'Number of days' ? { name: 'Number of days', type: 'number', calc: D.fields.some((f) => f.name === 'Start date') ? 'days' : null } : { name: s.cond.field, type: 'money' }); });
    if (!playAs || !D.roles.some((r) => r.key === playAs)) playAs = submitter();
  }
  function renderAll() {
    $('#procTitle').textContent = D.title;
    const approvals = D.steps.filter((s) => s.type === 'approve').length;
    $('#procSummary').textContent = `${D.roles.length} roles · ${D.steps.length} steps · ${approvals} approval${approvals === 1 ? '' : 's'} · ${D.steps.filter((s) => s.cond).length} condition${D.steps.filter((s) => s.cond).length === 1 ? '' : 's'} · ${D.fields.length} fields`;
    renderDiagram(); renderSteps(); renderModel(); renderProto(); renderSpec();
  }

  /* ---------- diagram ---------- */
  function renderDiagram() {
    const lanes = D.roles.map((r) => r.key);
    const LW = 112, LH = 120, TW = 124, TH = 58, TOP = 6;
    const els = []; const edges = [];
    let col = 0;
    const laneY = (k) => TOP + lanes.indexOf(k) * LH + LH / 2;
    let cx = LW + 24;
    const add = (o) => { const w = o.kind === 'task' ? TW + 36 : o.kind === 'gw' ? 84 : 66; o.x = cx + w / 2 - (o.kind === 'task' ? 0 : 6); cx += w; o.y = laneY(o.lane) + (o.dy || 0); col++; els.push(o); return o; };
    const first = D.steps[0];
    let prev = add({ kind: 'start', lane: first.roleKey });
    let prevLabel = '';
    let skips = [];
    const link = (to) => { edges.push({ a: prev, b: to, label: prevLabel }); skips.forEach((g) => edges.push({ a: g, b: to, label: 'No', kind: 'skip' })); skips = []; prevLabel = ''; };
    const firstTask = { ref: null };
    const rejectEnds = [];
    D.steps.forEach((s, i) => {
      let mySkip = null;
      if (s.cond) { const g = add({ kind: 'gw', lane: s.roleKey, text: condText(s.cond) + '?' }); link(g); prev = g; prevLabel = 'Yes'; mySkip = g; }
      const t = add({ kind: 'task', lane: s.roleKey, step: s, i });
      if (!firstTask.ref) firstTask.ref = t;
      link(t); prev = t;
      if (s.type === 'approve') {
        const g = add({ kind: 'gw', lane: s.roleKey, text: 'Approved?' });
        link(g); prev = g; prevLabel = 'Yes';
        if (s.onReject === 'return') edges.push({ a: g, b: firstTask.ref, label: 'No: back', kind: 'back' });
        else { const e = { kind: 'endRej', lane: s.roleKey, x: g.x, y: g.y + 44 }; els.push(e); rejectEnds.push(e); edges.push({ a: g, b: e, label: 'No', kind: 'down' }); }
      }
      if (mySkip) skips.push(mySkip);
    });
    const end = add({ kind: 'end', lane: D.steps[D.steps.length - 1].roleKey });
    link(end);
    const W = cx + 70, H = TOP * 2 + lanes.length * LH;
    let svg = '';
    lanes.forEach((k, i) => {
      const y = TOP + i * LH;
      svg += `<rect x="0" y="${y}" width="${W}" height="${LH}" fill="${i % 2 ? '#f6efe3' : '#fbf8f2'}"/><rect x="0" y="${y}" width="${LW}" height="${LH}" fill="${roleColor(k)}" opacity=".1"/><rect x="0" y="${y}" width="4" height="${LH}" fill="${roleColor(k)}"/>
        <text x="16" y="${y + LH / 2 + 5}" font-family="Karla, sans-serif" font-weight="700" font-size="15" fill="${roleColor(k)}">${esc(cut(roleOf(k), 13))}</text>`;
    });
    svg += `<line x1="${LW}" y1="${TOP}" x2="${LW}" y2="${H - TOP}" stroke="#ddd2c0"/>`;
    const port = (o, side) => {
      const hw = o.kind === 'task' ? TW / 2 : o.kind === 'gw' ? 22 : 16, hh = o.kind === 'task' ? TH / 2 : o.kind === 'gw' ? 22 : 16;
      return side === 'r' ? [o.x + hw, o.y] : side === 'l' ? [o.x - hw, o.y] : side === 't' ? [o.x, o.y - hh] : [o.x, o.y + hh];
    };
    let paths = '', labels = '';
    edges.forEach((e) => {
      let d, lx, ly;
      if (e.kind === 'skip') {
        const [x1, y1] = port(e.a, 't'), [x2, y2] = port(e.b, 't');
        const ytop = Math.min(TOP + lanes.indexOf(e.a.lane) * LH, TOP + lanes.indexOf(e.b.lane) * LH) + 10;
        d = `M${x1} ${y1} V${ytop} H${x2} V${y2 - 4}`; lx = x1 + 10; ly = ytop - 4;
      } else if (e.kind === 'down') {
        const [x1, y1] = port(e.a, 'b'); d = `M${x1} ${y1} V${e.b.y - 12 - 3}`; lx = x1 - 22; ly = y1 + 13;
      } else if (e.kind === 'back') {
        const [x1, y1] = port(e.a, 'b'), [x2, y2] = port(e.b, 'b');
        const yb = Math.max(y1, y2) + 26;
        d = `M${x1} ${y1} V${yb} H${x2} V${y2 + 4}`; lx = x1 + 6; ly = y1 + 14;
      } else {
        const [x1, y1] = port(e.a, 'r'), [x2, y2] = port(e.b, 'l');
        const mx = x1 + 18;
        d = y1 === y2 ? `M${x1} ${y1} H${x2 - 4}` : `M${x1} ${y1} H${mx} V${y2} H${x2 - 4}`;
        lx = x1 + 4; ly = y1 - 6;
      }
      paths += `<path d="${d}" fill="none" stroke="${e.kind === 'back' || e.kind === 'down' ? '#a23b1c' : '#7d7062'}" stroke-width="1.6" ${e.kind === 'skip' || e.kind === 'back' ? 'stroke-dasharray="5 4"' : ''} marker-end="url(#${e.kind === 'back' || e.kind === 'down' ? 'arrR' : 'arr'})"/>`;
      if (e.label) labels += `<text x="${lx}" y="${ly}" font-family="Karla, sans-serif" font-size="12" font-weight="700" fill="${e.label.startsWith('No') ? '#a23b1c' : '#2f7a4f'}">${esc(e.label)}</text>`;
    });
    let shapes = '';
    els.forEach((o) => {
      if (o.kind === 'start') shapes += `<circle cx="${o.x}" cy="${o.y}" r="15" fill="#fff" stroke="#2f7a4f" stroke-width="2"/><text x="${o.x}" y="${o.y + 34}" text-anchor="middle" font-family="Karla, sans-serif" font-size="11.5" fill="#5a4f44">Start</text>`;
      else if (o.kind === 'end') shapes += `<circle cx="${o.x}" cy="${o.y}" r="15" fill="#fff" stroke="#1f1a15" stroke-width="4"/><text x="${o.x}" y="${o.y + 36}" text-anchor="middle" font-family="Karla, sans-serif" font-size="11.5" fill="#5a4f44">Done</text>`;
      else if (o.kind === 'endRej') shapes += `<circle cx="${o.x}" cy="${o.y}" r="12" fill="#fff" stroke="#a23b1c" stroke-width="3.5"/><text x="${o.x + 18}" y="${o.y + 4}" font-family="Karla, sans-serif" font-size="11.5" fill="#a23b1c">Rejected</text>`;
      else if (o.kind === 'gw') shapes += `<g><path d="M${o.x} ${o.y - 22} L${o.x + 22} ${o.y} L${o.x} ${o.y + 22} L${o.x - 22} ${o.y} Z" fill="#fff" stroke="#8a5a00" stroke-width="1.8"/><text x="${o.x}" y="${o.y + 5}" text-anchor="middle" font-family="Karla, sans-serif" font-weight="700" font-size="14" fill="#8a5a00">×</text>
        <text x="${o.x}" y="${o.text === 'Approved?' ? o.y - 30 : o.y + 38}" text-anchor="middle" font-family="Karla, sans-serif" font-size="11.5" font-weight="700" fill="#5a4f44">${esc(cut(o.text, 24))}</text></g>`;
      else if (o.kind === 'task') {
        const s = o.step, c = roleColor(o.lane);
        const icon = s.type === 'approve' ? '✓' : s.type === 'notify' ? '✉' : s.type === 'submit' ? '✎' : s.type === 'review' ? '⌕' : '⚙';
        const lines = wrap(s.action, 18).slice(0, 2);
        shapes += `<g class="dtask" data-step="${o.i}"><rect x="${o.x - TW / 2}" y="${o.y - TH / 2}" width="${TW}" height="${TH}" rx="10" fill="#fff" stroke="${c}" stroke-width="1.6"/>
          <text x="${o.x - TW / 2 + 8}" y="${o.y - TH / 2 + 15}" font-size="11" fill="${c}" font-family="Karla, sans-serif">${icon} ${esc(TYPE_LABEL[s.type])}</text>
          ${lines.map((l, j) => `<text x="${o.x - TW / 2 + 8}" y="${o.y - 2 + j * 15}" font-family="Karla, sans-serif" font-size="12.5" font-weight="700" fill="#1f1a15">${esc(l)}</text>`).join('')}</g>`;
      }
    });
    $('#diagram').innerHTML = `<svg width="${W}" height="${H + 10}" style="width:100%;height:auto;min-width:${Math.min(W, 860)}px;max-width:${W}px" viewBox="0 0 ${W} ${H + 10}" role="img" aria-label="Workflow diagram of ${esc(D.title)}"><defs>
      <marker id="arr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L8 4 L0 8 z" fill="#7d7062"/></marker>
      <marker id="arrR" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L8 4 L0 8 z" fill="#a23b1c"/></marker></defs>${svg}${paths}${shapes}${labels}</svg>`;
  }
  const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
  function wrap(t, n) {
    const out = []; let line = '';
    t.split(/\s+/).forEach((w) => { if ((line + ' ' + w).trim().length > n && line) { out.push(line); line = w; } else line = (line + ' ' + w).trim(); });
    if (line) out.push(line);
    if (out.length > 2) out[1] = cut(out.slice(1).join(' '), n);
    return out;
  }

  /* ---------- steps table ---------- */
  function renderSteps() {
    const roleOpts = (sel) => D.roles.map((r) => `<option value="${esc(r.key)}"${r.key === sel ? ' selected' : ''}>${esc(r.label)}</option>`).join('') + '<option value="__new">+ New role…</option>';
    $('#steps').innerHTML = `<thead><tr><th>#</th><th>Who</th><th>Does what</th><th>Kind</th><th>Only if</th><th>If rejected</th><th><span class="sr">Actions</span></th></tr></thead><tbody>${D.steps.map((s, i) => `<tr data-i="${i}">
      <td class="n">${i + 1}</td>
      <td><select data-f="roleKey" aria-label="Who, step ${i + 1}">${roleOpts(s.roleKey)}</select></td>
      <td><input data-f="action" value="${esc(s.action)}" maxlength="80" aria-label="Action, step ${i + 1}"></td>
      <td><select data-f="type" aria-label="Kind, step ${i + 1}">${Object.entries(TYPE_LABEL).map(([k, v]) => `<option value="${k}"${k === s.type ? ' selected' : ''}>${v}</option>`).join('')}</select></td>
      <td><input data-f="cond" value="${esc(condText(s.cond))}" placeholder="always" aria-label="Condition, step ${i + 1}" ${i === 0 ? 'disabled' : ''}></td>
      <td>${s.type === 'approve' ? `<select data-f="onReject" aria-label="If rejected, step ${i + 1}"><option value="reject"${s.onReject === 'reject' ? ' selected' : ''}>Request is rejected</option><option value="return"${s.onReject === 'return' ? ' selected' : ''}>Back to ${esc(roleOf(submitter()))} to fix</option></select>` : '<span class="hint">–</span>'}</td>
      <td class="row-acts"><button type="button" data-mv="-1" aria-label="Move step ${i + 1} up" ${i === 0 ? 'disabled' : ''}>↑</button><button type="button" data-mv="1" aria-label="Move step ${i + 1} down" ${i === D.steps.length - 1 ? 'disabled' : ''}>↓</button><button type="button" data-del aria-label="Delete step ${i + 1}">×</button></td></tr>`).join('')}</tbody>`;
  }
  $('#steps').addEventListener('change', (e) => {
    const tr = e.target.closest('tr'); if (!tr) return;
    const s = D.steps[+tr.dataset.i], f = e.target.dataset.f, v = e.target.value;
    if (f === 'roleKey') {
      if (v === '__new') {
        const name = (prompt('Name of the new role (e.g. Legal, Site manager)') || '').trim();
        if (!name) { renderSteps(); return; }
        const key = 'r_' + name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
        if (!D.roles.some((r) => r.key === key)) D.roles.push({ key, label: name });
        s.roleKey = key;
      } else s.roleKey = v;
      const order = []; D.steps.forEach((x) => { if (!order.includes(x.roleKey)) order.push(x.roleKey); });
      D.roles.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
    } else if (f === 'cond') {
      const m = v.match(/^\s*(amount|montant|number of days|days|jours|nombre de jours)\s*(>=|≥|>|<=|<)\s*([\d\s.,]+)/i);
      if (!v.trim()) s.cond = null;
      else if (m) s.cond = { field: /amount|montant/i.test(m[1]) ? 'Amount' : 'Number of days', op: m[2] === '≥' ? '>=' : m[2], value: parseFloat(m[3].replace(/[\s,]/g, '')), text: v };
      else { const c = ProcessReader.parseCondition(v); if (c) s.cond = c; else toast('Write a condition like "Amount > 5000" or "Number of days > 10"'); }
    } else s[f] = v;
    normalise(); renderAll(); save();
  });
  $('#steps').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const i = +b.closest('tr').dataset.i;
    if (b.dataset.mv) { const j = i + +b.dataset.mv; [D.steps[i], D.steps[j]] = [D.steps[j], D.steps[i]]; }
    else if (b.hasAttribute('data-del')) { if (D.steps.length <= 2) { toast('A process needs at least 2 steps'); return; } D.steps.splice(i, 1); }
    normalise(); renderAll(); save();
  });
  $('#addStep').addEventListener('click', () => {
    const last = D.steps[D.steps.length - 1];
    D.steps.push({ roleKey: last.roleKey, action: 'New step', type: 'do', cond: null, onReject: null });
    normalise(); renderAll(); save();
    const inp = $$('#steps input[data-f=action]').pop(); inp.focus(); inp.select();
  });

  /* ---------- model, roles, states ---------- */
  const FTYPE = { date: 'Date', money: 'Amount (money)', number: 'Number', text: 'Text', file: 'File', choice: 'Choice list' };
  function states() {
    const out = [{ name: 'Submitted', kind: 'start' }];
    D.steps.slice(1).forEach((s) => { if (s.type === 'notify') return; out.push({ name: stateName(s), kind: 'mid', cond: s.cond }); });
    out.push({ name: D.steps.some((s) => s.type === 'approve') ? 'Approved and completed' : 'Completed', kind: 'end' });
    if (D.steps.some((s) => s.onReject === 'reject')) out.push({ name: 'Rejected', kind: 'bad' });
    if (D.steps.some((s) => s.onReject === 'return')) out.push({ name: 'Returned for changes', kind: 'warn' });
    return out;
  }
  const stateName = (s) => (s.type === 'approve' || s.type === 'review' ? 'Waiting for ' : 'With ') + roleOf(s.roleKey);
  function renderModel() {
    const ent = D.title.replace(/\b(request|demande)\b/i, (m) => m).trim();
    $('#model').innerHTML = `<div class="entity"><h3>${esc(ent)}</h3><table class="fields"><tbody>
      <tr class="sys"><td>ID</td><td>Auto number</td></tr><tr class="sys"><td>Requested by</td><td>Person (${esc(roleOf(submitter()))})</td></tr>
      ${D.fields.map((f) => `<tr><td>${esc(f.name)}</td><td>${f.calc === 'days' ? 'Calculated: end − start + 1' : FTYPE[f.type] || f.type}</td></tr>`).join('')}
      <tr class="sys"><td>Status</td><td>One of the statuses below</td></tr><tr class="sys"><td>Created / updated</td><td>Date and time</td></tr></tbody></table></div>
      <div class="entity"><h3>Decision</h3><table class="fields"><tbody><tr><td>${esc(ent)}</td><td>Link</td></tr><tr><td>Step</td><td>Which step</td></tr><tr><td>Decided by</td><td>Person</td></tr><tr><td>Decision</td><td>Approved / Rejected / Done / Sent back</td></tr><tr><td>Comment</td><td>Text</td></tr><tr><td>Date</td><td>Date and time</td></tr></tbody></table><p class="hint">One line per decision: the full audit trail, for free.</p></div>`;
    $('#roles').innerHTML = `<table class="fields rights"><thead><tr><th>Role</th><th>Can</th></tr></thead><tbody>${D.roles.map((r) => {
      const can = [];
      if (r.key === submitter()) can.push('create requests', 'see their own requests');
      D.steps.forEach((s, i) => { if (s.roleKey !== r.key || i === 0) return; if (s.type === 'approve') can.push('approve or reject at step ' + (i + 1) + (s.cond ? ` (only when ${condText(s.cond)})` : '')); else if (s.type === 'review') can.push('check at step ' + (i + 1)); else if (s.type === 'do') can.push(s.action.toLowerCase() + ' (step ' + (i + 1) + ')'); else if (s.type === 'notify') can.push('receive a notification'); });
      return `<tr><td><b style="color:${roleColor(r.key)}">${esc(r.label)}</b></td><td>${esc(can.join(', '))}</td></tr>`;
    }).join('')}</tbody></table><p class="hint">Everyone else: no access. Admins can see everything and change the settings.</p>`;
    $('#states').innerHTML = states().map((s) => `<span class="state ${s.kind}">${esc(s.name)}${s.cond ? `<small>only if ${esc(condText(s.cond))}</small>` : ''}</span>`).join('<span class="arrow" aria-hidden="true">→</span>');
  }

  /* ---------- prototype ---------- */
  function daysOf(f) { const a = f['Start date'], b = f['End date']; if (!a || !b) return null; return Math.round((new Date(b) - new Date(a)) / 86400000) + 1; }
  function valueFor(req, field) { const f = D.fields.find((x) => x.name === field); if (f && f.calc === 'days') return daysOf(req.fields); return parseFloat(req.fields[field]); }
  function condOk(c, req) { if (!c) return true; const v = valueFor(req, c.field); if (v == null || isNaN(v)) return true; return c.op === '>' ? v > c.value : c.op === '>=' ? v >= c.value : c.op === '<' ? v < c.value : v <= c.value; }
  function log(req, role, text, comment) { req.history.push({ at: nowStr(), role, text, comment: comment || '' }); }
  function advance(req, from) {
    for (let i = from + 1; i < D.steps.length; i++) {
      const s = D.steps[i];
      if (!condOk(s.cond, req)) { log(req, null, `Skipped ${roleOf(s.roleKey)}: ${condText(s.cond)} is not true`); continue; }
      if (s.type === 'notify') { log(req, s.roleKey, `${roleOf(s.roleKey)} notified`); continue; }
      req.step = i; req.status = 'open'; return;
    }
    req.status = 'done'; req.step = D.steps.length; log(req, null, 'Completed');
  }
  function sampleFields(n) {
    const f = {};
    const thr = (field) => { const s = D.steps.find((x) => x.cond && x.cond.field === field); return s ? s.cond.value : null; };
    D.fields.forEach((x) => {
      if (x.calc) return;
      const N = x.name;
      if (N === 'Start date') f[N] = isoIn(10 + n * 7);
      else if (N === 'End date') { const len = n === 1 && thr('Number of days') ? thr('Number of days') + 4 : 3 + n; f[N] = isoIn(10 + n * 7 + len - 1); }
      else if (x.type === 'date') f[N] = isoIn(-3 - n);
      else if (x.type === 'money') { const t = thr(N) || thr('Amount'); f[N] = n === 1 && t ? Math.round(t * 1.5) : [320, 4800, 180][n] || 250; }
      else if (N === 'Quantity') f[N] = [1, 6, 2][n];
      else if (x.type === 'number') f[N] = [2, 12, 1][n];
      else if (x.type === 'file') f[N] = ['receipt_taxi.pdf', 'quote_v2.pdf', 'invoice_0412.pdf'][n];
      else f[N] = ({ Reason: ['Family event', 'Summer holiday', 'Medical appointment'], Justification: ['Needed for the new client project', 'Monthly reporting', 'Replaces old tool'], Item: ['Laptop', 'Office chairs', 'Monitor'], Supplier: ['TechnoPlus', 'Bureau Pro', 'InfoShop'], Application: ['CRM', 'ERP', 'Jira'], Description: ['Client visit in Sousse', 'Team offsite', 'Conference ticket'], Project: ['Alpha', 'Orion', 'Atlas'], 'Leave type': ['Annual', 'Annual', 'Sick'], Destination: ['Sfax', 'Paris', 'Tunis'] }[N] || ['Sample A', 'Sample B', 'Sample C'])[n];
    });
    return f;
  }
  function newReq(fields, by) {
    const r = { id: 'R-' + String(101 + REQ.length), by, fields, step: 0, status: 'open', history: [] };
    log(r, submitter(), 'Submitted by ' + by);
    advance(r, 0); REQ.unshift(r); return r;
  }
  function seedRequests() {
    REQ = [];
    const names = ['Amira B.', 'Karim T.', 'Lina H.'];
    const r3 = newReq(sampleFields(2), names[2]);
    while (r3.status === 'open') { const s = D.steps[r3.step]; log(r3, s.roleKey, (s.type === 'approve' ? 'Approved by ' : 'Done by ') + roleOf(s.roleKey)); advance(r3, r3.step); }
    const r2 = newReq(sampleFields(1), names[1]);
    if (r2.status === 'open') { const s = D.steps[r2.step]; log(r2, s.roleKey, (s.type === 'approve' ? 'Approved by ' : 'Done by ') + roleOf(s.roleKey)); advance(r2, r2.step); }
    newReq(sampleFields(0), names[0]);
  }
  function statusLabel(r) {
    if (r.status === 'done') return ['Completed', 'ok'];
    if (r.status === 'rejected') return ['Rejected', 'bad'];
    if (r.status === 'returned') return ['Returned for changes', 'warn'];
    return [stateName(D.steps[r.step]), 'mute'];
  }
  function renderProto() {
    $('#roleSwitch').innerHTML = D.roles.map((r) => {
      const n = REQ.filter((q) => (q.status === 'open' && D.steps[q.step].roleKey === r.key) || (q.status === 'returned' && r.key === submitter())).length;
      return `<button type="button" role="radio" aria-checked="${r.key === playAs}" data-play="${esc(r.key)}" style="--c:${roleColor(r.key)}">${esc(r.label)}${n ? `<span class="badge">${n}</span>` : ''}</button>`;
    }).join('');
    const mine = REQ.filter((q) => (q.status === 'open' && D.steps[q.step].roleKey === playAs) || (q.status === 'returned' && playAs === submitter()));
    const others = REQ.filter((q) => !mine.includes(q));
    const isSub = playAs === submitter();
    const item = (q) => { const [l, c] = statusLabel(q); return `<button type="button" class="req-item${q.id === openId ? ' on' : ''}" data-req="${esc(q.id)}"><span><b>${esc(q.id)}</b> · ${esc(q.by)}</span><span class="pill ${c}">${esc(l)}</span><small>${esc(summaryOf(q))}</small></button>`; };
    $('#inbox').innerHTML = `${isSub ? '<button type="button" class="btn new-req" data-new>+ New request</button>' : ''}
      <h3>Waiting for you <span class="count">${mine.length}</span></h3>${mine.map(item).join('') || '<p class="empty">Nothing to do. Switch role above, or create a request.</p>'}
      <h3>${isSub ? 'All requests' : 'Other requests'}</h3>${others.map(item).join('') || '<p class="empty">None</p>'}`;
    renderDetail();
  }
  function summaryOf(q) {
    const f = D.fields.filter((x) => !x.calc && x.type !== 'file').slice(0, 2).map((x) => fmtField(x, q.fields[x.name])).filter(Boolean);
    const days = daysOf(q.fields);
    if (days && D.fields.some((x) => x.calc === 'days')) f.push(days + ' days');
    return f.join(' · ');
  }
  function fmtField(x, v) { if (v == null || v === '') return ''; if (x.type === 'money') return fmtN(+v) + (D.fr ? ' €' : ''); return String(v); }
  function renderDetail() {
    const host = $('#detail');
    if (openId === '__new') { host.innerHTML = formHtml(null); return; }
    const q = REQ.find((x) => x.id === openId);
    if (!q) { host.innerHTML = `<div class="detail-empty"><p class="hand">pick a request</p><p class="hint">Or switch role to see a different inbox. You are playing <b>${esc(roleOf(playAs))}</b>.</p></div>`; return; }
    const [l, c] = statusLabel(q);
    const s = q.status === 'open' ? D.steps[q.step] : null;
    const myTurn = s && s.roleKey === playAs;
    const fixing = q.status === 'returned' && playAs === submitter();
    let acts = '';
    if (myTurn) {
      acts = `<div class="decide"><p><b>Your step:</b> ${esc(s.action)}</p><label for="cmt" class="sr">Comment</label><textarea id="cmt" rows="2" maxlength="300" placeholder="Comment (optional)"></textarea><div class="acts">` +
        (s.type === 'approve' ? `<button type="button" class="btn ok" data-act="approve">Approve</button><button type="button" class="btn btn-line danger" data-act="reject">${s.onReject === 'return' ? 'Send back for changes' : 'Reject'}</button>` : `<button type="button" class="btn ok" data-act="done">Mark as done</button>${s.type === 'review' ? '<button type="button" class="btn btn-line danger" data-act="sendback">Send back</button>' : ''}`) + '</div></div>';
    } else if (s) acts = `<p class="hint waiting">Waiting for <b>${esc(roleOf(s.roleKey))}</b>. Switch to that role to act.</p>`;
    host.innerHTML = fixing ? formHtml(q) : `<div class="req-head"><h3>${esc(q.id)} · ${esc(D.title)}</h3><span class="pill ${c}">${esc(l)}</span></div>
      <p class="hint">Requested by ${esc(q.by)}</p>
      <dl class="kv">${D.fields.map((x) => `<dt>${esc(x.name)}</dt><dd>${esc(x.calc === 'days' ? (daysOf(q.fields) ?? '–') : fmtField(x, q.fields[x.name]) || '–')}</dd>`).join('')}</dl>
      ${acts}
      <h4>History</h4><ol class="timeline">${q.history.slice().reverse().map((h) => `<li><time>${esc(h.at.slice(5))}</time> ${esc(h.text)}${h.comment ? `<q>${esc(h.comment)}</q>` : ''}</li>`).join('')}</ol>`;
  }
  function formHtml(q) {
    const v = (n) => (q ? q.fields[n] : '') ?? '';
    const input = (x) => {
      if (x.calc === 'days') return '';
      const id = 'f_' + x.name.replace(/\W+/g, '_');
      let ctl;
      if (x.type === 'date') ctl = `<input type="date" id="${id}" name="${esc(x.name)}" value="${esc(v(x.name))}" required>`;
      else if (x.type === 'money' || x.type === 'number') ctl = `<input type="number" id="${id}" name="${esc(x.name)}" min="0" step="${x.type === 'money' ? '0.01' : '1'}" value="${esc(v(x.name))}" required>`;
      else if (x.type === 'file') ctl = `<input type="file" id="${id}" name="${esc(x.name)}">${v(x.name) ? `<small class="hint">Current: ${esc(v(x.name))}</small>` : ''}`;
      else if (x.type === 'choice') ctl = `<select id="${id}" name="${esc(x.name)}">${['Annual', 'Sick', 'Unpaid', 'Other'].map((o) => `<option${o === v(x.name) ? ' selected' : ''}>${o}</option>`).join('')}</select>`;
      else ctl = /reason|justification|description/i.test(x.name) ? `<textarea id="${id}" name="${esc(x.name)}" rows="2" maxlength="300" required>${esc(v(x.name))}</textarea>` : `<input id="${id}" name="${esc(x.name)}" maxlength="80" value="${esc(v(x.name))}" required>`;
      return `<label for="${id}">${esc(x.name)}${ctl}</label>`;
    };
    const last = q && [...q.history].reverse().find((h) => h.comment);
    return `<form class="req-form" id="reqForm" data-id="${q ? esc(q.id) : ''}"><h3>${q ? 'Fix and resubmit ' + esc(q.id) : 'New ' + esc(D.title.toLowerCase())}</h3>
      ${last ? `<p class="returned">Sent back: “${esc(last.comment)}”</p>` : ''}
      <label for="f_by">Your name<input id="f_by" name="__by" value="${esc(q ? q.by : 'You')}" maxlength="40" required></label>
      ${D.fields.map(input).join('')}
      <div class="acts"><button type="submit" class="btn">${q ? 'Resubmit' : 'Submit'}</button><button type="button" class="btn btn-line" data-cancel>Cancel</button></div></form>`;
  }
  $('#view-app').addEventListener('click', (e) => {
    const t = e.target;
    const play = t.closest('[data-play]'); if (play) { playAs = play.dataset.play; openId = null; renderProto(); save(); return; }
    const it = t.closest('[data-req]'); if (it) { openId = it.dataset.req; renderProto(); if (innerWidth < 800) $('#detail').scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    if (t.closest('[data-new]')) { openId = '__new'; renderProto(); return; }
    if (t.closest('[data-cancel]')) { openId = null; renderProto(); return; }
    const act = t.closest('[data-act]');
    if (act) {
      const q = REQ.find((x) => x.id === openId); const s = D.steps[q.step]; const cm = ($('#cmt') || {}).value || '';
      const who = roleOf(playAs);
      if (act.dataset.act === 'approve') { log(q, playAs, 'Approved by ' + who, cm); advance(q, q.step); }
      else if (act.dataset.act === 'done') { log(q, playAs, `${s.action} (${who})`, cm); advance(q, q.step); }
      else if (act.dataset.act === 'sendback' || (act.dataset.act === 'reject' && s.onReject === 'return')) {
        if (!cm.trim()) { toast('Add a comment so the requester knows what to fix'); $('#cmt').focus(); return; }
        log(q, playAs, 'Sent back by ' + who, cm); q.status = 'returned';
      } else { log(q, playAs, 'Rejected by ' + who, cm); q.status = 'rejected'; }
      save(); renderProto(); renderModel();
      const [l] = statusLabel(q); toast(`${q.id}: ${l}`);
    }
  });
  $('#view-app').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target; const fields = {};
    D.fields.forEach((x) => { if (x.calc) return; const el = f.elements[x.name]; if (!el) return; fields[x.name] = x.type === 'file' ? (el.files[0] ? el.files[0].name : ((REQ.find((q) => q.id === f.dataset.id) || { fields: {} }).fields[x.name] || '')) : (x.type === 'money' || x.type === 'number' ? +el.value : el.value.trim()); });
    if (fields['Start date'] && fields['End date'] && fields['End date'] < fields['Start date']) { toast('The end date is before the start date'); return; }
    let q;
    if (f.dataset.id) { q = REQ.find((x) => x.id === f.dataset.id); q.fields = fields; log(q, playAs, 'Resubmitted by ' + q.by); advance(q, 0); }
    else q = newReq(fields, f.elements.__by.value.trim() || 'You');
    openId = q.id; save(); renderProto();
    const [l] = statusLabel(q); toast(`${q.id} submitted: ${l.toLowerCase()}`);
  });
  $('#protoReset').addEventListener('click', () => { seedRequests(); openId = null; save(); renderProto(); toast('Sample requests restored'); });

  /* ---------- spec ---------- */
  function specMd() {
    const L = [`# ${D.title}: functional spec`, '', `_Generated by Process to App from this description:_`, '', '> ' + desc, '', '## Roles', ''];
    D.roles.forEach((r) => L.push(`- **${r.label}**`));
    L.push('', '## Data', '', `### ${D.title}`, '', '| Field | Type | Rule |', '|---|---|---|', `| Requested by | Person | set automatically |`);
    D.fields.forEach((f) => L.push(`| ${f.name} | ${f.calc === 'days' ? 'Number' : FTYPE[f.type] || f.type} | ${f.calc === 'days' ? 'calculated: end date − start date + 1' : f.type === 'file' ? 'optional' : 'required'} |`));
    L.push('| Status | Choice | see statuses |', '', '### Decision (audit trail)', '', 'Request, step, decided by, decision, comment, date and time.', '', '## Workflow', '');
    D.steps.forEach((s, i) => L.push(`${i + 1}. **${roleOf(s.roleKey)}**: ${s.action} _(${TYPE_LABEL[s.type].toLowerCase()})_${s.cond ? `, only if ${condText(s.cond)}` : ''}${s.type === 'approve' ? (s.onReject === 'return' ? '. If rejected: sent back to ' + roleOf(submitter()) + ' to fix and resubmit' : '. If rejected: the request ends as Rejected') : ''}`));
    L.push('', '## Statuses', '');
    states().forEach((s) => L.push(`- ${s.name}${s.cond ? ` (only if ${condText(s.cond)})` : ''}`));
    L.push('', '## Screens', '', `- New ${D.title.toLowerCase()} form (for ${roleOf(submitter())})`, '- "Waiting for me" inbox for each role, with a counter', '- Request detail: fields, decision buttons, comment, full history', `- "My requests" list for ${roleOf(submitter())}`, '- Admin: roles, users and thresholds' + (D.steps.some((s) => s.cond) ? ` (${D.steps.filter((s) => s.cond).map((s) => condText(s.cond)).join(', ')})` : ''), '');
    L.push('## Notifications', '', '- The next person in the workflow gets an email when a request is waiting for them', `- ${roleOf(submitter())} is notified when the request is approved, rejected or sent back`, '');
    L.push('## Rules', '', '- Nobody can approve their own request', '- A decision cannot be changed once recorded; a new decision is added instead', '- Comments are required when rejecting or sending back', '');
    return L.join('\n');
  }
  function md(src) {
    const inline = (s) => esc(s).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|\s|\()_([^_]+)_(?=[\s.,)]|$)/g, '$1<em>$2</em>');
    const out = []; const lines = src.split('\n'); let i = 0;
    while (i < lines.length) {
      const l = lines[i];
      if (/^#{1,3} /.test(l)) { const n = l.match(/^#+/)[0].length; out.push(`<h${n}>${inline(l.slice(n + 1))}</h${n}>`); i++; }
      else if (/^> /.test(l)) { out.push(`<blockquote>${inline(l.slice(2))}</blockquote>`); i++; }
      else if (/^\|/.test(l)) { const rows = []; while (i < lines.length && /^\|/.test(lines[i])) rows.push(lines[i++]); const cells = (r) => r.replace(/^\||\|$/g, '').split('|').map((c) => c.trim()); out.push('<table><thead><tr>' + cells(rows[0]).map((c) => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>' + rows.slice(2).map((r) => '<tr>' + cells(r).map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') + '</tbody></table>'); }
      else if (/^- /.test(l)) { const it = []; while (i < lines.length && /^- /.test(lines[i])) it.push(lines[i++].slice(2)); out.push('<ul>' + it.map((x) => `<li>${inline(x)}</li>`).join('') + '</ul>'); }
      else if (/^\d+\. /.test(l)) { const it = []; while (i < lines.length && /^\d+\. /.test(lines[i])) it.push(lines[i++].replace(/^\d+\. /, '')); out.push('<ol>' + it.map((x) => `<li>${inline(x)}</li>`).join('') + '</ol>'); }
      else if (l.trim()) { out.push(`<p>${inline(l)}</p>`); i++; } else i++;
    }
    return out.join('');
  }
  function renderSpec() { $('#spec').innerHTML = md(specMd()); }
  $('#copySpec').addEventListener('click', async () => { try { await navigator.clipboard.writeText(specMd()); toast('Spec copied'); } catch (e) { toast('Copy blocked by the browser. Use Download.'); } });
  $('#dlSpec').addEventListener('click', () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([specMd()], { type: 'text/markdown' })); a.download = 'spec-' + D.title.toLowerCase().replace(/[^\w]+/g, '-') + '.md'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); });

  /* ---------- tabs, templates, start ---------- */
  function show(tab) { $$('.tabs [role=tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab))); $$('#result .view').forEach((v) => { v.hidden = v.id !== 'view-' + tab; }); }
  $$('.tabs [role=tab]').forEach((b) => b.addEventListener('click', () => show(b.dataset.tab)));
  $('#templates').insertAdjacentHTML('beforeend', TEMPLATES.map(([n], i) => `<button type="button" class="chip-btn" data-tpl="${i}">${esc(n)}</button>`).join(''));
  $$('[data-tpl]').forEach((b) => b.addEventListener('click', () => { $('#desc').value = TEMPLATES[+b.dataset.tpl][1]; build(true); show('flow'); toast('Built from the example. Edit the text and press Design my app.'); }));
  $('#build').addEventListener('click', () => { build(true); show('flow'); $('#result').scrollIntoView({ behavior: 'smooth', block: 'start' }); });

  if (load()) { $('#desc').value = desc; build(false); }
  else { $('#desc').value = TEMPLATES[0][1]; build(true); }
})();

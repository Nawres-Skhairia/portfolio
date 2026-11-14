(function () {
  'use strict';
  const RB = window.Rulebench;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = RB.fmtMoney;
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const STORE = 'rulebench-v1:';

  const STORY = {
    commission: 'Sales leadership wants to reward new customers and big deals next year. This is their draft. Today every rep earns a flat rate per deal type, shown under "Rules in use today".',
    expenses: 'Finance wants tighter control on spending: small claims pass automatically, bigger ones go to a manager, and large ones to the finance director. Today, everything under 200 is automatic and everything else goes to a manager.',
  };

  const state = { id: 'commission', draft: null, cases: {}, attacked: {}, red: null, cov: [], rep: null, flash: null };
  const scn = () => RB.scenarios[state.id];

  function load(id) {
    try { const raw = localStorage.getItem(STORE + id); if (raw) return JSON.parse(raw); } catch (e) { /* storage may be blocked */ }
    return RB.clone(RB.scenarios[id].draft);
  }
  function save() { try { localStorage.setItem(STORE + state.id, JSON.stringify(state.draft)); } catch (e) { /* ignore */ } }
  function cases() { if (!state.cases[state.id]) state.cases[state.id] = scn().generate(7); return state.cases[state.id]; }
  const table = (plan) => ({ inputs: scn().inputs, rows: (plan || state.draft).rows });

  // ---------- plain-language ----------
  function condText(inp, c) {
    if (inp.type === 'number') {
      if (!c || (c.min == null && c.max == null)) return null;
      const l = inp.label.toLowerCase();
      if (c.min == null) return `${l} is under ${money(c.max)}`;
      if (c.max == null) return `${l} is ${money(c.min)} or more`;
      return `${l} is from ${money(c.min)} to under ${money(c.max)}`;
    }
    if (!c || !c.length || c.length === inp.values.length) return null;
    const v = c.length === 1 ? c[0] : c.slice(0, -1).join(', ') + ' or ' + c[c.length - 1];
    return `${inp.label.toLowerCase()} is ${v}`;
  }
  function outText(then) {
    if (state.id === 'commission') return `pay ${then.rate}% of the deal${then.bonus ? ` plus a ${money(then.bonus)} bonus` : ''}`;
    return then.approver === 'Auto' ? 'approve automatically' : `send to the ${then.approver.toLowerCase()}`;
  }
  function rowSentence(row) {
    const conds = scn().inputs.map((inp) => condText(inp, row.when[inp.key])).filter(Boolean);
    return `<b>${esc(row.id)}</b> ${conds.length ? 'If ' + esc(conds.join(' and ')) + ', ' : 'In every case, '}${esc(outText(row.then))}.`;
  }
  function regionText(region) {
    const conds = scn().inputs.map((inp) => condText(inp, region[inp.key])).filter(Boolean);
    return `${scn().caseLabelPlural} where ${conds.join(' and ')}`;
  }
  function settingsText(s) {
    if (state.id === 'expenses') return s.groupSplits ? 'Claims from the same person and merchant within 7 days are added up.' : 'Each claim is routed on its own.';
    const acc = s.multiplier > 1 ? `Accelerator ×${s.multiplier} once a rep reaches ${money(s.quota)} in a quarter.` : 'No accelerator.';
    return acc;
  }

  // ---------- rules editor ----------
  function renderEditor() {
    const S = scn();
    $('#scnStory').textContent = STORY[state.id];
    const flagged = new Set();
    state.cov.forEach((i) => i.rows.forEach((r) => flagged.add(r)));
    let h = '<thead><tr><th scope="col">Row</th>';
    S.inputs.forEach((i) => { h += `<th scope="col">${esc(i.label)}${i.type === 'number' ? ' <small>from → under</small>' : ''}</th>`; });
    S.outputs.forEach((o) => { h += `<th scope="col" class="out">${esc(o.label)}</th>`; });
    h += '<th scope="col"><span class="sr">Delete</span></th></tr></thead><tbody>';
    state.draft.rows.forEach((row, ri) => {
      h += `<tr class="${flagged.has(row.id) ? 'flag' : ''}${state.flash === row.id ? ' flash' : ''}" data-ri="${ri}"><th scope="row">${esc(row.id)}</th>`;
      S.inputs.forEach((inp) => {
        const c = row.when[inp.key];
        if (inp.type === 'number') {
          h += `<td><div class="rng"><label><span class="sr">${esc(inp.label)} from</span><input type="number" min="0" step="any" inputmode="decimal" placeholder="0" data-k="${inp.key}" data-b="min" value="${c && c.min != null ? c.min : ''}"></label><span aria-hidden="true">→</span><label><span class="sr">${esc(inp.label)} to under</span><input type="number" min="0" step="any" inputmode="decimal" placeholder="no limit" data-k="${inp.key}" data-b="max" value="${c && c.max != null ? c.max : ''}"></label></div></td>`;
        } else {
          const all = !c || !c.length || c.length === inp.values.length;
          h += '<td><div class="chips">';
          inp.values.forEach((v) => {
            const on = all || c.indexOf(v) !== -1;
            h += `<button type="button" class="chip${on ? ' on' : ''}" aria-pressed="${on}" data-k="${inp.key}" data-v="${esc(v)}">${esc(v)}</button>`;
          });
          h += '</div></td>';
        }
      });
      S.outputs.forEach((o) => {
        const v = row.then[o.key];
        if (o.type === 'enum') {
          h += `<td class="out"><label><span class="sr">${esc(o.label)}</span><select data-o="${o.key}">${o.values.map((x) => `<option${x === v ? ' selected' : ''}>${esc(x)}</option>`).join('')}</select></label></td>`;
        } else {
          h += `<td class="out"><label class="suffix"><span class="sr">${esc(o.label)}</span><input type="number" min="0" step="any" inputmode="decimal" data-o="${o.key}" value="${v}"><i>${o.type === 'percent' ? '%' : ''}</i></label></td>`;
        }
      });
      h += `<td><button type="button" class="del" data-del="${ri}" aria-label="Delete row ${esc(row.id)}">×</button></td></tr>`;
    });
    h += '</tbody>';
    $('#dt').innerHTML = h;
    $('#sentences').innerHTML = state.draft.rows.map((r) => `<li class="${flagged.has(r.id) ? 'flag' : ''}">${rowSentence(r)}</li>`).join('');

    // settings & safeguards
    let sh = '';
    S.settingsSpec.forEach((sp) => {
      const v = state.draft.settings[sp.key];
      if (sp.type === 'toggle') {
        sh += `<label class="toggle${sp.safeguard ? ' guard' : ''}"><input type="checkbox" data-s="${sp.key}"${v ? ' checked' : ''}><span>${sp.safeguard ? '<em>Safeguard</em> ' : ''}${esc(sp.label)}</span></label>`;
      } else if (sp.type === 'choice') {
        sh += `<label class="field"><span>${esc(sp.label)}</span><select data-s="${sp.key}">${sp.options.map(([k, l]) => `<option value="${k}"${k === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
      } else {
        sh += `<label class="field"><span>${esc(sp.label)}</span><span class="suffix">${sp.type === 'multiplier' ? '<i class="pre">×</i>' : ''}<input type="number" min="${sp.type === 'multiplier' ? 1 : 0}" step="${sp.type === 'multiplier' ? 0.1 : 1000}" data-s="${sp.key}" value="${v}"></span></label>`;
      }
    });
    $('#settings').innerHTML = sh;
    $('#todayRules').innerHTML = S.current.rows.map((r) => `<li>${rowSentence(r)}</li>`).join('');
    $('#todaySettings').textContent = settingsText(S.current.settings);
    state.flash = null;
  }

  function onEditorInput(e) {
    const t = e.target;
    const tr = t.closest('tr[data-ri]');
    if (t.dataset.s) {
      const sp = scn().settingsSpec.find((x) => x.key === t.dataset.s);
      state.draft.settings[sp.key] = sp.type === 'toggle' ? t.checked : sp.type === 'choice' ? t.value : Math.max(sp.type === 'multiplier' ? 1 : 0, parseFloat(t.value) || 0);
      changed(sp.type === 'toggle' || sp.type === 'choice');
      return;
    }
    if (!tr) return;
    const row = state.draft.rows[+tr.dataset.ri];
    if (t.dataset.o) {
      row.then[t.dataset.o] = t.tagName === 'SELECT' ? t.value : Math.max(0, parseFloat(t.value) || 0);
    } else if (t.dataset.b) {
      const k = t.dataset.k;
      const c = row.when[k] || { min: null, max: null };
      c[t.dataset.b] = t.value === '' ? null : Math.max(0, parseFloat(t.value));
      row.when[k] = (c.min == null && c.max == null) ? null : c;
    }
    changed(false);
  }
  function onEditorClick(e) {
    const chip = e.target.closest('.chip');
    const del = e.target.closest('[data-del]');
    if (chip) {
      const row = state.draft.rows[+chip.closest('tr').dataset.ri];
      const inp = scn().inputs.find((i) => i.key === chip.dataset.k);
      let cur = row.when[inp.key];
      cur = (!cur || !cur.length) ? inp.values.slice() : cur.slice();
      const v = chip.dataset.v;
      if (cur.indexOf(v) !== -1) { if (cur.length === 1) { toast('A row needs at least one value. Delete the row instead.'); return; } cur.splice(cur.indexOf(v), 1); } else cur.push(v);
      row.when[inp.key] = cur.length === inp.values.length ? null : inp.values.filter((x) => cur.indexOf(x) !== -1);
      changed(true);
    } else if (del) {
      state.draft.rows.splice(+del.dataset.del, 1);
      changed(true);
    }
  }
  function nextId() {
    const prefix = (state.draft.rows[0] && state.draft.rows[0].id.replace(/\d+$/, '')) || 'R';
    let n = 1;
    state.draft.rows.forEach((r) => { const m = r.id.match(/(\d+)$/); if (m) n = Math.max(n, +m[1] + 1); });
    return prefix + n;
  }
  function addRow(when, then) {
    const S = scn();
    const row = { id: nextId(), when: when || {}, then: then || RB.clone(state.draft.rows[0] ? state.draft.rows[0].then : {}) };
    S.inputs.forEach((i) => { if (!(i.key in row.when)) row.when[i.key] = null; });
    S.outputs.forEach((o) => { if (!(o.key in row.then)) row.then[o.key] = o.type === 'enum' ? o.values[0] : 0; });
    state.draft.rows.push(row);
    state.flash = row.id;
    return row;
  }

  // ---------- tests ----------
  let timer = null;
  function changed(immediate) {
    save();
    clearTimeout(timer);
    if (immediate) { runAll(); renderEditor(); }
    else timer = setTimeout(() => { runAll(); renderEditorFlagsOnly(); }, 250);
  }
  function renderEditorFlagsOnly() {
    // Keep focus while typing: only refresh flags and sentences.
    const flagged = new Set();
    state.cov.forEach((i) => i.rows.forEach((r) => flagged.add(r)));
    document.querySelectorAll('#dt tr[data-ri]').forEach((tr) => {
      const r = state.draft.rows[+tr.dataset.ri];
      tr.classList.toggle('flag', !!r && flagged.has(r.id));
    });
    $('#sentences').innerHTML = state.draft.rows.map((r) => `<li class="${flagged.has(r.id) ? 'flag' : ''}">${rowSentence(r)}</li>`).join('');
  }

  function runAll() {
    const S = scn();
    state.cov = RB.coverage(table());
    state.rep = RB.replay(S, S.current, state.draft, cases());
    state.red = state.attacked[state.id] ? RB.redTeam(S, state.draft, cases()) : null;
    renderScores(); renderCoverage(); renderReplay(); renderRed(false);
  }

  function materialExploits() { return state.red ? state.red.exploits.filter((e) => e.severity !== 'low') : []; }

  function renderScores() {
    const S = scn();
    const gaps = state.cov.filter((i) => i.kind === 'gap').length;
    const conf = state.cov.length - gaps;
    const mat = materialExploits();
    const costM = state.rep.metrics[0];
    const delta = costM.before ? (costM.after - costM.before) / costM.before : 0;
    const tiles = [
      {
        cls: !state.red ? 'idle' : mat.length ? 'bad' : 'good',
        label: 'Red team',
        val: !state.red ? 'Not run' : mat.length ? `${mat.length} exploit${mat.length > 1 ? 's' : ''}` : 'No exploit',
        sub: !state.red ? 'Press "Attack this rule"' : `${state.red.tried.toLocaleString('en-US')} strategies tried`,
        go: '#redPanel',
      },
      {
        cls: state.cov.length ? 'bad' : 'good',
        label: 'Coverage',
        val: state.cov.length ? `${state.cov.length} issue${state.cov.length > 1 ? 's' : ''}` : 'Complete',
        sub: state.cov.length ? `${gaps} gap${gaps === 1 ? '' : 's'}, ${conf} conflict${conf === 1 ? '' : 's'}` : 'Every case has exactly one answer',
        go: '#covPanel',
      },
      state.id === 'commission' ? {
        cls: 'info', label: 'Replay', val: `${delta >= 0 ? '+' : ''}${Math.round(delta * 100)}% cost`, sub: `${money(costM.before)} → ${money(costM.after)} on last year`, go: '#replayPanel',
      } : {
        cls: 'info', label: 'Replay', val: `${state.rep.changedCount} of ${cases().length}`, sub: `${S.caseLabelPlural} routed differently than today`, go: '#replayPanel',
      },
    ];
    $('#scores').innerHTML = tiles.map((t) => `<a class="score ${t.cls}" href="${t.go}"><span class="s-label">${t.label}</span><span class="s-val">${esc(t.val)}</span><span class="s-sub">${esc(t.sub)}</span></a>`).join('');
  }

  function fixApplied(x) { return state.draft.settings[x.fixKey] === x.fixValue; }

  function gainText(e) {
    if (state.id === 'commission') {
      const pct = Math.round(e.gain / state.red.honestTotal * 1000) / 10;
      return `<b><span class="pl">+</span>${money(e.gain)}</b> extra commission, ${pct}% of the plan's cost`;
    }
    return `<b>${money(e.impact)}</b> of spending could reach a lower approver than it should`;
  }

  function renderRed(animate) {
    const out = $('#redOut');
    const btn = $('#attackBtn');
    if (!state.red) {
      btn.textContent = 'Attack this rule';
      out.innerHTML = `<p class="hint">The red team plays the ${scn().actorLabel} and looks for the moves that pay the most, using only things a real ${scn().actorLabel} controls.</p>`;
      return;
    }
    btn.textContent = 'Attack again';
    const r = state.red;
    const S = scn();
    const shown = r.exploits.filter((e) => e.severity !== 'low');
    const minor = r.exploits.filter((e) => e.severity === 'low');
    let h = `<p class="tried"><span class="count" data-to="${r.tried}">${animate ? 0 : r.tried.toLocaleString('en-US')}</span> strategies tried across ${new Set(cases().map((c) => c[S.actorKey])).size} ${S.actorLabel}s</p>`;
    if (!shown.length) {
      h += `<div class="ok-box"><b>No material exploit found.</b> The red team could not find a move worth more than 1% of the total.${minor.length ? ` It found ${minor.length === 1 ? 'one minor effect' : minor.length + ' minor effects'} (${minor.map((m) => '+' + money(m.gain)).join(', ')}), small enough to accept.` : ''}</div>`;
    }
    shown.forEach((e, i) => {
      const x = S.exploitText[e.kind];
      const applied = fixApplied(x);
      h += `<article class="exploit${animate ? ' reveal' : ''}" style="--d:${i * 0.25 + 0.9}s">
        <div class="ex-head"><span class="sev ${e.severity}">${e.severity === 'high' ? 'High' : 'Medium'}</span><h4>${esc(x.title)}</h4></div>
        <p class="gain">${gainText(e)}. Found ${e.count} time${e.count > 1 ? 's' : ''}, ${e.actors.length} of ${new Set(cases().map((c) => c[S.actorKey])).size} ${S.actorLabel}s can use it.</p>
        <p class="example"><span>Example</span> ${esc(e.example.text)}${state.id === 'commission' ? `, earning <b>+${money(e.example.gain)}</b>` : ''}.</p>
        <p class="why">${esc(x.why)}</p>
        ${applied ? `<p class="hint">The suggested fix is already on. What remains comes from how other rules interact: check the coverage issues below, then attack again.</p>` : `<button type="button" class="btn btn-line fix-btn" data-fix="${e.kind}">Apply fix: ${esc(x.fix.toLowerCase())}</button>`}
      </article>`;
    });
    out.innerHTML = h;
    if (animate) countUp(out.querySelector('.count'));
  }

  function countUp(el) {
    const to = +el.dataset.to;
    if (reduced) { el.textContent = to.toLocaleString('en-US'); return; }
    const t0 = performance.now();
    const step = (t) => {
      const p = Math.min(1, (t - t0) / 900);
      el.textContent = Math.round(to * (1 - Math.pow(1 - p, 3))).toLocaleString('en-US');
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function attack() {
    const btn = $('#attackBtn');
    btn.disabled = true;
    btn.textContent = 'Attacking…';
    setTimeout(() => {
      state.attacked[state.id] = true;
      state.red = RB.redTeam(scn(), state.draft, cases());
      renderScores();
      renderRed(true);
      btn.disabled = false;
    }, 30);
  }

  function renderCoverage() {
    const S = scn();
    const out = $('#covOut');
    if (!state.cov.length) {
      out.innerHTML = '<div class="ok-box"><b>Complete.</b> Every possible case matches exactly one answer.</div>';
      return;
    }
    const t = table();
    out.innerHTML = state.cov.map((iss, idx) => {
      const n = cases().filter((c) => RB.inRegion(t, iss.region, c)).length;
      const real = n ? `<b>${n} real ${n > 1 ? S.caseLabelPlural : S.caseLabel}</b> from last year fall here.` : 'No case from last year falls here yet.';
      if (iss.kind === 'gap') {
        return `<article class="issue"><span class="sev gap">Gap</span><p>No rule covers <b>${esc(regionText(iss.region))}</b>. ${real} ${state.id === 'commission' ? 'Those deals would earn nothing.' : 'Those claims would sit in a shared inbox with no approver.'}</p><button type="button" class="btn btn-line" data-gap="${idx}">Add a row for this case</button></article>`;
      }
      const rows = iss.rows.map((id) => state.draft.rows.find((r) => r.id === id));
      const outs = rows.map((r) => `${r.id}: ${outText(r.then)}`).join(' / ');
      return `<article class="issue"><span class="sev conflict">Conflict</span><p>Rows <b>${esc(iss.rows.join(' and '))}</b> both match <b>${esc(regionText(iss.region))}</b> but disagree (${esc(outs)}). ${real} Today the first row wins, which nobody may have intended.</p><button type="button" class="btn btn-line" data-conflict="${idx}">Let ${esc(iss.rows[0])} win and shrink ${esc(iss.rows[iss.rows.length - 1])}</button></article>`;
    }).join('');
  }

  function fixGap(iss) {
    const k = scn().inputs.find((i) => i.type === 'number').key;
    const when = RB.clone(iss.region);
    // Copy the result of the row just below the gap, if there is one.
    const near = state.draft.rows.find((r) => r.when[k] && r.when[k].max === iss.region[k].min && scn().inputs.every((inp) => inp.type === 'number' || !r.when[inp.key] || iss.region[inp.key].every((v) => r.when[inp.key].indexOf(v) !== -1)));
    scn().inputs.forEach((inp) => { if (inp.type === 'enum' && when[inp.key].length === inp.values.length) when[inp.key] = null; });
    if (when[k].min === 0) when[k].min = null;
    const row = addRow(when, RB.clone((near || state.draft.rows[0]).then));
    toast(`Added row ${row.id}. Check its result, it was copied from ${(near || state.draft.rows[0]).id}.`);
  }
  function fixConflict(iss) {
    const k = scn().inputs.find((i) => i.type === 'number').key;
    const A = state.draft.rows.find((r) => r.id === iss.rows[0]);
    const later = iss.rows.slice(1).map((id) => state.draft.rows.find((r) => r.id === id));
    const lo = (c) => (c && c.min != null ? c.min : -Infinity);
    const hi = (c) => (c && c.max != null ? c.max : Infinity);
    const a = A.when[k];
    later.forEach((B) => {
      const b = B.when[k] || { min: null, max: null };
      if (lo(b) >= lo(a) && hi(b) > hi(a) && hi(a) !== Infinity) b.min = a.max;
      else if (lo(b) < lo(a)) b.max = a.min;
      else {
        // B sits inside A on the amount: remove the overlapping values from B instead.
        scn().inputs.filter((i) => i.type === 'enum').some((inp) => {
          const av = A.when[inp.key] || inp.values, bv = B.when[inp.key] || inp.values;
          const rest = bv.filter((v) => av.indexOf(v) === -1);
          if (rest.length) { B.when[inp.key] = rest; return true; }
          return false;
        });
      }
      B.when[k] = (b.min == null && b.max == null) ? null : b;
    });
    toast(`Row ${later.map((r) => r.id).join(', ')} narrowed so ${A.id} applies alone.`);
  }

  function renderReplay() {
    const S = scn();
    const r = state.rep;
    $('#replaySub').textContent = `${cases().length} real ${S.caseLabelPlural} from last year, today's rules vs the draft`;
    const fmt = (m, v) => (m.fmt === 'money' ? money(v) : Math.round(v).toLocaleString('en-US'));
    let h = '<div class="mt-wrap"><table class="mt"><thead><tr><th scope="col"></th><th scope="col">Today</th><th scope="col">Draft</th><th scope="col">Change</th></tr></thead><tbody>';
    r.metrics.forEach((m) => {
      const d = m.after - m.before;
      const pct = m.before ? ` (${d >= 0 ? '+' : ''}${Math.round(d / m.before * 100)}%)` : '';
      const cls = d === 0 ? '' : (m.bad === 'up' && d > 0) ? 'worse' : (m.bad === 'up' && d < 0) ? 'better' : '';
      h += `<tr class="${m.alarm && m.after > 0 ? 'alarm' : ''}"><th scope="row">${esc(m.label)}</th><td>${fmt(m, m.before)}</td><td>${fmt(m, m.after)}</td><td class="${cls}">${d === 0 ? '·' : (d > 0 ? '+' : '−') + fmt(m, Math.abs(d)) + pct}</td></tr>`;
    });
    h += '</tbody></table></div>';

    // Bars: per rep cost, or per approver workload.
    let bars;
    if (state.id === 'commission') {
      bars = Object.keys(r.before.byActor).map((k) => ({ label: k, a: r.before.byActor[k], b: r.after.byActor[k], fmt: money }));
      h += '<h4 class="bars-title">Commission per rep, before accelerators</h4>';
    } else {
      bars = ['Auto', 'Manager', 'Finance director'].map((k) => ({ label: k === 'Auto' ? 'Automatic' : k, a: r.before.counts[k], b: r.after.counts[k], fmt: (v) => v }));
      bars.push({ label: 'No rule', a: r.before.undef, b: r.after.undef, fmt: (v) => v, alarm: true });
      h += '<h4 class="bars-title">Claims per approver</h4>';
    }
    const max = Math.max(1, ...bars.map((x) => Math.max(x.a, x.b)));
    h += '<div class="bars">' + bars.map((x) => `<div class="bar-row${x.alarm && x.b ? ' alarm' : ''}"><span class="b-label">${esc(x.label)}</span><div class="b-pair"><span class="b today" style="width:${x.a / max * 100}%"></span><span class="b draft" style="width:${x.b / max * 100}%"></span></div><span class="b-val">${x.fmt(x.a)} → <b>${x.fmt(x.b)}</b></span></div>`).join('') + '</div>';
    h += '<p class="hint"><i class="key today"></i>Today &nbsp; <i class="key draft"></i>Draft</p>';

    if (r.changed.length) {
      h += `<h4 class="bars-title">Biggest changes, ${r.changedCount} ${S.caseLabelPlural} in total</h4><ul class="changes">`;
      r.changed.slice(0, 5).forEach((c) => { h += `<li><span>${esc(S.describeCase(c.c))}</span><span class="ch">${esc(c.before.label)} → <b>${esc(c.after.label)}</b></span></li>`; });
      h += '</ul>';
    }
    $('#replayOut').innerHTML = h;
  }

  // ---------- scenario switch, tour ----------
  function setScenario(id) {
    state.id = id;
    state.draft = load(id);
    document.querySelectorAll('[data-scn]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.scn === id)));
    runAll(); renderEditor();
  }

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 3200);
  }
  function goTo(sel) { const el = $(sel); el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' }); el.classList.add('pulse'); setTimeout(() => el.classList.remove('pulse'), 1400); }

  document.addEventListener('click', (e) => {
    const t = e.target.closest('button, a');
    if (!t) return;
    if (t.dataset.scn) setScenario(t.dataset.scn);
    else if (t.id === 'attackBtn') attack();
    else if (t.id === 'resetDraft') { state.draft = RB.clone(scn().draft); state.attacked[state.id] = false; changed(true); toast('Draft reset to the original version.'); }
    else if (t.id === 'addRow') { addRow(); changed(true); }
    else if (t.id === 'printBtn') window.print();
    else if (t.dataset.fix) {
      const x = scn().exploitText[t.dataset.fix];
      state.draft.settings[x.fixKey] = x.fixValue;
      changed(true);
      toast('Fix applied. The red team attacked the new version.');
    } else if (t.dataset.gap) { fixGap(state.cov[+t.dataset.gap]); changed(true); }
    else if (t.dataset.conflict) { fixConflict(state.cov[+t.dataset.conflict]); changed(true); }
    else if (t.dataset.tour) {
      const k = t.dataset.tour;
      if (k === 'attack') { goTo('#redPanel'); attack(); }
      else if (k === 'fix') {
        Object.values(scn().exploitText).forEach((x) => { state.draft.settings[x.fixKey] = x.fixValue; });
        state.attacked[state.id] = true;
        changed(true);
        goTo('#redPanel');
        toast('All red team fixes applied. Now check the coverage issues.');
      } else goTo('#replayPanel');
    }
  });
  $('#dt').addEventListener('input', onEditorInput);
  $('#dt').addEventListener('click', onEditorClick);
  $('#settings').addEventListener('change', onEditorInput);
  $('#settings').addEventListener('input', (e) => { if (e.target.type === 'number') onEditorInput(e); });

  setScenario('commission');
})();

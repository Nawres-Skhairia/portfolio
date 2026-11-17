// Reconciliation Workbench: the page. Everything happens in this tab; nothing is uploaded or stored.
import { readStatement, CAMT, STM_RULES, fmt } from './camt053.js';
import { readInvoices, INVOICE_FIELDS, MAX_INVOICE_BYTES } from './invoices.js';
import { createSession, accept, reject, manual, manualPreview, undo, changeSettings, personDecisions, verifyTrail, readyToReconcile, mappingCancelled, REC_RULES, REC_TOOL, REC_CATALOGUE_VERSION, TREATMENT, DEFAULT_SETTINGS, amt, remShown, openOf } from './rec-engine.js';
import { trailCsv, trailJsonl, openInvoicesCsv, recHtml, recJUnit, parseTrail } from './rec-reports.js';
import { REC_SAMPLES, SAMPLE_ACCOUNT } from './rec-samples.js';
import { validate, loadSchema } from './schema.js';
import { sha256 } from './sha256.js';
import { MAX_BYTES, sizeWords } from './engine.js';
import { euro, groupIban, money } from './rules.js';

const $ = (id) => document.getElementById(id);
const h = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const xsdReady = loadSchema(new URL('../schemas/' + CAMT.xsd, import.meta.url).href);
const state = { go: false, box: 'check', no: null, stmtSrc: '', stmtName: '', invSrc: '', invName: '', sample: true, statement: null, inv: null, session: null, filter: 'review', sel: null, manual: null, run: 0, busy: false };
const PLACE = { auto: 'Auto-matched', person: 'Decided by you', review: 'To review', unmatched: 'Unmatched' };
const KIND = { auto: 'Auto-matched', accepted: 'Accepted', manual: 'Manual' };
const dateWord = (iso) => { const t = Date.parse((iso || '') + 'T00:00:00Z'); return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : iso || '—'; };

// ---------- load and reconcile ----------
async function run() {
  const my = ++state.run;
  state.session = null; state.sel = null; state.manual = null; state.busy = true; render();
  const bytes = new TextEncoder().encode(state.stmtSrc).length;
  let st;
  try {
    const xsd = await xsdReady;
    st = await readStatement(state.stmtSrc, { bytes, validateSchema: (xml) => validate(xml, xsd, CAMT.xsd) });
  } catch (e) { st = { status: 'failed', reason: String(e.message || e), findings: [], reconcilable: false }; }
  if (my !== state.run) return;
  state.statement = st;
  state.inv = readInvoices(state.invSrc);
  state.busy = false;
  if (state.inv.needsMapping && state.inv.headers.length) { render(); askMapping(); return; }
  start();
}
// an old result never stays on screen once the inputs change (Daniel, PORT-42 10669)
function clearRun() { state.session = null; state.sel = null; state.manual = null; }
function start(settings) {
  const st = state.statement;
  clearRun();
  if (readyToReconcile(st, state.inv).ok) {
    state.session = createSession({ stmt: st.stmt, invoices: state.inv.invoices, settings: settings || readTolerance() || DEFAULT_SETTINGS,
      inputs: { stmtName: state.stmtName, stmtSha: sha256(state.stmtSrc), invName: state.invName, invSha: sha256(state.invSrc) } });
    state.filter = state.session.view.counts.review ? 'review' : 'all';
    if (state.box === 'check' && !state.session.view.counts.review) state.box = 'paid';
    const first = firstOf(state.filter); state.sel = first ? first.ref : null;
  }
  render();
}

// ---------- tolerance ----------
function readTolerance() {
  const a = $('tolAbs').value.trim().replace(',', '.'), p = $('tolPct').value.trim().replace(',', '.');
  const abs = money(a); const pct = /^\d{1,2}(\.\d{1,2})?$/.test(p) ? Math.round(Number(p) * 100) : null;
  if (abs == null || pct == null || pct > 1000) return null;
  return { tolAbs: abs, tolBp: pct };
}
$('tolForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const t = readTolerance();
  if (!t) { $('banner').textContent = 'The tolerance must be an amount such as 5.00 and a percent from 0 to 10, such as 0.5. Use 0 to switch small differences off.'; return; }
  const s = state.session; if (!s) return;
  if (t.tolAbs === s.settings.tolAbs && t.tolBp === s.settings.tolBp) { $('banner').textContent = 'The tolerance is unchanged, so nothing was restarted.'; return; }
  const n = personDecisions(s);
  if (n && !window.confirm(`Changing the tolerance restarts the reconciliation from the files: ${n} decision${n > 1 ? 's' : ''} made by you (accepted, rejected or manual) will be undone. The audit trail keeps them and adds a "settings changed" line. Continue?`)) return;
  changeSettings(s, t); state.sel = null; render();
});

// ---------- render ----------
function fact(label, value, mono) { const d = h('div', 'fact'); d.append(h('span', 'f-l', label), h('span', 'f-v' + (mono ? ' mono' : ''), value || '—')); return d; }
function render() { renderAdv(); renderSimple(); }
function renderAdv() {
  const st = state.statement, s = state.session;
  const stm = st && st.stmt;
  $('facts').replaceChildren(fact('Statement', stm ? stm.id : '—', true), fact('Account', stm && stm.iban ? groupIban(stm.iban) : '—', true), fact('Date', stm ? dateWord(stm.date) : '—'), fact('Entries', stm ? `${stm.totals ? stm.totals.nCr : '?'} credits, ${stm.totals ? stm.totals.nDb : '?'} debits` : '—'));
  const v = $('verdict');
  let chip = 'Checking…', line = 'Reading the statement and checking it against the camt.053.001.08 schema…', cls = 'v-busy';
  if (!state.busy && st) {
    if (s) { const c = s.view.counts; chip = c.review ? 'Needs your review' : c.unmatched ? 'Reconciled, with unmatched entries' : 'Reconciled'; cls = c.review ? 'v-warn' : c.unmatched ? 'v-warn' : 'v-ok'; line = `${c.auto + c.person} of ${c.entries} entries matched · ${c.review} to review · ${c.unmatched} unmatched`; }
    else if (!st.reconcilable) { chip = 'Not reconciled'; cls = 'v-bad'; line = st.reason || (st.status === 'schema-errors' ? 'The statement does not follow the camt.053.001.08 schema. Nothing was matched.' : st.status === 'not-wellformed' ? 'The statement is not well-formed XML. Nothing was matched.' : 'The statement failed a control check. Nothing was matched.'); }
    else if (!state.inv.ok) { chip = 'Invoices not read'; cls = 'v-bad'; line = state.inv.error; }
  }
  v.className = 'verdict ' + cls; v.replaceChildren(h('span', 'v-chip', chip), h('span', 'v-line', line));
  // banner and integrity line
  if (stm) {
    const t = stm.totals;
    $('banner').textContent = state.sample
      ? `Made-up statement from a pretend bank, ${dateWord(stm.date)}, account ${groupIban(stm.iban || '')}${stm.iban === SAMPLE_ACCOUNT ? ' (published example)' : ''}, ${t.nCr} credit entries, ${t.nDb} debit entries. ${state.inv.invoices.length || 'No'} open invoices from a pretend company.`
      : `Statement ${stm.id} (${state.stmtName}), ${dateWord(stm.date)}, account ${groupIban(stm.iban || '')}, ${t.nCr} credits and ${t.nDb} debits. Invoices: ${state.inv.ok ? state.inv.invoices.length + ' from ' + state.invName : 'not read'}.`;
    const b = stm.balance;
    $('integrity').replaceChildren(...integrity(st));
    $('integrity').className = 'integrity ' + (b && b.ok ? 'ok' : 'bad');
  } else { $('banner').textContent = st && !state.busy ? st.reason || '' : ''; $('integrity').textContent = ''; }
  renderStmtFindings();
  $('workArea').hidden = !s;
  $('exportBtn').disabled = !s; $('manualBtn').disabled = !s; $('undoBtn').disabled = !(s && s.undo.length);
  if (!s) { renderTrail(); renderTotals(); return; }
  const c = s.view.counts;
  for (const k of ['auto', 'person', 'review', 'unmatched']) $('c-' + k).textContent = c[k];
  $('c-all').textContent = c.entries;
  for (const b of document.querySelectorAll('.flt')) b.classList.toggle('on', b.dataset.filter === state.filter);
  const tt = s.view.totals;
  $('invCount').textContent = `Invoices: ${c.closed} closed, ${c.partly} partly paid, ${c.open} open (${c.untouched} with nothing proposed). Matched ${amt(tt.matched)} · still to settle ${amt(tt.review + tt.unmatched)}.`;
  const grouped = s.view.suggestions.find((p) => p.invoices.length > 1);
  $('lead').textContent = state.filter === 'review' && grouped ? `One payment of ${amt(grouped.paid)} from ${s.byNum.get(grouped.invoices[0]).customer} pays ${grouped.invoices.length} invoices (${grouped.invoices.join(', ')}). Grouped match, needs your confirmation.` : '';
  renderEntries(); renderCards(); renderInvoices(); renderManual(); renderTrail(); renderTotals();
}
function integrity(st) {
  const out = [];
  const sv = st.schema; out.push(h('span', null, `Statement schema: ${sv ? (sv.valid ? 'valid' : sv.errors.length + ' error' + (sv.errors.length > 1 ? 's' : '')) : 'not checked'}. `));
  const b = st.stmt.balance, t = st.stmt.totals;
  if (b) out.push(h('span', null, `Balances: opening ${fmt(b.opening)} + credits ${euro(t.credits)} − debits ${euro(t.debits)} = ${b.ok ? 'closing ' + fmt(b.closing) + ' ✓' : fmt(b.expected) + ', but the closing balance says ' + fmt(b.closing) + ' ✗'}.`));
  if (t.pending) out.push(h('span', null, ` ${t.pending} pending entr${t.pending > 1 ? 'ies' : 'y'} shown apart.`));
  return out;
}
function renderStmtFindings() {
  const list = $('stmtFindings'); const st = state.statement;
  const items = st ? st.findings : [];
  list.hidden = !items.length; list.replaceChildren();
  for (const f of items) {
    const li = h('li', 'card sev-' + (f.severity === 'error' ? 'error' : f.severity === 'warning' ? 'warning' : 'info'));
    const top = h('div', 'c-top'); top.append(h('span', 'sev', f.severity === 'error' ? 'Error' : f.severity === 'warning' ? 'Warning' : 'Information'), h('span', 'rid', f.id), h('span', 'where', f.line ? 'Line ' + f.line : 'No line'));
    li.append(top, h('p', 'msg', f.message)); if (f.fix) li.append(h('p', 'fix', 'What to do: ' + f.fix));
    list.append(li);
  }
}
const placeOf = (ref) => state.session.view.places.get(ref);
const shown = () => state.session.entries.filter((e) => state.filter === 'all' || placeOf(e.ref).place === state.filter);
function firstOf(filter) { const s = state.session; return s.entries.find((e) => filter === 'all' || s.view.places.get(e.ref).place === filter) || null; }
function involved(ref) { const p = placeOf(ref); return new Set(p.match ? p.match.invoices : p.sug ? p.sug.invoices : p.un ? p.un.candidates : []); }

function renderEntries() {
  const ul = $('entList'); ul.replaceChildren();
  const list = state.manual ? state.session.entries : shown();
  const hotInv = state.sel ? null : null; void hotInv;
  for (const e of list) {
    const p = placeOf(e.ref);
    const li = h('li', 'ritem' + (state.sel === e.ref ? ' sel' : '') + (state.manual && state.manual.entries.has(e.ref) ? ' pick' : ''));
    li.tabIndex = 0; li.dataset.ref = e.ref;
    const top = h('div', 'r-top'); top.append(h('span', 'r-amt mono', (e.cd === 'DBIT' ? '−' : '') + amt(e.amt)), h('span', 'st st-' + p.place, PLACE[p.place]));
    li.append(top, h('div', 'r-who', e.payer || (e.cd === 'DBIT' ? 'Bank' : 'Unknown payer')), h('div', 'r-rem small', remShown(e)), h('div', 'r-ref small mono muted', e.ref));
    li.addEventListener('click', () => clickEntry(e.ref));
    li.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') clickEntry(e.ref); });
    ul.append(li);
  }
  $('entMeta').textContent = state.manual ? 'click to add to the manual match' : `${list.length} shown`;
}
function clickEntry(ref) {
  if (state.manual) { toggle(state.manual.entries, ref); render(); return; }
  state.sel = ref; render();
  const card = $('cards').querySelector(`[data-ref="${ref}"]`); if (card) card.scrollIntoView({ block: 'nearest' });
}
function renderInvoices() {
  const s = state.session, ul = $('invList'); ul.replaceChildren();
  const hot = state.sel ? involved(state.sel) : new Set();
  const rows = s.view.invState.slice().sort((a, b) => (hot.has(b.inv.number) - hot.has(a.inv.number)) || ((a.status === 'closed') - (b.status === 'closed')) || (a.inv.number < b.inv.number ? -1 : 1));
  for (const x of rows) {
    const li = h('li', 'ritem' + (hot.has(x.inv.number) ? ' hot' : '') + (state.manual && state.manual.invoices.has(x.inv.number) ? ' pick' : '') + (x.status === 'closed' ? ' done' : ''));
    li.tabIndex = 0;
    const top = h('div', 'r-top'); top.append(h('span', 'r-num mono', x.inv.number), h('span', 'st st-inv-' + x.status.replace(' ', '-'), x.status === 'partly paid' ? 'Partly paid' : x.status === 'closed' ? 'Closed' : x.suggested.length ? 'Proposed' : 'Open'));
    li.append(top, h('div', 'r-who', x.inv.customer), h('div', 'r-rem small mono', `${amt(x.inv.amount)} ${x.inv.currency}` + (x.status === 'partly paid' ? ` · ${amt(x.open)} left` : '') + (x.inv.due ? ` · due ${x.inv.due}` : '')));
    if (x.inv.reference) li.append(h('div', 'r-ref small mono muted', x.inv.reference));
    const go = () => { if (state.manual) { if (x.status !== 'closed') { toggle(state.manual.invoices, x.inv.number); render(); } return; } const m = s.matches.find((mm) => mm.invoices.includes(x.inv.number)) || s.view.suggestions.find((p) => p.invoices.includes(x.inv.number)); if (m) { const ref = m.entries[0]; const pl = placeOf(ref).place; if (state.filter !== 'all' && state.filter !== pl) state.filter = pl; state.sel = ref; render(); } };
    li.addEventListener('click', go); li.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') go(); });
    ul.append(li);
  }
  $('invMeta').textContent = `${s.invoices.length} in the list`;
}
const toggle = (set, k) => (set.has(k) ? set.delete(k) : set.add(k));

function evidenceList(ev) {
  const ul = h('ul', 'ev');
  for (const l of ev) { const li = h('li', 'ev-' + (l.m === '✓' ? 'ok' : l.m === '≈' ? 'near' : 'no')); li.append(h('span', 'ev-m', l.m), h('span', 'ev-k', l.k), h('span', 'ev-t', l.t)); ul.append(li); }
  return ul;
}
function entryBlock(e) {
  const d = h('div', 'cb');
  d.append(h('div', 'cb-h', 'Statement entry'), h('div', 'cb-l mono', `${e.ref} · booked ${e.bookDate || '—'} · ${(e.cd === 'DBIT' ? '−' : '') + amt(e.amt)} ${e.ccy}` + (e.instd && e.instd.ccy !== e.ccy ? ` (paid ${e.instd.ccy} ${amt(e.instd.amt)})` : '')),
    h('div', 'cb-l', `${e.cd === 'DBIT' ? 'To' : 'From'} ${e.payer || '(no name)'}${e.payerIban ? ' · ' + groupIban(e.payerIban) : ''}`), h('div', 'cb-l small', 'Payment details: ' + remShown(e)));
  return d;
}
function invoiceBlock(nums, s) {
  const d = h('div', 'cb'); d.append(h('div', 'cb-h', nums.length > 1 ? `${nums.length} invoices` : 'Invoice'));
  for (const n of nums) { const i = s.byNum.get(n); d.append(h('div', 'cb-l mono', `${i.number} · ${i.customer} · ${amt(i.amount)} ${i.currency}` + (openOf(s, i) !== i.amount ? ` (open ${amt(openOf(s, i))})` : '') + (i.due ? ` · due ${i.due}` : '') + (i.reference ? ` · ${i.reference}` : ''))); }
  return d;
}
const ruleName = (id) => (REC_RULES.find((r) => r.id === id) || STM_RULES.find((r) => r.id === id) || { name: id === 'MANUAL' ? 'Manual match' : 'No rule fits' }).name;
function card(e) {
  const s = state.session, p = placeOf(e.ref);
  const el = h('article', 'rcard pl-' + p.place + (state.sel === e.ref ? ' sel' : '')); el.dataset.ref = e.ref; el.tabIndex = -1;
  const top = h('div', 'c-top');
  const obj = p.match || p.sug;
  const status = p.match ? KIND[p.match.kind] : p.sug ? 'Suggested' : 'Unmatched';
  top.append(h('span', 'st st-' + p.place, status), h('span', 'rid', obj ? obj.rule : p.un.rule), h('span', 'rname', ruleName(obj ? obj.rule : p.un.rule)));
  el.append(top, entryBlock(e));
  if (obj) {
    el.append(invoiceBlock(obj.invoices, s), h('div', 'cb-h', 'Evidence'), evidenceList(obj.evidence));
    el.append(h('p', 'effect', (p.sug ? 'If you accept: ' : 'Effect: ') + obj.effect));
    if (p.match && p.match.reason) el.append(h('p', 'why', 'Reason given: ' + p.match.reason));
  } else {
    el.append(h('p', 'msg', p.un.reason));
    if (p.un.candidates.length) el.append(invoiceBlock(p.un.candidates, s));
  }
  const act = h('div', 'c-act');
  if (p.sug) {
    const a = h('button', 'tb tb-main tb-small', 'Accept'); a.type = 'button'; a.addEventListener('click', () => doAccept(p.sug));
    const r = h('button', 'tb tb-small', 'Reject…'); r.type = 'button'; r.addEventListener('click', () => askReject(p.sug.id, `${p.sug.rule}: ${e.ref} with ${p.sug.invoices.join(', ')}`));
    act.append(a, r);
  } else if (p.match && p.match.kind === 'auto') {
    const r = h('button', 'tb tb-small', 'Reject this automatic match…'); r.type = 'button'; r.addEventListener('click', () => askReject(p.match.id, `${p.match.rule}: ${e.ref} with ${p.match.invoices.join(', ')}`)); act.append(r);
  } else if (p.un && e.cd === 'CRDT' && e.status === 'BOOK') {
    const m = h('button', 'tb tb-small', 'Match by hand…'); m.type = 'button'; m.addEventListener('click', () => openManual([e.ref], p.un.candidates.filter((n) => openOf(s, s.byNum.get(n)) > 0n))); act.append(m);
  }
  if (act.children.length) el.append(act);
  el.addEventListener('click', (ev) => { if (ev.target.closest('button')) return; if (state.sel !== e.ref) { state.sel = e.ref; renderEntries(); renderInvoices(); for (const c of $('cards').children) c.classList.toggle('sel', c.dataset.ref === e.ref); } });
  return el;
}
function renderCards() {
  const box = $('cards'); box.replaceChildren();
  const list = shown();
  if (!list.length) { box.append(h('p', 'empty-c', state.filter === 'review' ? 'Nothing waits for review. Every entry is matched or listed as unmatched with its reason.' : 'Nothing here.')); return; }
  for (const e of list) box.append(card(e));
}

// ---------- decisions ----------
function after(fn) { try { fn(); } catch (err) { $('banner').textContent = err.message; return; } if (state.sel && !shown().some((e) => e.ref === state.sel)) { const n = firstOf(state.filter); state.sel = n ? n.ref : null; } render(); }
function doAccept(p) { const i = shown().findIndex((e) => e.ref === p.entries[0]); after(() => accept(state.session, p.id)); const next = shown()[Math.max(0, i)]; if (next) { state.sel = next.ref; render(); } }
let rejId = null;
function askReject(id, what) { rejId = id; $('rejWhat').textContent = what; $('rejReason').value = ''; $('rejErr').textContent = ''; $('rejDlg').showModal(); $('rejReason').focus(); }
$('rejOk').addEventListener('click', (ev) => {
  const r = $('rejReason').value.trim();
  if (r.length < 3) { ev.preventDefault(); $('rejErr').textContent = 'A reason is needed (at least 3 characters).'; return; }
});
$('rejDlg').addEventListener('close', () => { if ($('rejDlg').returnValue === 'ok' && rejId) { const id = rejId; rejId = null; after(() => reject(state.session, id, $('rejReason').value)); } });
$('undoBtn').addEventListener('click', () => after(() => undo(state.session)));

// manual match
function openManual(refs = [], nums = []) { state.manual = { entries: new Set(refs), invoices: new Set(nums), treatment: null }; $('mpReason').value = ''; $('mpErr').textContent = ''; render(); $('manualPanel').scrollIntoView({ block: 'nearest' }); }
$('manualBtn').addEventListener('click', () => { if (state.manual) { state.manual = null; render(); } else openManual(state.sel && placeOf(state.sel).place !== 'auto' && placeOf(state.sel).place !== 'person' ? [state.sel] : []); });
$('mpCancel').addEventListener('click', () => { state.manual = null; render(); });
function renderManual() {
  const m = state.manual, panel = $('manualPanel'); panel.hidden = !m; $('manualBtn').textContent = m ? 'Close manual match' : 'Match by hand';
  if (!m) return;
  const s = state.session, pv = manualPreview(s, [...m.entries], [...m.invoices]);
  $('mpSel').replaceChildren(h('span', 'muted', 'Entries: '), document.createTextNode([...m.entries].join(', ') || 'none'), h('br'), h('span', 'muted', 'Invoices: '), document.createTextNode([...m.invoices].join(', ') || 'none'));
  $('mpBal').replaceChildren(...[['Paid', pv.paid], ['Due', pv.due], ['Difference', pv.diff]].map(([k, v]) => { const d = h('div', 'mp-n'); d.append(h('span', 'f-l', k), h('span', 'f-v mono', amt(v) + ' ' + pv.ccy)); return d; }));
  const tr = $('mpTreat'); tr.replaceChildren();
  if (!pv.options.includes(m.treatment)) m.treatment = pv.options[0] || null;
  for (const o of pv.options) {
    const id = 'mpt-' + o, l = h('label', 'mp-opt'), i = h('input'); i.type = 'radio'; i.name = 'mpt'; i.id = id; i.value = o; i.checked = m.treatment === o;
    i.addEventListener('change', () => { m.treatment = o; });
    l.append(i, document.createTextNode(' ' + ({ closed: 'Close the invoices', partial: 'Partial payment: invoices stay open with what is left', 'small-diff': 'Close and book the difference as a small difference', credit: 'Close and show the excess as customer credit' })[o]));
    tr.append(l);
  }
  $('mpErr').textContent = pv.problems.join(' ');
  $('mpOk').disabled = !!pv.problems.length;
}
$('mpOk').addEventListener('click', () => {
  const m = state.manual; if (!m) return;
  const reason = $('mpReason').value;
  if (reason.trim().length < 3) { $('mpErr').textContent = 'A reason is needed (at least 3 characters).'; $('mpReason').focus(); return; }
  try { manual(state.session, [...m.entries], [...m.invoices], m.treatment, reason); } catch (err) { $('mpErr').textContent = err.message; return; }
  const ref = [...m.entries][0]; state.manual = null; state.filter = 'person'; state.sel = ref; render();
});

// keyboard: J/K or arrows move, A accepts, R rejects
$('cards').addEventListener('keydown', (ev) => {
  if (!state.session || state.manual || ev.target.closest('input,textarea,select')) return;
  const list = shown(), i = list.findIndex((e) => e.ref === state.sel);
  const k = ev.key.toLowerCase();
  if (k === 'j' || ev.key === 'ArrowDown') { ev.preventDefault(); const n = list[Math.min(list.length - 1, i + 1)]; if (n) { state.sel = n.ref; render(); $('cards').querySelector(`[data-ref="${n.ref}"]`).scrollIntoView({ block: 'nearest' }); $('cards').focus(); } }
  else if (k === 'k' || ev.key === 'ArrowUp') { ev.preventDefault(); const n = list[Math.max(0, i - 1)]; if (n) { state.sel = n.ref; render(); $('cards').querySelector(`[data-ref="${n.ref}"]`).scrollIntoView({ block: 'nearest' }); $('cards').focus(); } }
  else if (k === 'a' && state.sel) { const p = placeOf(state.sel); if (p.sug) { doAccept(p.sug); $('cards').focus(); } }
  else if (k === 'r' && state.sel) { const p = placeOf(state.sel); if (p.sug) askReject(p.sug.id, `${p.sug.rule}: ${state.sel}`); else if (p.match && p.match.kind === 'auto') askReject(p.match.id, `${p.match.rule}: ${state.sel}`); }
});
for (const b of document.querySelectorAll('.flt')) b.addEventListener('click', () => { state.filter = b.dataset.filter; const f = firstOf(state.filter); state.sel = f ? f.ref : null; render(); });

// ---------- trail, totals ----------
function renderTrail() {
  const s = state.session, tb = $('trailTable').querySelector('tbody'); tb.replaceChildren();
  $('trailMeta').textContent = s ? `${s.trail.length} lines · final fingerprint ${s.trail[s.trail.length - 1].fingerprint.slice(0, 16)}…` : '';
  if (!s) return;
  for (const l of s.trail.slice().reverse()) {
    const tr = h('tr');
    for (const v of [l.seq, l.time.replace('T', ' ').slice(0, 19), l.actor, l.action, l.entries, l.invoices, l.rule, l.paid, l.difference, l.reason || l.detail]) tr.append(h('td', 'small', v));
    const fp = h('td', 'mono small'); fp.textContent = l.fingerprint.slice(0, 12) + '…'; fp.title = l.fingerprint; tr.append(fp);
    tb.append(tr);
  }
}
function renderTotals() {
  const ul = $('totals'); ul.replaceChildren(); const s = state.session; if (!s) return;
  for (const c of s.view.totals.checks) { const li = h('li', c.ok ? 'ok' : 'bad'); li.append(h('b', null, c.ok ? '✓ ' : '✗ '), document.createTextNode(c.text)); ul.append(li); }
}
$('verifyIn').addEventListener('change', async (e) => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  const out = $('verifyOut');
  if (f.size > MAX_BYTES) { out.className = 'verify bad'; out.textContent = 'The file is over 10 MB, too big for a trail.'; return; }
  let lines;
  try { lines = parseTrail(new TextDecoder('utf-8', { fatal: true }).decode(await f.arrayBuffer())); } catch (err) { out.className = 'verify bad'; out.textContent = `${f.name}: ${err.message || 'not a UTF-8 text file.'}`; return; }
  const r = verifyTrail(lines);
  const cur = state.session && state.session.trail[state.session.trail.length - 1].fingerprint;
  out.className = 'verify ' + (r.ok ? 'ok' : 'bad');
  out.textContent = r.ok ? `${f.name}: the chain is intact, ${r.count} lines. Final fingerprint ${r.last}. Compare it with the one printed in your report${cur === r.last ? ' (it is the same as this session\'s trail)' : ''}.` : `${f.name}: ${r.problem.message}`;
});

// ---------- inputs ----------
const sel = $('sampleSel');
for (const smp of REC_SAMPLES) { const o = h('option', null, smp.label); o.value = smp.id; sel.append(o); }
const own = h('option', null, 'Your files'); own.value = ''; own.disabled = true; sel.append(own);
function loadSample(id) { const smp = REC_SAMPLES.find((x) => x.id === id); state.sample = true; state.stmtSrc = smp.statement(); state.stmtName = `sample-${smp.id}.xml`; state.invSrc = smp.invoices(); state.invName = 'sample-invoices.csv'; sel.value = id; run(); }
sel.addEventListener('change', () => loadSample(sel.value));
async function readText(f, limit) {
  if (f.size > limit) return '\u0000';
  try { return new TextDecoder('utf-8', { fatal: true }).decode(await f.arrayBuffer()); } catch (e) { return '\u0000'; }
}
$('stmtIn').addEventListener('change', async (e) => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  if (f.size > MAX_BYTES) { state.statement = { status: 'refused', reason: sizeWords(f.size, MAX_BYTES, 'The statement'), findings: [], reconcilable: false }; state.session = null; state.sample = false; state.go = true; sel.value = ''; render(); return; }
  state.stmtSrc = await readText(f, MAX_BYTES); state.stmtName = f.name; state.sample = false; state.go = true; state.box = 'check'; sel.value = ''; run();
});
$('invIn').addEventListener('change', async (e) => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  state.invSrc = f.size > MAX_INVOICE_BYTES ? 'x'.repeat(MAX_INVOICE_BYTES + 1) : await readText(f, MAX_INVOICE_BYTES); state.invName = f.name; state.sample = false; state.go = true; state.box = 'check'; sel.value = '';
  state.inv = readInvoices(state.invSrc);
  if (state.inv.needsMapping && state.inv.headers.length) { clearRun(); render(); askMapping(); return; }
  start();
});
function askMapping() {
  const inv = state.inv, box = $('mapFields'); box.replaceChildren();
  $('mapWhy').textContent = inv.error;
  for (const f of INVOICE_FIELDS) {
    const l = h('label', 'fld'), s = h('select'); s.dataset.key = f.key;
    const none = h('option', null, f.required ? 'Choose a column' : '(none)'); none.value = ''; s.append(none);
    inv.headers.forEach((hd, i) => { const o = h('option', null, hd || `column ${i + 1}`); o.value = String(i); if (inv.mapping && inv.mapping[f.key] === i) o.selected = true; s.append(o); });
    l.append(document.createTextNode(f.label + (f.required ? '' : ' (optional)')), s); box.append(l);
  }
  const l = h('label', 'fld'), d = h('select'); d.dataset.key = '_decimal';
  for (const [v, t] of [['', 'Detect'], ['.', 'Point: 1,200.50'], [',', 'Comma: 1.200,50']]) { const o = h('option', null, t); o.value = v; d.append(o); }
  l.append(document.createTextNode('Decimal mark'), d); box.append(l);
  $('mapDlg').showModal();
}
$('mapDlg').addEventListener('close', () => {
  if ($('mapDlg').returnValue !== 'ok') { state.inv = mappingCancelled(state.inv); start(); return; }
  const mapping = {}; let decimal = null;
  for (const s of $('mapFields').querySelectorAll('select')) { if (s.dataset.key === '_decimal') decimal = s.value || null; else if (s.value !== '') mapping[s.dataset.key] = Number(s.value); }
  state.inv = readInvoices(state.invSrc, { mapping, decimal });
  if (state.inv.needsMapping) { askMapping(); return; }
  start();
});

// ---------- downloads ----------
function save(name, type, content) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([content], { type })); a.download = name;
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
$('exportBtn').addEventListener('click', () => { const m = $('exportMenu'); m.hidden = !m.hidden; $('exportBtn').setAttribute('aria-expanded', String(!m.hidden)); });
document.addEventListener('click', (e) => { if (!e.target.closest('.export')) { $('exportMenu').hidden = true; $('exportBtn').setAttribute('aria-expanded', 'false'); } });
$('exportMenu').addEventListener('click', (e) => {
  const b = e.target.closest('[data-export]'); if (!b || !state.session) return;
  const ctx = { session: state.session, statement: state.statement, when: new Date().toISOString() };
  const base = 'reconciliation-' + String(state.session.stmt.id || 'statement').replace(/[^A-Za-z0-9-]/g, '');
  const k = b.dataset.export;
  if (k === 'html') save(base + '-report.html', 'text/html', recHtml(ctx));
  if (k === 'trail-csv') save(base + '-audit-trail.csv', 'text/csv', trailCsv(ctx));
  if (k === 'trail-jsonl') save(base + '-audit-trail.jsonl', 'application/x-ndjson', trailJsonl(ctx));
  if (k === 'open-csv') save(base + '-open-invoices.csv', 'text/csv', openInvoicesCsv(ctx));
  if (k === 'junit') save(base + '-junit.xml', 'application/xml', recJUnit(ctx));
  $('exportMenu').hidden = true;
});

// ---------- rule catalogue ----------
$('catVersion').textContent = `version ${REC_CATALOGUE_VERSION} · ${REC_RULES.length} matching rules · ${STM_RULES.length} statement checks · tool ${REC_TOOL.version}`;
const ctb = $('catTable').querySelector('tbody');
for (const r of [...STM_RULES.map((x) => ({ ...x, gives: 'Statement check' })), ...REC_RULES]) {
  const tr = document.createElement('tr');
  tr.append(h('td', 'mono', r.id), h('td', 'small', r.name + (r.auto ? ' (automatic)' : '')), h('td', 'small', r.gives), h('td', 'small', r.what));
  ctb.append(tr);
}
void TREATMENT;

// ---------- the simple view (Olivia, 17 Nov): one button, three boxes, one question at a time ----------
const list = (a) => (a.length > 1 ? a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1] : a[0] || '');
const entryOf = (ref) => state.session.entries.find((e) => e.ref === ref);
function payerOf(p) { const e = entryOf(p.entries[0]); return (e && e.payer) || (p.invoices[0] && state.session.byNum.get(p.invoices[0]) ? state.session.byNum.get(p.invoices[0]).customer : 'Someone'); }
function sentence(p, done) {
  const paid = `${amt(p.paid)} ${p.ccy}`, inv = (p.invoices.length > 1 ? 'invoices ' : 'invoice ') + list(p.invoices), d = `${amt(p.diff < 0n ? -p.diff : p.diff)} ${p.ccy}`;
  const what = p.treatment === 'partial' ? `pays part of ${inv}, and ${d} stays open` : p.treatment === 'credit' ? `covers ${inv}, with ${d} paid too much` : p.treatment === 'small-diff' ? `covers ${inv}, with a small difference of ${d}` : `covers ${inv}`;
  return `${payerOf(p)} paid ${paid}${p.entries.length > 1 ? ` in ${p.entries.length} payments` : ''}. That ${done ? what.replace(/^covers/, 'covered').replace(/^pays/, 'paid') : what}.`;
}
function why(p) { const d = h('details', 'pm-why'); d.append(h('summary', null, 'Why?'), evidenceList(p.evidence)); if (p.effect) d.append(h('p', 'muted small', (p.kind ? '' : 'If you say yes: ') + p.effect)); return d; }
function plainProblem() {
  const st = state.statement;
  if (state.busy || !st) return 'Reading the files…';
  if (!st.reconcilable) return 'The bank statement could not be used, so nothing was matched. ' + (st.reason || (st.status === 'not-wellformed' ? 'It is not a readable XML file.' : st.status === 'schema-errors' ? 'It does not follow the camt.053.001.08 format.' : 'Its balances or totals do not add up.')) + ' Open Advanced below for the details.';
  if (state.inv && !state.inv.ok) return 'The invoice list could not be used, so nothing was matched. ' + state.inv.error;
  return 'Nothing was matched.';
}
function renderSimple() {
  const s = state.session, st = state.statement;
  $('pmGo').disabled = !s || state.busy;
  if (s && state.sample) $('pmReady').textContent = `A made-up bank statement with ${st.stmt.totals.nCr + st.stmt.totals.nDb} payments and a list of ${state.inv.invoices.length} open invoices are ready.`;
  else if (!state.sample) $('pmReady').textContent = `Your files: ${state.stmtName || 'no statement yet'} and ${state.invName && !state.invName.startsWith('sample') ? state.invName : 'the sample invoices'}.`;
  $('pmMsg').hidden = !(state.go && !s && !state.busy); $('pmMsg').textContent = plainProblem();
  $('pmResult').hidden = !(state.go && s);
  if (!state.go || !s) return;
  const c = s.view.counts;
  $('pmPaidN').textContent = c.auto + c.person; $('pmCheckN').textContent = c.review; $('pmLostN').textContent = c.unmatched;
  for (const b of document.querySelectorAll('.pm-box')) { b.classList.toggle('on', b.dataset.box === state.box); b.setAttribute('aria-pressed', String(b.dataset.box === state.box)); }
  const v = $('pmView'); v.replaceChildren();
  if (state.box === 'check') v.append(...checkView(s));
  else if (state.box === 'paid') v.append(...paidView(s));
  else v.append(...lostView(s));
}
function checkView(s) {
  const out = [], sug = s.view.suggestions[0];
  if (!sug) {
    const done = h('div', 'pm-done'); done.append(h('p', 'pm-done-t', 'All checked.'));
    const dl = h('button', 'pm-go pm-dl', 'Download the report'); dl.type = 'button'; dl.addEventListener('click', downloadReport); done.append(dl);
    out.push(done);
  } else {
    const card = h('article', 'pm-card');
    card.append(h('p', 'pm-left muted small', `${s.view.suggestions.length} left to check`), h('p', 'pm-say', sentence(sug)));
    if (state.no === sug.id) card.append(noForm(sug));
    else {
      const act = h('div', 'pm-act');
      const y = h('button', 'pm-yes', "Yes, that's right"); y.type = 'button'; y.addEventListener('click', () => { try { accept(s, sug.id); } catch (err) { $('pmMsg').hidden = false; $('pmMsg').textContent = err.message; return; } render(); });
      const n = h('button', 'pm-no', 'No'); n.type = 'button'; n.addEventListener('click', () => { state.no = sug.id; render(); const f = $('pmView').querySelector('input[name="pmr"]'); if (f) f.focus(); });
      act.append(y, n); card.append(act);
    }
    card.append(why(sug));
    out.push(card);
  }
  if (s.undo.length) { const u = h('button', 'linkish small', 'Undo my last answer'); u.type = 'button'; u.addEventListener('click', () => { undo(s); state.no = null; render(); }); const up = h('p', 'pm-undo'); up.append(u); out.push(up); }
  return out;
}
const NO_REASONS = ['Wrong customer', 'Wrong invoice', 'Not a payment for an invoice'];
function noForm(sug) {
  const f = h('form', 'pm-noform'); f.append(h('p', 'pm-q', 'What is wrong?'));
  NO_REASONS.forEach((r, i) => { const l = h('label', 'pm-opt'), inp = h('input'); inp.type = 'radio'; inp.name = 'pmr'; inp.value = r; inp.checked = i === 0; l.append(inp, document.createTextNode(' ' + r)); f.append(l); });
  const t = h('input'); t.type = 'text'; t.maxLength = 300; t.placeholder = 'Anything to add? (optional)'; t.setAttribute('aria-label', 'Anything to add (optional)'); t.className = 'pm-text';
  const ok = h('button', 'pm-yes', 'Save'), cancel = h('button', 'pm-no', 'Cancel'); ok.type = 'submit'; cancel.type = 'button';
  cancel.addEventListener('click', () => { state.no = null; render(); });
  const act = h('div', 'pm-act'); act.append(ok, cancel); f.append(t, act);
  f.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const pick = f.querySelector('input[name="pmr"]:checked').value, extra = t.value.trim();
    try { reject(state.session, sug.id, extra ? `${pick}: ${extra}` : pick); } catch (err) { $('pmMsg').hidden = false; $('pmMsg').textContent = err.message; return; }
    state.no = null; render();
  });
  return f;
}
function paidView(s) {
  const ul = h('ul', 'pm-list');
  for (const m of s.matches) {
    const li = h('li'); li.append(h('span', 'pm-line', sentence(m, true)));
    li.append(h('span', 'pm-reason muted small', m.kind === 'auto' ? `Matched by the rule "${ruleName(m.rule)}".` : m.reason ? `You matched it: ${m.reason}` : 'You said yes.'));
    ul.append(li);
  }
  if (!ul.children.length) return [h('p', 'muted', 'Nothing is matched yet.')];
  return [ul];
}
function lostView(s) {
  const ul = h('ul', 'pm-list');
  for (const e of s.entries) {
    const p = placeOf(e.ref); if (p.place !== 'unmatched') continue;
    const li = h('li'); li.append(h('span', 'pm-line', `${e.cd === 'DBIT' ? 'Paid out' : (e.payer || 'Someone') + ' paid'} ${amt(e.amt)} ${e.ccy}${e.cd === 'DBIT' && e.payer ? ' to ' + e.payer : ''}.`));
    li.append(h('span', 'pm-reason muted small', p.un.reason.replace(/^You rejected the suggestion [^:]*: /, 'You said no: ')));
    ul.append(li);
  }
  if (!ul.children.length) return [h('p', 'muted', 'Every payment found its invoice.')];
  return [ul, h('p', 'muted small', 'To match one of these by hand, open Advanced below.')];
}
function downloadReport() { const ctx = { session: state.session, statement: state.statement, when: new Date().toISOString() }; save('reconciliation-' + String(state.session.stmt.id || 'statement').replace(/[^A-Za-z0-9-]/g, '') + '-report.html', 'text/html', recHtml(ctx)); }
$('pmGo').addEventListener('click', () => { state.go = true; state.box = state.session && state.session.view.counts.review ? 'check' : 'paid'; render(); $('pmResult').scrollIntoView({ block: 'nearest' }); });
$('pmOwnBtn').addEventListener('click', () => { const o = $('pmOwn'); o.hidden = !o.hidden; $('pmOwnBtn').setAttribute('aria-expanded', String(!o.hidden)); });
for (const b of document.querySelectorAll('.pm-box')) b.addEventListener('click', () => { state.box = b.dataset.box; state.no = null; render(); });

// ---------- start: the made-up day, already reconciled ----------
loadSample('day');

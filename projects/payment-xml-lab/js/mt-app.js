// MT to MX Migration Lab: the page. Everything happens in this tab; nothing is uploaded or stored.
import { convert, MAP_RULES, MAP_SOURCES, MAP_TOOL, MAP_CATALOGUE_VERSION, MX, STATUS } from './mt-map.js';
import { MT_SAMPLES, NATIVE_PACS008 } from './mt-samples.js';
import { reverseCheck } from './mt-reverse.js';
import { validate, loadSchema } from './schema.js';
import { explain } from './messages.js';
import { MAX_CHARS } from './mt103.js';
import { mapHtml, mapCsv, mapJson, mapJUnit } from './mt-reports.js';

const $ = (id) => document.getElementById(id);
const h = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const XSD_URL = new URL('../schemas/' + MX.xsd, import.meta.url).href;
const xsdReady = loadSchema(XSD_URL);
const state = { src: '', name: '', res: null, schema: null, filter: 'all', selMt: new Set(), selMx: new Set(), sha: '', reverseNative: false, run: 0 };

async function sha256(text) {
  try { const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)); return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join(''); } catch (e) { return ''; }
}

// ---------- convert ----------
async function run(src, name) {
  const my = ++state.run;
  state.src = String(src).replace(/\r\n?/g, '\n'); state.name = name || 'pasted MT103';
  state.res = convert(state.src); state.schema = { busy: true }; state.selMt.clear(); state.selMx.clear();
  state.sha = await sha256(state.src);
  if (state.res.refused) { state.schema = { failed: 'nothing to check' }; render(); return; }
  render();
  try {
    const xsd = await xsdReady;
    const v = await validate(state.res.xml, xsd, MX.xsd);
    if (my !== state.run) return;
    state.schema = { valid: v.valid, errors: v.errors.map((e) => ({ ...e, ...explain(e.message) })), timeMs: v.timeMs };
  } catch (e) { if (my !== state.run) return; state.schema = { failed: String(e.message || e) }; }
  render();
}

// ---------- render ----------
function fact(label, value, mono) { const d = h('div', 'fact'); d.append(h('span', 'f-l', label), h('span', 'f-v' + (mono ? ' mono' : ''), value || '—')); return d; }
function render() {
  const r = state.res; if (!r) return;
  $('facts').replaceChildren(fact('UETR', r.facts.uetr || 'missing', true), fact('Reference', r.facts.ref, true), fact('Value date', r.facts.valueDate, true), fact('Amount', r.facts.amount, true));
  const v = $('verdict'); v.className = 'verdict ' + (r.verdict === 'Clean' ? 'v-ok' : r.verdict === 'Needs review' && r.errors.length ? 'v-bad' : 'v-warn');
  const sc = state.schema;
  const schemaLine = sc.busy ? 'Schema: checking…' : sc.failed ? 'Schema: not checked (' + sc.failed + ')' : sc.valid ? `Schema: valid (pacs.008.001.08, ${sc.timeMs} ms)` : `Schema: ${sc.errors.length} error${sc.errors.length > 1 ? 's' : ''}`;
  v.replaceChildren(h('span', 'v-chip', r.verdict), h('span', 'v-line', schemaLine));
  const nRev = r.counts.review, nErr = r.errors.length;
  $('banner').textContent = `Made-up MT103 (${state.name}): converted` + (nErr ? `, ${nErr} error${nErr > 1 ? 's' : ''}` : '') + (nRev ? `, ${nRev} point${nRev > 1 ? 's' : ''} need${nRev > 1 ? '' : 's'} review` : '') + (r.counts.lost ? `, ${r.counts.lost} cut or lost` : '') + '.';
  $('cAll').textContent = r.rows.length;
  for (const k of Object.keys(STATUS)) $('c-' + k).textContent = r.counts[k];
  $('mtMeta').textContent = `${r.mt.lineCount} lines · ${r.mt.fields.length} fields`;
  $('mtName').textContent = state.name;
  $('xsdMeta').textContent = sc.busy ? 'checking…' : sc.valid ? 'schema valid' : sc.failed ? 'not checked' : 'schema errors';
  $('dlXml').disabled = !!r.refused; $('exportBtn').disabled = !!r.refused;
  renderCode(); renderFindings(); renderTable(); renderReverse();
}

const errLinesMt = () => new Set(state.res.errors.map((e) => e.mtLine).filter(Boolean));
const errLinesMx = () => new Set((state.schema.errors || []).map((e) => e.line).filter(Boolean));
function codeLines(el, lines, opts) {
  const frag = document.createDocumentFragment();
  lines.forEach((l, i) => {
    const n = i + 1, row = h('div', 'row');
    if (opts.err.has(n)) row.classList.add('m-error');
    if (opts.sel.has(n)) row.classList.add('sel');
    if (opts.linked.has(n)) row.classList.add('linked');
    const g = h('span', 'gut'); g.append(h('span', 'ln', String(n)));
    const t = h('span', 'txt'); opts.paint(l, t);
    row.dataset.line = n; row.append(g, t); frag.append(row);
  });
  el.replaceChildren(frag);
}
function paintMt(l, into) {
  const m = /^(:\d{2}[A-Z]?:)(.*)$/.exec(l);
  if (m) { into.append(h('span', 't-tag', m[1]), document.createTextNode(m[2])); return; }
  const b = /^(\{[1-5]:)(.*)$/.exec(l);
  if (b) { into.append(h('span', 't-blk', b[1]), document.createTextNode(b[2])); return; }
  into.append(document.createTextNode(l));
}
function paintXml(line, into) {
  const re = /(<\/?)([\w:.-]+)([^>]*?)(\/?>)|([^<]+)|(<)/g; let m;
  while ((m = re.exec(line))) {
    if (m[2]) { into.append(h('span', 't-pun', m[1]), h('span', 't-tag', m[2])); if (m[3]) into.append(h('span', 't-att', m[3])); into.append(h('span', 't-pun', m[4])); }
    else into.append(document.createTextNode(m[5] || m[6]));
  }
}
function linkedFromMt(lines) { const out = new Set(); for (const r of state.res.rows) if (r.xmlLine && r.mtLines.some((l) => lines.has(l))) for (let i = r.xmlLine; i <= r.xmlEnd; i++) out.add(i); return out; }
function linkedFromMx(lines) { const out = new Set(); for (const r of state.res.rows) if (r.xmlLine && [...lines].some((l) => l >= r.xmlLine && l <= r.xmlEnd)) r.mtLines.forEach((l) => out.add(l)); return out; }
function renderCode() {
  const r = state.res;
  const mtLinked = state.selMx.size ? linkedFromMx(state.selMx) : new Set();
  const mxLinked = state.selMt.size ? linkedFromMt(state.selMt) : new Set();
  codeLines($('mtCode'), state.src.split('\n'), { err: errLinesMt(), sel: state.selMt, linked: mtLinked, paint: paintMt });
  codeLines($('mxCode'), r.xml.replace(/\n$/, '').split('\n'), { err: errLinesMx(), sel: state.selMx, linked: mxLinked, paint: paintXml });
}
function scrollInto(el, n) { const row = el.querySelector(`[data-line="${n}"]`); if (row) { const top = row.offsetTop - el.clientHeight / 3; if (row.offsetTop < el.scrollTop || row.offsetTop > el.scrollTop + el.clientHeight - 30) el.scrollTop = Math.max(0, top); } }
function selectMt(lines) {
  state.selMt = new Set(lines); state.selMx.clear(); renderCode(); renderTable();
  const first = Math.min(...linkedFromMt(state.selMt)); if (Number.isFinite(first)) scrollInto($('mxCode'), first);
}
function selectMx(lines) {
  state.selMx = new Set(lines); state.selMt.clear(); renderCode(); renderTable();
  const first = Math.min(...linkedFromMx(state.selMx)); if (Number.isFinite(first)) scrollInto($('mtCode'), first);
}
function fieldLinesAt(n) { const f = state.res.mt.fields.find((x) => x.lineNos.includes(n)); return f ? f.lineNos : [n]; }
$('mtCode').addEventListener('click', (e) => { const row = e.target.closest('.row'); if (row && state.res) selectMt(fieldLinesAt(Number(row.dataset.line))); });
$('mxCode').addEventListener('click', (e) => { const row = e.target.closest('.row'); if (row && state.res) selectMx([Number(row.dataset.line)]); });

const SEVW = { error: 'Error', review: 'Review', info: 'Information' };
function renderFindings() {
  const list = $('findings'); list.replaceChildren();
  const r = state.res; const sc = state.schema;
  const items = r.findings.slice();
  if (sc.errors) for (const e of sc.errors) items.splice(items.findIndex((f) => f.severity !== 'error') < 0 ? items.length : items.findIndex((f) => f.severity !== 'error'), 0, { severity: 'error', rule: 'XSD', mtLine: null, xmlLine: e.line, message: e.message ? `Schema: ${e.message}` : e.raw, fix: e.fix || null, why: 'The generated pacs.008 does not follow the ISO 20022 schema.' });
  $('findMeta').textContent = `${items.length}`;
  if (!items.length) { const li = h('li', 'empty'); li.append(h('b', null, 'Nothing to review.'), h('span', null, ' Every field maps, and the pacs.008 follows the schema.')); list.append(li); return; }
  for (const f of items) {
    const li = h('li', 'card mt-card sev-' + (f.severity === 'error' ? 'error' : f.severity === 'review' ? 'warning' : 'info')); li.tabIndex = 0;
    const top = h('div', 'c-top');
    top.append(h('span', 'sev', SEVW[f.severity]), h('span', 'rid', f.rule));
    if (f.status) top.append(h('span', 'st st-' + f.status, STATUS[f.status]));
    top.append(h('span', 'where', [f.mtLine && 'MT line ' + f.mtLine, f.xmlLine && 'XML line ' + f.xmlLine].filter(Boolean).join(' · ') || 'No line'));
    li.append(top, h('p', 'msg', f.message));
    if (f.why) li.append(h('p', 'why', 'Why it matters: ' + f.why));
    if (f.fix) li.append(h('p', 'fix', 'What to do: ' + f.fix));
    const go = () => { if (f.mtLine) selectMt(fieldLinesAt(f.mtLine)); else if (f.xmlLine) selectMx([f.xmlLine]); if (f.mtLine) scrollInto($('mtCode'), f.mtLine); if (f.xmlLine) scrollInto($('mxCode'), f.xmlLine); };
    li.addEventListener('click', go); li.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    list.append(li);
  }
}
function renderTable() {
  const tb = $('mapTable').querySelector('tbody'); tb.replaceChildren();
  const r = state.res; let shown = 0;
  const hot = state.selMt.size ? (row) => row.mtLines.some((l) => state.selMt.has(l)) : state.selMx.size ? (row) => row.xmlLine && [...state.selMx].some((l) => l >= row.xmlLine && l <= row.xmlEnd) : () => false;
  for (const row of r.rows) {
    if (state.filter !== 'all' && row.status !== state.filter) continue;
    shown++;
    const tr = h('tr', hot(row) ? 'hot' : null);
    tr.append(h('td', 'mono', row.tag ? (row.tag.startsWith('{') ? 'Block ' + row.tag[1] : /^\d{3}$/.test(row.tag) ? 'Block 3, ' + row.tag : ':' + row.tag + ':') : '—'),
      h('td', 'mono small pre', row.mtValue), h('td', 'mono', row.rule), h('td', 'mono small', row.path), h('td', 'mono small pre', row.value),
      h('td', 'st-cell'), h('td', 'small', row.note));
    tr.children[5].append(h('span', 'st st-' + row.status, STATUS[row.status]));
    tr.addEventListener('click', () => { if (row.mtLines.length) selectMt(row.mtLines); else if (row.xmlLine) selectMx([row.xmlLine]); if (row.mtLines[0]) scrollInto($('mtCode'), row.mtLines[0]); });
    tb.append(tr);
  }
  $('rowMeta').textContent = `${shown} of ${r.rows.length} rows`;
}
function renderReverse() {
  const xml = state.reverseNative ? NATIVE_PACS008 : state.res.xml;
  const rv = xml ? reverseCheck(xml) : { rows: [] };
  $('rvSrc').textContent = state.reverseNative ? 'Showing: a made-up native pacs.008 (long name, accents, 180-character remittance). It was not made from an MT.' : 'Showing: the pacs.008 converted above.';
  $('nativeBtn').hidden = state.reverseNative; $('ownBtn').hidden = !state.reverseNative;
  const tb = $('rvTable').querySelector('tbody'); tb.replaceChildren();
  for (const x of rv.rows) {
    const tr = h('tr', x.cut ? 'cut' : null);
    tr.append(h('td', 'mono small', x.element), h('td', 'mono', x.mt), h('td', 'mono small pre', x.before), h('td', 'mono small pre', x.after), h('td', 'small', x.issue));
    tb.append(tr);
  }
}
$('nativeBtn').addEventListener('click', () => { state.reverseNative = true; renderReverse(); });
$('ownBtn').addEventListener('click', () => { state.reverseNative = false; renderReverse(); });
for (const b of document.querySelectorAll('.flt')) b.addEventListener('click', () => {
  state.filter = b.dataset.filter;
  for (const o of document.querySelectorAll('.flt')) o.classList.toggle('on', o === b);
  renderTable();
});

// ---------- inputs ----------
const sel = $('sampleSel');
for (const s of MT_SAMPLES) { const o = h('option', null, s.label); o.value = s.id; sel.append(o); }
sel.value = 'address';
sel.addEventListener('change', () => { const s = MT_SAMPLES.find((x) => x.id === sel.value); if (s) run(s.text, 'sample ' + s.label); });
$('pasteBtn').addEventListener('click', () => { $('pasteText').value = ''; $('pasteDlg').showModal(); });
$('pasteDlg').addEventListener('close', () => { if ($('pasteDlg').returnValue === 'ok' && $('pasteText').value.trim()) load($('pasteText').value, 'pasted MT103'); });
$('fileIn').addEventListener('change', async (e) => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  if (f.size > MAX_CHARS * 4) { load('x'.repeat(MAX_CHARS + 1), f.name); return; }
  let txt; try { txt = new TextDecoder('utf-8', { fatal: true }).decode(await f.arrayBuffer()); } catch (err) { load('\u0000', f.name); return; }
  load(txt, f.name);
});
function load(text, name) { sel.value = ''; run(text, name); }

// ---------- downloads ----------
function save(name, type, content) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([content], { type })); a.download = name;
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const base = () => 'pacs008-' + (state.res.facts.ref || 'message').replace(/[^A-Za-z0-9-]/g, '');
$('dlXml').addEventListener('click', () => save(base() + '.xml', 'application/xml', state.res.xml));
$('exportBtn').addEventListener('click', () => { const m = $('exportMenu'); m.hidden = !m.hidden; $('exportBtn').setAttribute('aria-expanded', String(!m.hidden)); });
document.addEventListener('click', (e) => { if (!e.target.closest('.export')) { $('exportMenu').hidden = true; $('exportBtn').setAttribute('aria-expanded', 'false'); } });
$('exportMenu').addEventListener('click', (e) => {
  const b = e.target.closest('[data-export]'); if (!b) return;
  const ctx = { res: state.res, schema: state.schema, sha: state.sha, name: state.name, when: new Date().toISOString() };
  const k = b.dataset.export;
  if (k === 'html') save(base() + '-report.html', 'text/html', mapHtml(ctx));
  if (k === 'csv') save(base() + '-mapping.csv', 'text/csv', mapCsv(ctx));
  if (k === 'json') save(base() + '-findings.json', 'application/json', mapJson(ctx));
  if (k === 'junit') save(base() + '-junit.xml', 'application/xml', mapJUnit(ctx));
  $('exportMenu').hidden = true;
});

// ---------- rule catalogue ----------
$('catVersion').textContent = `version ${MAP_CATALOGUE_VERSION} · ${MAP_RULES.length} rules · tool ${MAP_TOOL.version}`;
const ctb = $('catTable').querySelector('tbody');
for (const r of MAP_RULES) {
  const tr = document.createElement('tr');
  const src = h('td', 'small');
  r.source.forEach((s, i) => {
    if (i) src.append(document.createTextNode(' · '));
    const S = MAP_SOURCES[s];
    if (S.url) { const a = h('a', null, s.toUpperCase()); a.href = S.url; a.rel = 'noopener'; a.target = '_blank'; a.title = S.name; src.append(a); } else src.append(h('span', 'choice', S.name));
  });
  tr.append(h('td', 'mono', r.id), h('td', 'mono small', r.mt), h('td', 'mono small', r.target), h('td', 'small', r.statuses), h('td', 'small', r.what), src);
  ctb.append(tr);
}

// ---------- start: sample 2, already converted ----------
const first = MT_SAMPLES.find((s) => s.id === 'address');
run(first.text, 'sample ' + first.label);

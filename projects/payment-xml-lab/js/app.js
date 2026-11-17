// Payment XML Lab: the workbench. Everything happens in this tab; nothing is uploaded or stored.
import { RULES, SOURCES, CATALOGUE_VERSION } from './rules.js';
import { SCENARIOS, generate, sample } from './factory.js';
import { SUPPORTED, TOOL, MAX_BYTES, sizeWords } from './engine.js';
import { toHtml, toJson, toJUnit } from './reports.js';
import { scriptURL } from './tt.js';

const $ = (id) => document.getElementById(id);
const h = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const CHECK_LIMIT_MS = 20000;
const XSD_URL = new URL('../schemas/' + SUPPORTED.xsd, import.meta.url).href;

const state = { src: '', lines: [''], fileName: '', bytes: 0, report: null, filter: 'all', sel: -1, shown: [], lineMarks: new Map() };

// ---------- processing date ----------
function todayLocal() { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
$('procDate').value = todayLocal();
$('procDate').addEventListener('change', () => { if (state.src) runCheck(); });
const procDate = () => $('procDate').value || todayLocal();

// ---------- schema loaded with the page, worker per check ----------
const xsdReady = fetch(XSD_URL, { credentials: 'same-origin' }).then((r) => { if (!r.ok) throw new Error('The schema file could not be loaded.'); return r.text(); });

// One check worker for the page: its code is loaded once, with the page. A new one is made only after a time-out.
let worker = null, jobId = 0, pending = null;
function getWorker(xsdText) {
  if (worker) return worker;
  worker = new Worker(scriptURL(new URL('./check-worker.js', import.meta.url)), { type: 'module' });
  worker.addEventListener('message', (e) => {
    const d = e.data; if (!pending || d.id !== pending.id) return;
    if (d.type === 'stage') stage(d.stage === 'schema' ? 'schema' : d.stage === 'rules' ? 'rules' : null);
    else if (d.type === 'done') pending.done(null, d.report);
    else if (d.type === 'error') pending.done(new Error(d.message));
  });
  worker.addEventListener('error', (err) => { if (pending) pending.done(new Error('The checker could not start: ' + (err.message || 'unknown error'))); killWorker(); });
  worker.postMessage({ type: 'schema', text: xsdText });
  return worker;
}
function killWorker() { if (worker) worker.terminate(); worker = null; }
function checkInWorker(src, bytes) {
  if (pending) { pending.done(new Error('cancelled')); killWorker(); }
  return xsdReady.then((xsdText) => new Promise((resolve, reject) => {
    const id = ++jobId;
    const timer = setTimeout(() => { killWorker(); job.done(new Error(`The check took longer than ${CHECK_LIMIT_MS / 1000} seconds and was stopped.`)); }, CHECK_LIMIT_MS);
    const job = { id, done: (err, rep) => { clearTimeout(timer); if (pending === job) pending = null; err ? reject(err) : resolve(rep); } };
    pending = job;
    getWorker(xsdText).postMessage({ type: 'check', id, src, bytes, procDate: procDate(), xsdName: SUPPORTED.xsd });
  }));
}
// start the checker with the page, so no code is fetched during a check
xsdReady.then(getWorker).catch(() => {});

// ---------- stages ----------
function stage(name) {
  const order = ['read', 'schema', 'rules', 'report'];
  const i = order.indexOf(name);
  for (const li of $('stages').children) {
    const k = order.indexOf(li.dataset.stage);
    li.className = name === 'idle' ? '' : name === 'finished' || k < i ? 'done' : k === i ? 'now' : '';
  }
}

// ---------- loading a file ----------
async function sha256Hex(bytes) {
  const d = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function load(text, fileName, bytesArr) {
  const bytes = bytesArr || new TextEncoder().encode(text);
  state.src = text; state.fileName = fileName; state.bytes = bytes.byteLength;
  state.sha = await sha256Hex(bytes);
  state.lines = text.split(/\r?\n/);
  if (state.lines.length > 1 && state.lines[state.lines.length - 1] === '') state.lines.pop();
  $('fileName').textContent = fileName;
  $('fileMeta').textContent = `${state.lines.length.toLocaleString('en')} lines · ${fmtBytes(state.bytes)}`;
  $('dlXml').disabled = false;
  state.report = null; state.sel = -1; state.lineMarks = new Map();
  renderFindings(); setupCode();
  await runCheck();
}
const fmtBytes = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n > 1024 ? Math.round(n / 1024) + ' KB' : n + ' bytes');

async function loadFile(file) {
  if (file.size > MAX_BYTES) return showRefused(file.name, sizeWords(file.size));
  const buf = new Uint8Array(await file.arrayBuffer());
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (e) { return showRefused(file.name, 'This file is not valid UTF-8 text. Only UTF-8 files are checked here (SEPA files are UTF-8).'); }
  await load(text.replace(/^﻿/, ''), file.name, buf);
}
function showRefused(name, why) {
  state.src = ''; state.lines = ['']; state.report = null; state.fileName = name;
  $('fileName').textContent = name; $('fileMeta').textContent = '';
  setupCode(); renderFindings();
  setVerdict('Not checked', why, 'none'); $('facts').replaceChildren(fact('File', name));
}

async function runCheck() {
  stage('read');
  setVerdict('Checking…', '', 'busy');
  const started = performance.now();
  let r;
  try { r = await checkInWorker(state.src, state.bytes); } catch (e) {
    if (e.message === 'cancelled') return;
    stage('idle'); setVerdict('Not checked', e.message, 'none'); return;
  }
  stage('report');
  r.fileName = state.fileName; r.sha256 = state.sha; r.checkedAt = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  r.timings.totalMs = Math.round(performance.now() - started);
  state.report = r; state.sel = -1;
  state.lineMarks = new Map();
  for (const f of r.findings) if (f.line) { const cur = state.lineMarks.get(f.line); state.lineMarks.set(f.line, cur === 'error' || f.severity === 'error' ? 'error' : 'warning'); }
  renderStatus(); renderFindings(); renderCode();
  $('exportBtn').disabled = false;
  setTimeout(() => stage('finished'), 500);
}

// ---------- status ----------
function fact(label, value, mono) { const d = h('div', 'fact'); d.append(h('span', 'f-l', label), h('span', mono ? 'f-v mono' : 'f-v', value ?? '–')); return d; }
function setVerdict(word, line, kind) {
  const v = $('verdict'); v.className = 'verdict v-' + kind;
  v.replaceChildren(h('span', 'v-chip', word), h('span', 'v-line', line));
}
function renderStatus() {
  const r = state.report;
  const facts = [];
  const det = r.detected;
  facts.push(fact('Message', det && det.id ? det.id : r.status === 'not-iso' ? 'Not ISO 20022' : '–', true));
  if (r.summary) {
    facts.push(fact('MsgId', r.summary.msgId, true), fact('Created', r.summary.created, true), fact('Payments', r.summary.payments.toLocaleString('en') + (r.summary.batches > 1 ? ` in ${r.summary.batches} batches` : '')),
      fact('Control sum', r.summary.ctrlSum, true), fact('Sum of amounts', r.summary.total, true));
  }
  $('facts').replaceChildren(...facts);
  const kind = r.verdict === 'Accepted' ? 'ok' : r.verdict === 'Accepted with warnings' ? 'warn' : r.verdict === 'Rejected' ? 'bad' : 'none';
  const secs = r.timings.totalMs != null && r.verdict !== 'Not checked' ? ` · checked in ${(r.timings.totalMs / 1000).toFixed(r.timings.totalMs < 10000 ? 1 : 0)} s` : '';
  setVerdict(r.verdict, (r.verdict === 'Not checked' ? r.reason : r.verdictLine.replace(/^[^:]*:?\s*/, '') || 'No findings') + secs, kind);
  const c = r.counts;
  $('cAll').textContent = r.findings.length; $('cXsd').textContent = c.xsd + c.xml; $('cRule').textContent = c.ruleErrors; $('cWarn').textContent = c.warnings;
  const parts = [];
  if (r.status === 'not-wellformed') parts.push('Layers 2 and 3 were not run: the file must be well-formed XML first.');
  if (r.unreadable && r.unreadable.length) parts.push('Could not read: ' + r.unreadable.join(', ') + '.');
  if (state.isSample) parts.unshift('Made-up sample file: 1 payment batch, 3 payments, 5 findings on purpose. Fix them in your own copy, or make other test files with the Test File Maker.');
  $('hint').textContent = parts.length ? parts.join(' ') : 'Use J and K (or the arrow keys) to move between findings. Click a finding to see its line.';
}

// ---------- findings ----------
const LAYER = { xml: ['XML', 'l-xml'], xsd: ['Schema (XSD)', 'l-xsd'], rule: ['SEPA rule', 'l-rule'] };
function visible(f) {
  if (state.filter === 'all') return true;
  if (state.filter === 'xsd') return f.layer !== 'rule';
  if (state.filter === 'rule') return f.layer === 'rule' && f.severity === 'error';
  return f.severity === 'warning';
}
const MAX_SHOWN = 500;
function renderFindings() {
  const list = $('findings'); list.replaceChildren();
  const r = state.report;
  const all = r ? r.findings.map((f, i) => ({ f, i })).filter((x) => visible(x.f)) : [];
  // 50,000 cards froze the tab for about 10 s: show the first 500, the reports keep all (Daniel, PORT-40 10667)
  state.shown = all.slice(0, MAX_SHOWN);
  $('findMeta').textContent = r ? (all.length > MAX_SHOWN ? `first ${MAX_SHOWN} of ${all.length.toLocaleString('en')} shown` : `${all.length} shown`) : '';
  if (!r) return;
  if (!r.findings.length && r.status === 'checked') {
    const li = h('li', 'empty'); li.append(h('b', null, 'No findings.'), h('span', null, ` The file follows the ISO 20022 schema and all ${RULES.length} SEPA rules in the catalogue.`)); list.append(li); return;
  }
  if (r.status !== 'checked' && r.status !== 'not-wellformed') { list.append(h('li', 'empty', r.reason)); return; }
  for (const { f, i } of state.shown) {
    const li = h('li', 'card sev-' + f.severity); li.tabIndex = 0; li.dataset.i = i;
    const top = h('div', 'c-top');
    top.append(h('span', 'sev', f.severity === 'error' ? 'Error' : 'Warning'), h('span', 'layer ' + LAYER[f.layer][1], LAYER[f.layer][0]), h('span', 'rid', f.layer === 'xsd' ? (f.element || 'XSD') : f.id));
    top.append(h('span', 'where', f.line ? `Line ${f.line}${f.col ? ', col ' + f.col : ''}` : 'No line'));
    li.append(top);
    if (f.path) li.append(h('div', 'path', f.path));
    li.append(h('p', 'msg', f.message));
    if (f.expected || f.found) {
      const ef = h('dl', 'ef');
      if (f.expected) ef.append(h('dt', null, 'Expected'), h('dd', null, f.expected));
      if (f.found) ef.append(h('dt', null, 'Found'), h('dd', null, f.found));
      li.append(ef);
    }
    li.append(h('p', 'fix', 'How to fix: ' + f.fix));
    const src = h('p', 'src');
    if (f.layer === 'rule') {
      const s = SOURCES[f.source]; src.append(document.createTextNode('Source: '));
      if (s.url) { const a = h('a', null, s.name); a.href = s.url; a.rel = 'noopener'; a.target = '_blank'; src.append(a); } else src.append(document.createTextNode(s.name));
    } else src.textContent = f.layer === 'xsd' ? `Source: ISO 20022 ${state.report.xsd} schema (${f.ref})` : 'Source: XML 1.0 well-formedness';
    li.append(src);
    if (f.raw) { const d = h('details', 'raw'); d.append(h('summary', null, 'Technical detail'), h('code', null, f.raw)); li.append(d); }
    li.addEventListener('click', (e) => { if (e.target.closest('a, summary, details')) return; select(i, true); });
    li.addEventListener('keydown', (e) => { if (e.key === 'Enter') select(i, true); });
    list.append(li);
  }
  if (all.length > MAX_SHOWN) list.append(h('li', 'empty', `And ${(all.length - MAX_SHOWN).toLocaleString('en')} more. Fix these first, or download the report to see every finding.`));
}
function select(i, scrollCode, scrollList) {
  state.sel = i;
  for (const c of $('findings').children) c.classList.toggle('sel', Number(c.dataset.i) === i);
  const f = state.report.findings[i];
  if (f && f.line && scrollCode) scrollToLine(f.line);
  renderCode();
  if (scrollList) { const c = $('findings').querySelector(`[data-i="${i}"]`); if (c) c.scrollIntoView({ block: 'nearest' }); }
}
function step(d) {
  if (!state.shown.length) return;
  const pos = state.shown.findIndex((x) => x.i === state.sel);
  const next = state.shown[(pos + d + state.shown.length) % state.shown.length] || state.shown[0];
  select(next.i, true, true);
  const c = $('findings').querySelector(`[data-i="${next.i}"]`); if (c) c.focus({ preventScroll: true });
}
for (const b of document.querySelectorAll('.flt')) b.addEventListener('click', () => {
  state.filter = b.dataset.filter;
  for (const o of document.querySelectorAll('.flt')) o.classList.toggle('on', o === b);
  renderFindings();
});
document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea, select, dialog') || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === 'j' || e.key === 'ArrowDown') { if (e.key === 'ArrowDown' && !e.target.closest('.findings')) return; e.preventDefault(); step(1); }
  if (e.key === 'k' || e.key === 'ArrowUp') { if (e.key === 'ArrowUp' && !e.target.closest('.findings')) return; e.preventDefault(); step(-1); }
});

// ---------- code view (virtualised: only the visible lines exist in the page) ----------
const LH = 20;
const code = $('code'), space = $('codeSpace');
function setupCode() {
  space.style.height = state.lines.length * LH + 'px';
  let w = 0; for (let i = 0; i < Math.min(state.lines.length, 5000); i++) if (state.lines[i].length > w) w = state.lines[i].length;
  space.style.width = `calc(${w}ch + 80px)`;
  code.scrollTop = 0; renderCode();
}
function highlight(line, into) {
  const re = /(<!--.*?-->)|(<\/?)([\w:.-]+)([^>]*?)(\/?>)|([^<]+)|(<)/g; let m;
  while ((m = re.exec(line))) {
    if (m[1]) into.append(h('span', 't-com', m[1]));
    else if (m[3]) { into.append(h('span', 't-pun', m[2]), h('span', 't-tag', m[3])); if (m[4]) into.append(h('span', 't-att', m[4])); into.append(h('span', 't-pun', m[5])); }
    else into.append(document.createTextNode(m[6] || m[7]));
  }
}
function renderCode() {
  const top = code.scrollTop, hgt = code.clientHeight || 560;
  const first = Math.max(0, Math.floor(top / LH) - 10), last = Math.min(state.lines.length, Math.ceil((top + hgt) / LH) + 10);
  const selLine = state.sel >= 0 && state.report ? state.report.findings[state.sel].line : null;
  const frag = document.createDocumentFragment();
  for (let i = first; i < last; i++) {
    const n = i + 1, row = h('div', 'row'); row.style.top = i * LH + 'px';
    const mark = state.lineMarks.get(n);
    if (mark) row.classList.add('m-' + mark);
    if (n === selLine) row.classList.add('sel');
    const g = h('span', 'gut'); g.append(h('span', 'ln', String(n)));
    if (mark) { const b = h('button', 'mk mk-' + mark); b.type = 'button'; b.setAttribute('aria-label', `Show the finding on line ${n}`); b.dataset.line = n; g.append(b); }
    const t = h('span', 'txt'); highlight(state.lines[i].length > 4000 ? state.lines[i].slice(0, 4000) + ' …' : state.lines[i], t);
    row.append(g, t); frag.append(row);
  }
  space.replaceChildren(frag);
}
code.addEventListener('scroll', () => requestAnimationFrame(renderCode), { passive: true });
code.addEventListener('click', (e) => {
  const b = e.target.closest('.mk'); if (!b || !state.report) return;
  const n = Number(b.dataset.line);
  let idx = state.report.findings.findIndex((f) => f.line === n);
  if (idx >= 0 && !visible(state.report.findings[idx])) { state.filter = 'all'; for (const o of document.querySelectorAll('.flt')) o.classList.toggle('on', o.dataset.filter === 'all'); renderFindings(); }
  if (idx >= 0) select(idx, false, true);
});
function scrollToLine(n) {
  const y = (n - 1) * LH, hgt = code.clientHeight;
  if (y < code.scrollTop || y > code.scrollTop + hgt - LH * 2) code.scrollTop = Math.max(0, y - hgt / 2);
}
window.addEventListener('resize', () => renderCode());

// ---------- drag and drop ----------
const bench = $('bench'); let dragDepth = 0;
bench.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; $('drop').hidden = false; });
bench.addEventListener('dragover', (e) => e.preventDefault());
bench.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('drop').hidden = true; } });
bench.addEventListener('drop', (e) => { e.preventDefault(); dragDepth = 0; $('drop').hidden = true; const f = e.dataTransfer.files[0]; if (f) { state.isSample = false; loadFile(f); } });
$('fileIn').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) { state.isSample = false; loadFile(f); } e.target.value = ''; });

// ---------- paste ----------
$('pasteBtn').addEventListener('click', () => { $('pasteText').value = ''; $('pasteDlg').showModal(); });
$('pasteDlg').addEventListener('close', () => {
  if ($('pasteDlg').returnValue !== 'ok') return;
  const t = $('pasteText').value; if (!t.trim()) return;
  state.isSample = false; load(t, 'pasted.xml');
});

// ---------- sample and factory ----------
function loadSample() { state.isSample = true; load(sample(procDate()), 'sample-pain001.xml'); }
$('sampleBtn').addEventListener('click', loadSample);
// a file from the Test File Maker arrives as its recipe in the address; the same file is rebuilt here, nothing is stored
function fromRecipe() {
  const q = new URLSearchParams(location.search), id = q.get('scenario');
  if (!id || !SCENARIOS.some((x) => x.id === id)) return false;
  const count = Math.min(10000, Math.max(1, Number(q.get('count')) || 25));
  const date = /^\d{4}-\d{2}-\d{2}$/.test(q.get('date') || '') ? q.get('date') : undefined;
  const g = generate({ scenario: id, count, seed: Number(q.get('seed')) || 2026, execDate: id === 'date-past' || id === 'date-closed' ? undefined : date, procDate: procDate() });
  state.isSample = false; load(g.xml, g.fileName); return true;
}

// ---------- downloads (built in the browser) ----------
function download(name, type, content) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = h('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
$('dlXml').addEventListener('click', () => download(state.fileName || 'payment.xml', 'application/xml', state.src));
const menu = $('exportMenu');
$('exportBtn').addEventListener('click', () => { menu.hidden = !menu.hidden; $('exportBtn').setAttribute('aria-expanded', String(!menu.hidden)); });
document.addEventListener('click', (e) => { if (!e.target.closest('.export')) { menu.hidden = true; $('exportBtn').setAttribute('aria-expanded', 'false'); } });
menu.addEventListener('click', (e) => {
  const b = e.target.closest('[data-export]'); if (!b || !state.report) return;
  const base = (state.fileName || 'payment').replace(/\.xml$/i, '') + '-report';
  if (b.dataset.export === 'html') download(base + '.html', 'text/html', toHtml(state.report));
  if (b.dataset.export === 'json') download(base + '.json', 'application/json', toJson(state.report));
  if (b.dataset.export === 'junit') download(base + '-junit.xml', 'application/xml', toJUnit(state.report));
  menu.hidden = true;
});

// ---------- rule catalogue ----------
$('catVersion').textContent = `version ${CATALOGUE_VERSION} · ${RULES.length} rules · tool ${TOOL.version}`;
const tbody = $('catTable').querySelector('tbody');
for (const r of RULES) {
  const tr = document.createElement('tr');
  const s = SOURCES[r.source];
  const srcTd = h('td');
  if (s.url) { const a = h('a', null, s.name); a.href = s.url; a.rel = 'noopener'; a.target = '_blank'; srcTd.append(a); } else srcTd.textContent = s.name;
  const what = h('td', null, r.title); if (r.note) what.append(h('span', 'note', ' ' + r.note));
  const btn = h('button', 'tb tb-small', 'Try it'); btn.type = 'button';
  btn.addEventListener('click', () => { runFactory(r.scenario); window.scrollTo({ top: $('bench').offsetTop - 120, behavior: 'smooth' }); });
  const tdBtn = h('td'); tdBtn.append(btn);
  tr.append(h('td', 'mono', r.id), what, h('td', 'sev-' + r.severity, r.sevLabel || (r.severity === 'error' ? 'Error' : 'Warning')), h('td', 'mono small', r.good), h('td', 'mono small', r.bad), srcTd, tdBtn);
  tbody.append(tr);
}

// ---------- start: the sample, already checked ----------
setupCode();
if (!fromRecipe()) loadSample();

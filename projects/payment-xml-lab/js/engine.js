// The check pipeline: safety gate -> message detection -> L1 well-formed + L2 schema (libxml2) -> tree -> L3 rules.
// Pure: the schema validator is passed in, so the same code runs in the page and in the automatic tests.
import { parseTree, kid, path, text } from './tree.js';
import { runRules, CATALOGUE_VERSION, money, euro } from './rules.js';
import { explain } from './messages.js';

export const TOOL = { name: 'Payment XML Lab (ISO 20022)', version: '0.1.0' };
export const SUPPORTED = { ns: 'urn:iso:std:iso:20022:tech:xsd:pain.001.001.09', id: 'pain.001.001.09', xsd: 'pain.001.001.09.xsd' };
export const MAX_BYTES = 10 * 1024 * 1024;

export function safetyGate(src, bytes) {
  if (bytes > MAX_BYTES) return `This file is ${(bytes / 1048576).toFixed(1)} MB. The limit is 10 MB.`;
  if (!src.trim()) return 'The file is empty.';
  // XML 1.0 forbids these control characters. A NUL also means a UTF-16 file read as UTF-8, which could hide a DOCTYPE.
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(src)) return 'The file contains control characters that XML does not allow (often a sign it is UTF-16, not UTF-8). Only UTF-8 files are checked here.';
  const enc = (src.match(/^\uFEFF?<\?xml[^>]*encoding\s*=\s*["']([^"']+)["']/) || [])[1];
  if (enc && !/^utf-?8$/i.test(enc)) return `The file says it is encoded as ${enc}. Only UTF-8 files are checked here (SEPA files are UTF-8).`;
  const noComments = stripComments(src);
  if (/<!DOCTYPE/i.test(noComments)) return 'The file contains a DOCTYPE. Payment files never need one, and DOCTYPEs can be used to attack XML readers, so the file is refused.';
  if (/<!ENTITY/i.test(noComments)) return 'The file declares an ENTITY. Payment files never need one, so the file is refused.';
  return null;
}

// Comments removed with a linear scan (no backtracking). An unterminated comment keeps the rest of the file,
// so anything after it is still checked.
function stripComments(src) {
  let out = '', i = 0;
  for (;;) {
    const a = src.indexOf('<!--', i);
    if (a < 0) return out + src.slice(i);
    const b = src.indexOf('-->', a + 4);
    if (b < 0) return out + src.slice(i);
    out += src.slice(i, a); i = b + 3;
  }
}
function stripPIs(src) {
  let out = '', i = 0;
  for (;;) {
    const a = src.indexOf('<?', i); if (a < 0) return out + src.slice(i);
    const b = src.indexOf('?>', a + 2); if (b < 0) return out + src.slice(i);
    out += src.slice(i, a); i = b + 2;
  }
}

export function detect(src) {
  const m = stripPIs(stripComments(src)).match(/<([\w.-]+:)?([\w.-]+)\b([^>]*)>/);
  if (!m) return { kind: 'not-iso', label: 'No XML element found' };
  // the namespace of the root element: the default xmlns, or xmlns:prefix when the root has a prefix
  const prefix = m[1] ? m[1].slice(0, -1) : '';
  const nsRe = prefix ? new RegExp('\\sxmlns:' + prefix.replace(/[.-]/g, '\\$&') + '\\s*=\\s*["\']([^"\']+)["\']') : /\sxmlns\s*=\s*["']([^"']+)["']/;
  const ns = (m[3].match(nsRe) || [])[1] || '';
  if (ns === SUPPORTED.ns) return { kind: 'supported', id: SUPPORTED.id, ns };
  const iso = ns.match(/^urn:iso:std:iso:20022:tech:xsd:([a-z]{4}\.\d{3}\.\d{3}\.\d{2})$/);
  if (iso) return { kind: 'unsupported', id: iso[1], ns };
  return { kind: 'not-iso', label: ns ? 'namespace ' + ns : 'no namespace', ns };
}

const ORDER = { xml: 0, xsd: 1, rule: 2 };
function sortFindings(f) {
  return f.sort((a, b) => (a.line ?? 1e12) - (b.line ?? 1e12) || (a.col ?? 0) - (b.col ?? 0) || ORDER[a.layer] - ORDER[b.layer] || String(a.id).localeCompare(String(b.id)));
}

// validateSchema(xml) -> Promise<{ valid, errors: [{ line, raw, message }] }>
export async function check(src, { bytes = src.length, procDate, validateSchema, onStage = () => {} }) {
  const report = { tool: TOOL, xsd: SUPPORTED.id, catalogue: CATALOGUE_VERSION, procDate, status: 'checked', detected: null, layers: { xml: 'not run', xsd: 'not run', rules: 'not run' }, findings: [], unreadable: [], summary: null, timings: {} };
  const t0 = Date.now();
  const refused = safetyGate(src, bytes);
  if (refused) { report.status = 'refused'; report.reason = refused; return finish(report); }

  const det = detect(src); report.detected = det;
  if (det.kind === 'unsupported') { report.status = 'unsupported'; report.reason = `Recognised: ISO 20022 ${det.id}. Not supported yet: this first version checks pain.001.001.09.`; return finish(report); }
  if (det.kind === 'not-iso') { report.status = 'not-iso'; report.reason = `Not an ISO 20022 message (${det.label}).`; return finish(report); }

  onStage('schema');
  const res = await validateSchema(src);
  report.timings.schemaMs = Date.now() - t0;
  const parserErrors = res.errors.filter((e) => /parser error/.test(e.message));
  if (parserErrors.length) {
    const e = parserErrors[0]; const x = explain(e.message);
    report.layers.xml = 'failed';
    report.status = 'not-wellformed';
    report.findings.push({ layer: 'xml', id: 'XML', severity: 'error', title: 'Well-formed XML', line: x.openLine || e.line, col: null, path: '', element: x.element, message: x.message, expected: x.expected || null, found: x.found || null, fix: x.fix, ref: x.ref, raw: e.raw });
    return finish(report);
  }
  report.layers.xml = 'passed';

  onStage('tree');
  const tree = parseTree(src);
  const seen = new Set();
  for (const e of res.errors) {
    const key = e.line + '|' + e.message; if (seen.has(key)) continue; seen.add(key);
    const x = explain(e.message);
    const onLine = (e.line && tree.byLine.get(e.line)) || [];
    const el = onLine.find((c) => c.localName === x.element) || onLine[0] || null;
    report.findings.push({ layer: 'xsd', id: x.element ? 'XSD:' + x.element : 'XSD', severity: 'error', title: 'Official ISO 20022 schema', line: e.line, col: el ? el.col : null, path: el ? el.path : '', element: x.element, message: x.message, expected: x.expected || null, found: x.found || null, fix: x.fix, ref: x.ref, raw: e.raw });
  }
  report.layers.xsd = res.errors.length ? 'failed' : 'passed';

  onStage('rules');
  const t1 = Date.now();
  const rr = runRules(tree, procDate);
  report.timings.rulesMs = Date.now() - t1;
  report.findings.push(...rr.findings);
  report.unreadable = rr.unreadable;
  report.layers.rules = rr.findings.some((f) => f.severity === 'error') ? 'failed' : 'passed';

  const doc = tree.documentElement; const root = doc && kid(doc, 'CstmrCdtTrfInitn');
  report.summary = {
    msgId: text(path(root, 'GrpHdr', 'MsgId')), created: text(path(root, 'GrpHdr', 'CreDtTm')),
    payments: rr.stats.txs, batches: rr.stats.blocks, total: rr.stats.total != null ? euro(rr.stats.total) : null,
    ctrlSum: (() => { const v = money(text(path(root, 'GrpHdr', 'CtrlSum'))); return v != null ? euro(v) : null; })(),
  };
  return finish(report);
}

function finish(r) {
  sortFindings(r.findings);
  const c = { xsd: 0, ruleErrors: 0, warnings: 0, xml: 0 };
  for (const f of r.findings) {
    if (f.layer === 'xml') c.xml++;
    else if (f.layer === 'xsd') c.xsd++;
    else if (f.severity === 'error') c.ruleErrors++;
    else c.warnings++;
  }
  r.counts = c;
  if (r.status !== 'checked') r.verdict = r.status === 'not-wellformed' ? 'Rejected' : 'Not checked';
  else r.verdict = c.xsd + c.ruleErrors ? 'Rejected' : c.warnings ? 'Accepted with warnings' : 'Accepted';
  const parts = [];
  if (c.xml) parts.push('not well-formed XML');
  if (c.xsd) parts.push(`${c.xsd} schema error${c.xsd > 1 ? 's' : ''}`);
  if (c.ruleErrors) parts.push(`${c.ruleErrors} rule error${c.ruleErrors > 1 ? 's' : ''}`);
  if (c.warnings) parts.push(`${c.warnings} warning${c.warnings > 1 ? 's' : ''}`);
  r.verdictLine = r.verdict === 'Not checked' ? r.reason : r.verdict + (parts.length ? ': ' + parts.join(', ') : '');
  return r;
}

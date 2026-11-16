// Reports built in the browser: HTML (print or save as PDF), JSON, JUnit XML. No network.
import { RULES, SOURCES } from './rules.js';

const x = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const layerName = (f) => (f.layer === 'xsd' ? 'Schema (XSD)' : f.layer === 'xml' ? 'XML' : 'SEPA rule');

function meta(r) {
  return { tool: r.tool.name, toolVersion: r.tool.version, schema: r.xsd, ruleCatalogue: r.catalogue, processingDate: r.procDate, fileName: r.fileName, sha256: r.sha256, checkedAt: r.checkedAt };
}

export function toJson(r) {
  return JSON.stringify({ ...meta(r), verdict: r.verdict, verdictLine: r.verdictLine, status: r.status, layers: r.layers, counts: r.counts, summary: r.summary,
    findings: r.findings.map((f) => ({ layer: f.layer, id: f.id, severity: f.severity, line: f.line, column: f.col, path: f.path, message: f.message, expected: f.expected, found: f.found, fix: f.fix, technical: f.raw || null })) }, null, 2);
}

export function toJUnit(r) {
  const cases = [];
  const xmlF = r.findings.filter((f) => f.layer === 'xml');
  const xsdF = r.findings.filter((f) => f.layer === 'xsd');
  const fail = (list) => list.map((f) => `Line ${f.line ?? '?'}${f.path ? ' ' + f.path : ''}: ${f.message}`).join('\n');
  cases.push({ suite: 'XML', name: 'Well-formed XML', failures: xmlF, skipped: false });
  cases.push({ suite: 'Schema', name: `ISO 20022 ${r.xsd} schema`, failures: xsdF, skipped: r.layers.xsd === 'not run' });
  for (const rule of RULES) cases.push({ suite: 'SEPA rules', name: `${rule.id} ${rule.title}`, failures: r.findings.filter((f) => f.id === rule.id && f.severity === 'error'), warnings: r.findings.filter((f) => f.id === rule.id && f.severity === 'warning'), skipped: r.layers.rules === 'not run' });
  const suites = ['XML', 'Schema', 'SEPA rules'].map((s) => {
    const cs = cases.filter((c) => c.suite === s);
    const body = cs.map((c) => {
      let inner = '';
      if (c.skipped) inner = '<skipped message="Not run: an earlier layer failed or the message is not supported."/>';
      else if (c.failures.length) inner = `<failure message="${x(c.failures.length + ' finding(s)')}" type="${x(c.failures[0].id)}">${x(fail(c.failures))}</failure>`;
      if (c.warnings && c.warnings.length && !c.skipped) inner += `<system-out>${x('Warnings:\n' + fail(c.warnings))}</system-out>`;
      return `    <testcase classname="${x('PaymentXmlLab.' + s.replace(/\s/g, ''))}" name="${x(c.name)}">${inner}</testcase>`;
    }).join('\n');
    const failures = cs.filter((c) => !c.skipped && c.failures.length).length, skipped = cs.filter((c) => c.skipped).length;
    return `  <testsuite name="${x(s)}" tests="${cs.length}" failures="${failures}" errors="0" skipped="${skipped}">\n${body}\n  </testsuite>`;
  }).join('\n');
  const m = meta(r);
  const props = Object.entries(m).map(([k, v]) => `<property name="${x(k)}" value="${x(v)}"/>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites name="${x(m.tool + ' ' + m.toolVersion)}">\n  <properties>${props}</properties>\n${suites}\n</testsuites>\n`;
}

export function toHtml(r) {
  const m = meta(r);
  const rows = r.findings.map((f) => `<tr class="${f.severity}"><td>${x(f.line ?? '')}</td><td>${x(layerName(f))}</td><td>${x(f.id)}</td><td>${f.severity === 'error' ? 'Error' : 'Warning'}</td><td><b>${x(f.message)}</b>${f.path ? `<div class="p">${x(f.path)}</div>` : ''}${f.expected ? `<div>Expected: <code>${x(f.expected)}</code></div>` : ''}${f.found ? `<div>Found: <code>${x(f.found)}</code></div>` : ''}<div>Fix: ${x(f.fix)}</div></td></tr>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${x(m.tool)} report · ${x(m.fileName)}</title>
<style>body{font:14px/1.5 system-ui,sans-serif;color:#17202a;margin:32px;max-width:1100px}h1{font-size:22px;margin:0 0 4px}table{border-collapse:collapse;width:100%;margin-top:16px}th,td{text-align:left;vertical-align:top;border-bottom:1px solid #d5dbe1;padding:6px 8px}th{background:#f2f4f6}.meta td{border:0;padding:2px 12px 2px 0}.v{font-size:18px;font-weight:700;margin:12px 0}.error td:nth-child(4){color:#a3261b;font-weight:700}.warning td:nth-child(4){color:#8a5a00;font-weight:700}.p{font:12px ui-monospace,Menlo,Consolas,monospace;color:#56636f}code{font:12px ui-monospace,Menlo,Consolas,monospace;background:#f2f4f6;padding:0 4px}.n{color:#56636f;font-size:12px;margin-top:24px}</style></head><body>
<h1>${x(m.tool)}: check report</h1>
<table class="meta"><tr><td>File</td><td>${x(m.fileName)}</td></tr><tr><td>SHA-256</td><td><code>${x(m.sha256)}</code></td></tr><tr><td>Checked</td><td>${x(m.checkedAt)}</td></tr><tr><td>Processing date</td><td>${x(m.processingDate)}</td></tr><tr><td>Versions</td><td>tool ${x(m.toolVersion)} · schema ${x(m.schema)} · rule catalogue ${x(m.ruleCatalogue)}</td></tr>${r.summary ? `<tr><td>Message</td><td>${x(r.summary.msgId || '')} · ${x(r.summary.payments)} payment(s) in ${x(r.summary.batches)} batch(es) · total ${x(r.summary.total || '')}</td></tr>` : ''}</table>
<p class="v">${x(r.verdictLine)}</p>
${r.findings.length ? `<table><thead><tr><th>Line</th><th>Layer</th><th>ID</th><th>Severity</th><th>Finding</th></tr></thead><tbody>${rows}</tbody></table>` : '<p>No findings.</p>'}
<p class="n">Not a certified validator: it checks the official ISO 20022 schema and the rules in its catalogue; a bank may apply more. Rules: ${RULES.length} (${[...new Set(RULES.map((ru) => SOURCES[ru.source].name))].map(x).join('; ')}). Created on the device; the file was not uploaded.</p>
</body></html>`;
}

// Exports of the MT to MX Migration Lab, built in the browser: HTML report, CSV mapping table, JSON findings, JUnit XML.
// Each carries the tool version, the catalogue version, the export time and the SHA-256 of the MT input.
import { MAP_RULES, MAP_TOOL, MAP_CATALOGUE_VERSION, MX, STATUS, REJECTED, REJECTED_LINE } from './mt-map.js';

const x = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const NOTE = 'Not SWIFT\'s official translation and not CBPR+ validated. For learning and testing only. Not certified, not affiliated with SWIFT. Made on the device; the message was not uploaded.';
function meta({ res, sha, name, when }) {
  return { tool: MAP_TOOL.name, toolVersion: MAP_TOOL.version, catalogue: MAP_CATALOGUE_VERSION, target: MX.id, input: name, sha256: sha, exportedAt: when, verdict: res.verdict, counts: res.counts };
}
const schemaWord = (s) => (s.busy ? 'not finished' : s.failed ? 'not checked' : s.valid ? 'valid' : `${s.errors.length} error(s)`);

export function mapJson(ctx) {
  return JSON.stringify({ ...meta(ctx), ...(ctx.res.verdict === REJECTED ? { verdictLine: REJECTED_LINE } : {}), schema: schemaWord(ctx.schema), schemaErrors: (ctx.schema.errors || []).map((e) => ({ line: e.line, message: e.message, technical: e.raw })),
    findings: ctx.res.findings.map((f) => ({ severity: f.severity, rule: f.rule, status: f.status || null, mtLine: f.mtLine, xmlLine: f.xmlLine, message: f.message, why: f.why, fix: f.fix })), note: NOTE }, null, 2);
}

// a cell that starts with = + - @ (also their full-width forms, a tab or a return) could run as a formula in a spreadsheet: prefix it with '
const csvCell = (v) => { let s = String(v ?? ''); if (/^[=+\-@\t\r\uFF1D\uFF0B\uFF0D\uFF20]/.test(s)) s = "'" + s; return /[",\n\r;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
export function mapCsv(ctx) {
  const m = meta(ctx);
  const head = [`# ${m.tool} ${m.toolVersion}, catalogue ${m.catalogue}, exported ${m.exportedAt}, MT SHA-256 ${m.sha256}`, `# ${NOTE}`];
  const rows = [['MT field', 'MT lines', 'MT value', 'Rule', 'pacs.008 element', 'pacs.008 value', 'XML line', 'Status', 'Explanation']];
  for (const r of ctx.res.rows) rows.push([r.tag || '', r.mtLines.join(' '), r.mtValue, r.rule, r.path, r.value, r.xmlLine || '', STATUS[r.status], r.note]);
  return head.join('\n') + '\n' + rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
}

export function mapJUnit(ctx) {
  const m = meta(ctx); const res = ctx.res;
  const cases = MAP_RULES.map((r) => {
    const errs = res.findings.filter((f) => f.rule === r.id && f.severity === 'error');
    const reviews = res.findings.filter((f) => f.rule === r.id && f.severity !== 'error');
    let inner = errs.length ? `<failure message="${x(errs.length + ' error(s)')}" type="${r.id}">${x(errs.map((f) => `MT line ${f.mtLine ?? '?'}: ${f.message}`).join('\n'))}</failure>` : '';
    if (reviews.length) inner += `<system-out>${x(reviews.map((f) => `${f.severity}: ${f.message}`).join('\n'))}</system-out>`;
    return `<testcase classname="Mapping rules" name="${x(r.id + ' ' + r.target)}">${inner}</testcase>`;
  });
  const mtErr = res.findings.filter((f) => f.rule === 'MT');
  cases.unshift(`<testcase classname="MT103" name="MT103 format">${mtErr.length ? `<failure message="${x(mtErr.length + ' error(s)')}" type="MT">${x(mtErr.map((f) => `Line ${f.mtLine}: ${f.message}`).join('\n'))}</failure>` : ''}</testcase>`);
  const s = ctx.schema;
  cases.push(`<testcase classname="Schema" name="ISO 20022 ${MX.id} schema">${s.valid ? '' : s.errors ? `<failure message="${x(s.errors.length + ' error(s)')}" type="XSD">${x(s.errors.map((e) => `Line ${e.line}: ${e.raw}`).join('\n'))}</failure>` : '<skipped message="Schema not checked"/>'}</testcase>`);
  const failures = cases.filter((c) => c.includes('<failure')).length, skipped = cases.filter((c) => c.includes('<skipped')).length;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites name="${x(m.tool)}" tests="${cases.length}" failures="${failures}">\n<testsuite name="${x(m.input)}" tests="${cases.length}" failures="${failures}" skipped="${skipped}" timestamp="${x(m.exportedAt.slice(0, 19))}">\n<properties><property name="toolVersion" value="${x(m.toolVersion)}"/><property name="catalogue" value="${x(m.catalogue)}"/><property name="mtSha256" value="${x(m.sha256)}"/><property name="reviewPoints" value="${res.findings.filter((f) => f.severity === 'review').length}"/><property name="note" value="${x(NOTE)}"/></properties>\n${cases.join('\n')}\n</testsuite>\n</testsuites>\n`;
}

export function mapHtml(ctx) {
  const m = meta(ctx); const res = ctx.res;
  const rows = res.rows.map((r) => `<tr class="${r.status}"><td>${x(r.tag ? ':' + r.tag + ':' : '')}</td><td><code>${x(r.mtValue)}</code></td><td>${x(r.rule)}</td><td><code>${x(r.path)}</code></td><td><code>${x(r.value)}</code></td><td>${x(STATUS[r.status])}</td><td>${x(r.note)}</td></tr>`).join('');
  const finds = res.findings.map((f) => `<li><b>${x(f.severity)}</b> ${x(f.rule)}${f.mtLine ? ' · MT line ' + f.mtLine : ''}: ${x(f.message)}${f.fix ? ' <i>What to do: ' + x(f.fix) + '</i>' : ''}</li>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${x(m.tool)} report</title>
<style>body{font:14px/1.5 system-ui,sans-serif;color:#17202a;margin:32px;max-width:1200px}h1{font-size:22px;margin:0 0 4px}table{border-collapse:collapse;width:100%;margin-top:16px}th,td{text-align:left;vertical-align:top;border-bottom:1px solid #d5dbe1;padding:5px 7px;font-size:13px}th{background:#f2f4f6}.meta td{border:0;padding:2px 12px 2px 0}code{font:12px ui-monospace,Menlo,Consolas,monospace;white-space:pre-wrap}.review td:nth-child(6){color:#8a5a00;font-weight:700}.lost td:nth-child(6){color:#a3261b;font-weight:700}.n{color:#56636f;font-size:12px;margin-top:24px}pre{font:12px ui-monospace,Menlo,Consolas,monospace;background:#f6f7f9;padding:12px;overflow:auto}</style></head><body>
<h1>${x(m.tool)}: mapping report</h1>
<table class="meta"><tr><td>Input</td><td>${x(m.input)}</td></tr><tr><td>MT SHA-256</td><td><code>${x(m.sha256)}</code></td></tr><tr><td>Exported</td><td>${x(m.exportedAt)}</td></tr><tr><td>Versions</td><td>tool ${x(m.toolVersion)} · mapping catalogue ${x(m.catalogue)} · target ${x(m.target)}</td></tr><tr><td>Result</td><td><b>${x(m.verdict)}</b>${m.verdict === REJECTED ? '<br>' + x(REJECTED_LINE) + '<br>' : ''} · schema ${x(schemaWord(ctx.schema))} · ${Object.entries(m.counts).map(([k, v]) => `${v} ${STATUS[k].toLowerCase()}`).join(' · ')}</td></tr></table>
<h2>Findings</h2>${finds ? `<ul>${finds}</ul>` : '<p>Nothing to review.</p>'}
<h2>Mapping table</h2><table><thead><tr><th>MT field</th><th>MT value</th><th>Rule</th><th>pacs.008 element</th><th>pacs.008 value</th><th>Status</th><th>Explanation</th></tr></thead><tbody>${rows}</tbody></table>
<h2>pacs.008</h2><pre>${x(res.xml)}</pre>
<p class="n">${x(NOTE)}</p>
</body></html>`;
}
export const csvCellForTest = csvCell;

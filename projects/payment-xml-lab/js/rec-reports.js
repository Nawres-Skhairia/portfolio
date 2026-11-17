// Reconciliation Workbench exports, built in the browser: audit trail (CSV and JSON Lines), the updated open-invoice list (CSV),
// a printable report (HTML) and test results (JUnit XML). Each names the tool and catalogue versions, the statement and the
// SHA-256 of both input files. Also reads an exported trail back for "Check this trail".
import { REC_TOOL, REC_CATALOGUE_VERSION, REC_RULES, TRAIL_KEYS, TREATMENT, amt, plain, remShown } from './rec-engine.js';
import { splitCsv } from './invoices.js';
import { euro } from './rules.js';

export const REC_NOTE = 'A demonstration workbench, not accounting software. It does not post anything to a ledger. Not certified. Made-up data only; the files were read in the browser and not uploaded.';
const x = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// The same formula guard as the MT to MX exports (Noah's review): a cell starting with = + - @ (also full-width), a tab or a return gets a leading '
const GUARD = /^[=+\-@\t\r＝＋－＠]/;
const csvCell = (v) => { let s = String(v ?? ''); if (GUARD.test(s)) s = "'" + s; return /[",\n\r;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const unguard = (s) => (s.length > 1 && s[0] === "'" && GUARD.test(s.slice(1)) ? s.slice(1) : s);
export const csvCellForTest = csvCell;

function head(ctx) {
  const s = ctx.session, i = s.inputs;
  return { tool: REC_TOOL.name, toolVersion: REC_TOOL.version, catalogue: REC_CATALOGUE_VERSION, statement: s.stmt.id, account: s.stmt.iban, statementFile: i.stmtName, statementSha256: i.stmtSha, invoiceFile: i.invName, invoicesSha256: i.invSha, tolerance: `${euro(s.settings.tolAbs)} or ${s.settings.tolBp / 100} %, the smaller`, exportedAt: ctx.when, finalFingerprint: s.trail[s.trail.length - 1].fingerprint };
}
const comment = (ctx) => { const h = head(ctx); return [`# ${h.tool} ${h.toolVersion}, catalogue ${h.catalogue}, exported ${h.exportedAt}`, `# Statement ${h.statement} (${h.statementFile}) SHA-256 ${h.statementSha256}`, `# Invoices ${h.invoiceFile} SHA-256 ${h.invoicesSha256}`, `# Tolerance ${h.tolerance}. Final fingerprint ${h.finalFingerprint}`, `# ${REC_NOTE}`]; };

export function trailCsv(ctx) {
  const cols = [...TRAIL_KEYS, 'fingerprint'];
  return comment(ctx).join('\n') + '\n' + [cols, ...ctx.session.trail.map((l) => cols.map((k) => l[k]))].map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
}
export function trailJsonl(ctx) {
  const cols = [...TRAIL_KEYS, 'fingerprint'];
  return ctx.session.trail.map((l) => JSON.stringify(Object.fromEntries(cols.map((k) => [k, l[k]])))).join('\n') + '\n';
}
// reads an exported trail (JSON Lines or CSV) back into lines; throws with a plain message
export function parseTrail(text) {
  const t = String(text).replace(/^﻿/, '').trim();
  if (!t) throw new Error('The file is empty.');
  if (t.startsWith('{')) {
    return t.split(/\r?\n/).filter((l) => l.trim()).map((l, i) => { try { const o = JSON.parse(l); if (!o || typeof o !== 'object' || Array.isArray(o)) throw 0; return o; } catch (e) { throw new Error(`Line ${i + 1} of the file is not a trail line (JSON).`); } });
  }
  const rows = splitCsv(t, ',').filter((r) => !r.cells[0].startsWith('#'));
  const cols = rows[0] ? rows[0].cells : [];
  if (cols.join(',') !== [...TRAIL_KEYS, 'fingerprint'].join(',')) throw new Error('This is not an audit trail exported by the workbench (the columns differ).');
  return rows.slice(1).map((r) => Object.fromEntries(cols.map((k, i) => [k, unguard(r.cells[i] ?? '')])));
}

export function openInvoicesCsv(ctx) {
  const v = ctx.session.view;
  const rows = [['invoice_number', 'customer', 'customer_account', 'amount', 'open_amount', 'currency', 'due_date', 'reference', 'status', 'matched_by', 'suggested_in']];
  for (const s of v.invState) if (s.status !== 'closed') rows.push([s.inv.number, s.inv.customer, s.inv.account || '', plain(s.inv.amount), plain(s.open), s.inv.currency, s.inv.due || '', s.inv.reference || '', s.status, s.matches.join(' '), s.suggested.length ? 'yes' : '']);
  return comment(ctx).join('\n') + '\n' + rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
}

export function recJUnit(ctx) {
  const s = ctx.session, v = s.view, st = ctx.statement, h = head(ctx);
  const cases = [];
  cases.push(`<testcase classname="Statement" name="STM-01 camt.053.001.08 schema">${st.schema && st.schema.valid ? '' : '<failure message="schema errors" type="STM-01"/>'}</testcase>`);
  cases.push(`<testcase classname="Statement" name="STM-02 balances add up">${s.stmt.balance && s.stmt.balance.ok ? '' : '<failure message="balances do not add up" type="STM-02"/>'}</testcase>`);
  cases.push(`<testcase classname="Report" name="Totals add up">${v.totals.ok ? '' : `<failure message="totals do not add up" type="P3">${x(v.totals.checks.filter((c) => !c.ok).map((c) => c.text).join('\n'))}</failure>`}</testcase>`);
  for (const e of s.entries) {
    const p = v.places.get(e.ref);
    const inner = p.place === 'unmatched' ? `<failure message="${x('Unmatched: ' + p.un.reason)}" type="${x(p.un.rule)}"/>` : p.place === 'review' ? `<skipped message="${x('Waiting for review: ' + p.sug.rule + ' ' + p.sug.invoices.join(', '))}"/>` : `<system-out>${x(`${p.match.rule} ${p.match.invoices.join(', ')} (${p.match.kind})`)}</system-out>`;
    cases.push(`<testcase classname="Entries" name="${x(e.ref + ' ' + amt(e.amt) + ' ' + e.cd)}">${inner}</testcase>`);
  }
  const failures = cases.filter((c) => c.includes('<failure')).length, skipped = cases.filter((c) => c.includes('<skipped')).length;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites name="${x(h.tool)}" tests="${cases.length}" failures="${failures}">\n<testsuite name="${x(h.statement)}" tests="${cases.length}" failures="${failures}" skipped="${skipped}" timestamp="${x(String(h.exportedAt).slice(0, 19))}">\n<properties><property name="toolVersion" value="${x(h.toolVersion)}"/><property name="catalogue" value="${x(h.catalogue)}"/><property name="statementSha256" value="${x(h.statementSha256)}"/><property name="invoicesSha256" value="${x(h.invoicesSha256)}"/><property name="finalFingerprint" value="${x(h.finalFingerprint)}"/><property name="note" value="${x(REC_NOTE)}"/></properties>\n${cases.join('\n')}\n</testsuite>\n</testsuites>\n`;
}

export function recHtml(ctx) {
  const s = ctx.session, v = s.view, h = head(ctx), c = v.counts, b = s.stmt.balance;
  const ent = (r) => s.byRef.get(r);
  const row = (cells) => '<tr>' + cells.map((t) => `<td>${x(t)}</td>`).join('') + '</tr>';
  const matched = s.matches.map((m) => row([m.entries.join(' '), m.entries.map((r) => ent(r).payer || '').join(', '), amt(m.paid), m.invoices.join(', '), m.rule, m.kind === 'auto' ? 'Auto-matched' : m.kind === 'manual' ? 'Manual' : 'Accepted', TREATMENT[m.treatment] + (m.diff && m.treatment !== 'partial' ? ` (${amt(m.diff)})` : ''), m.reason])).join('');
  const review = v.suggestions.map((p) => row([p.entries.join(' '), ent(p.entries[0]).payer || '', amt(p.paid), p.invoices.join(', '), p.rule, p.effect])).join('');
  const un = v.unmatched.map((u) => row([u.entry, ent(u.entry).payer || '', (ent(u.entry).cd === 'DBIT' ? '−' : '') + amt(ent(u.entry).amt), remShown(ent(u.entry)), u.rule, u.reason])).join('');
  const left = v.invState.filter((i) => i.status !== 'closed').map((i) => row([i.inv.number, i.inv.customer, amt(i.inv.amount) + ' ' + i.inv.currency, amt(i.open), i.inv.due || '', i.status])).join('');
  const trail = s.trail.map((l) => row([l.seq, l.time, l.actor, l.action, l.entries, l.invoices, l.rule, l.paid, l.difference, l.reason || l.detail, l.fingerprint.slice(0, 16) + '…'])).join('');
  const tbl = (head, body, empty) => body ? `<table><thead><tr>${head.map((t) => `<th>${x(t)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>` : `<p>${x(empty)}</p>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${x(h.tool)} report</title>
<style>body{font:14px/1.5 system-ui,sans-serif;color:#17202a;margin:32px;max-width:1200px}h1{font-size:22px;margin:0 0 4px}h2{font-size:17px;margin:22px 0 6px}table{border-collapse:collapse;width:100%;margin-top:8px}th,td{text-align:left;vertical-align:top;border-bottom:1px solid #d5dbe1;padding:5px 7px;font-size:13px}th{background:#f2f4f6}.meta td{border:0;padding:2px 12px 2px 0}code{font:12px ui-monospace,Menlo,Consolas,monospace;overflow-wrap:anywhere}.ok{color:#1d6b3a}.bad{color:#a3261b}.n{color:#56636f;font-size:12px;margin-top:24px}</style></head><body>
<h1>${x(h.tool)}: reconciliation report</h1>
<table class="meta"><tr><td>Statement</td><td>${x(h.statement)} · account ${x(h.account)} · ${x(s.stmt.date)} · file ${x(h.statementFile)}</td></tr><tr><td>Statement SHA-256</td><td><code>${x(h.statementSha256)}</code></td></tr><tr><td>Invoices</td><td>${x(h.invoiceFile)} · ${s.invoices.length} invoices</td></tr><tr><td>Invoices SHA-256</td><td><code>${x(h.invoicesSha256)}</code></td></tr><tr><td>Versions</td><td>tool ${x(h.toolVersion)} · rule catalogue ${x(h.catalogue)} · tolerance ${x(h.tolerance)}</td></tr><tr><td>Exported</td><td>${x(h.exportedAt)}</td></tr>
<tr><td>Checks</td><td>Schema camt.053.001.08: valid · Balances: opening ${x(amt(b.opening))} + credits ${x(euro(s.stmt.totals.credits))} − debits ${x(euro(s.stmt.totals.debits))} = closing ${x(amt(b.closing))} ✓</td></tr>
<tr><td>Result</td><td><b>Auto-matched ${c.auto} · Decided by you ${c.person} · To review ${c.review} · Unmatched ${c.unmatched}</b> of ${c.entries} entries · invoices closed ${c.closed}, partly paid ${c.partly}, open ${c.open}</td></tr>
<tr><td>Final fingerprint</td><td><code>${x(h.finalFingerprint)}</code> (keep this report: "Check this trail" compares an exported trail with it)</td></tr></table>
<h2>Totals</h2><ul>${v.totals.checks.map((k) => `<li class="${k.ok ? 'ok' : 'bad'}">${k.ok ? '✓' : '✗'} ${x(k.text)}</li>`).join('')}</ul>
<h2>Matched</h2>${tbl(['Entry', 'Payer', 'Paid', 'Invoices', 'Rule', 'How', 'Treatment', 'Reason'], matched, 'Nothing matched.')}
<h2>To review</h2>${tbl(['Entry', 'Payer', 'Paid', 'Invoices', 'Rule', 'If accepted'], review, 'Nothing waits for review.')}
<h2>Unmatched</h2>${tbl(['Entry', 'Payer', 'Amount', 'Payment details', 'Rule', 'Reason'], un, 'Nothing unmatched.')}
<h2>Open invoices left</h2>${tbl(['Invoice', 'Customer', 'Amount', 'Open', 'Due', 'Status'], left, 'Every invoice is closed.')}
<h2>Audit trail</h2>${tbl(['#', 'Time', 'Actor', 'Action', 'Entries', 'Invoices', 'Rule', 'Paid', 'Difference', 'Reason or detail', 'Fingerprint'], trail, '')}
<h2>Rules</h2><ul>${REC_RULES.map((r) => `<li><b>${x(r.id)} ${x(r.name)}</b>${r.auto ? ' (automatic)' : ''}: ${x(r.what)}</li>`).join('')}</ul>
<p class="n">${x(REC_NOTE)} The fingerprint chain shows a trail is unchanged only when compared with the final fingerprint printed here: without a server or a signing key, someone could rebuild the whole chain after an edit.</p>
</body></html>`;
}

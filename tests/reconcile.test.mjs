// Reconciliation Workbench: automatic proof of Olivia's acceptance tests (PORT-42) and Daniel's design points (PORT-39).
// Run: npm i --no-save xmllint-wasm@5.3.0 && node tests/reconcile.test.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { validateXML } = require(process.env.XMLLINT_WASM || 'xmllint-wasm');
const base = new URL('../projects/payment-xml-lab/', import.meta.url);
const { readStatement } = await import(new URL('js/camt053.js', base));
const { readInvoices, parseAmount } = await import(new URL('js/invoices.js', base));
const E = await import(new URL('js/rec-engine.js', base));
const R = await import(new URL('js/rec-reports.js', base));
const { REC_SAMPLES, SAMPLE_PLAN, statementXml, invoiceCsv } = await import(new URL('js/rec-samples.js', base));
const { sha256 } = await import(new URL('js/sha256.js', base));
const xsd = readFileSync(new URL('schemas/camt.053.001.08.xsd', base), 'utf8');
const validateSchema = async (xml) => {
  const r = await validateXML({ xml: [{ fileName: 'payment.xml', contents: xml }], schema: [{ fileName: 'x.xsd', contents: xsd }], modifyArguments: (a) => a.concat(['--nonet']) });
  return { valid: r.valid, errors: r.errors.map((e) => ({ line: e.loc ? e.loc.lineNumber : null, raw: e.rawMessage, message: e.rawMessage.replace(/^payment\.xml:\d+:\s*/, '') })) };
};
let failed = 0, passed = 0;
const ok = (cond, name, detail) => { if (cond) passed++; else { failed++; console.log('FAIL', name, detail != null ? '\n   ' + detail : ''); } };
let tick = 0;
const clock = () => `2026-11-17T09:00:${String(tick++ % 60).padStart(2, '0')}Z`;
async function session(xml = statementXml(), csv = invoiceCsv(), settings) {
  const st = await readStatement(xml, { validateSchema });
  const inv = readInvoices(csv);
  if (!st.reconcilable || !inv.ok) return { st, inv, s: null };
  return { st, inv, s: E.createSession({ stmt: st.stmt, invoices: inv.invoices, settings, inputs: { stmtName: 's.xml', stmtSha: sha256(xml), invName: 'i.csv', invSha: sha256(csv) }, clock }) };
}
const place = (s, ref) => s.view.places.get(ref);
const ruleOf = (p) => (p.match ? p.match.rule : p.sug ? p.sug.rule : p.un.rule);
const ctx = (s, st) => ({ session: s, statement: st, when: '2026-11-17T10:00:00Z' });

// SHA-256 in plain JavaScript agrees with the platform's
for (const t of ['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), 'Zoë € 你好 ' + 'x'.repeat(1000)]) ok(sha256(t) === createHash('sha256').update(t, 'utf8').digest('hex'), `sha256 of a ${t.length}-character text`);

// the sample statement is schema-valid; AT1 counters, integrity line and the grouped match first in the queue
{
  const { st, s } = await session();
  ok(st.status === 'ok' && st.schema.valid, 'AT1 sample statement valid against camt.053.001.08', st.findings.map((f) => f.message).join(' | '));
  ok(st.stmt.balance.ok && E.amt(st.stmt.balance.opening) === '12,400.00' && E.amt(st.stmt.totals.debits) === '1,210.00', 'AT1 balances add up');
  ok(st.stmt.totals.nCr === 24 && st.stmt.totals.nDb === 2, 'AT1 24 credits, 2 debits');
  const c = s.view.counts;
  ok(c.auto === 14 && c.review === 7 && c.unmatched === 5 && c.person === 0, 'AT1 counters 14 / 7 / 5', JSON.stringify(c));
  const first = s.view.suggestions[0];
  ok(first.rule === 'REC-05' && first.invoices.join() === 'INV-1042,INV-1047,INV-1051' && E.amt(first.paid) === '3,450.00', 'AT1 grouped Bellmont match first in the queue', first && first.id);
  ok(s.trail[0].action === 'load' && /SHA-256 [0-9a-f]{64}/.test(s.trail[0].detail) && s.trail.length === 15, 'AT1 trail: load line + 14 automatic matches');
  // AT2 each rule REC-01..10 has a sample case with the expected status
  const PL = { 'REC-01': 'auto', 'REC-02': 'auto', 'REC-03': 'review', 'REC-04': 'review', 'REC-05': 'review', 'REC-06': 'review', 'REC-07': 'review', 'REC-08': 'unmatched', 'REC-09': 'unmatched', 'REC-10': 'review', unknown: 'unmatched' };
  for (const p of SAMPLE_PLAN) {
    const got = place(s, p.ref);
    ok(got.place === PL[p.shows] && (p.shows === 'unknown' ? ruleOf(got) === '—' : ruleOf(got) === p.shows), `AT2 ${p.ref} gives ${p.shows} (${PL[p.shows]})`, `${got.place} ${ruleOf(got)}`);
  }
  for (const r of E.REC_RULES) ok(SAMPLE_PLAN.some((p) => p.shows === r.id), `AT2 ${r.id} has a sample case`);
  // evidence lines, not scores
  const ev = (ref) => (place(s, ref).match || place(s, ref).sug).evidence;
  ok(ev('XMPL2611170006').some((l) => l.m === '✓' && /RF creditor reference RF18 5390 0754 7034 found in the structured reference, check digits valid/.test(l.t)), 'RF reference evidence line');
  ok(ev('XMPL2611170020').some((l) => l.m === '≈' && /short by 5\.00, within the tolerance of 5\.00/.test(l.t)), 'REC-02 amount evidence line');
  ok(place(s, 'XMPL2611170020').match.effect.includes('5.00 booked as small difference'), 'REC-02 effect');
  ok(ev('XMPL2611170020').some((l) => /tolerance of 5\.00 \(the fixed 5\.00, smaller than 0\.5 % of 1,200\.00 \(6\.00\)\)/.test(l.t)), 'evidence names the tolerance that applied');
  ok(ev('XMPL2611170016').some((l) => /beyond the tolerance of 4\.75 \(0\.5 % of 950\.00, smaller than the fixed 5\.00\)/.test(l.t)), 'evidence names the percent tolerance');
  ok(place(s, 'XMPL2611170025').sug && !/%/.test(ev('XMPL2611170025').map((l) => l.t).join(' ')), 'REC-10 is suggested and shows no percentage');
  ok(ev('XMPL2611170025').some((l) => /"INV1O59" read as INV-1059/.test(l.t)), 'REC-10 typo evidence');
  ok(ev('XMPL2611170005').some((l) => l.k === 'Conflict' && /XMPL2611170024/.test(l.t)), 'REC-03 two partials for one invoice show the conflict');
  ok(ev('XMPL2611170001').some((l) => /number 1047 found in a list after an invoice word, read as INV-1047/i.test(l.t)), 'REC-05 messy list "Factures 1042, 1047, 1051"');
  ok(/several|combination/i.test(ev('XMPL2611170010').map((l) => l.t).join(' ')) && place(s, 'XMPL2611170010').sug.invoices.join() === 'INV-1048,INV-1052', 'REC-06 the only combination');
  ok(/Possible duplicate/.test(place(s, 'XMPL2611170019').un.reason), 'REC-08 reason');
  ok(/INV-1050 \(Tamberly SA\)/.test(place(s, 'XMPL2611170013').un.reason), 'unknown payer names the invoice of the same amount');
  ok(/USD 500\.00/.test(place(s, 'XMPL2611170023').un.reason) && place(s, 'XMPL2611170023').un.candidates.join() === 'INV-1060', 'REC-09 other currency with its candidate');
  ok(/bank fee/.test(place(s, 'XMPL2611170008').un.reason) && /refund/.test(place(s, 'XMPL2611170026').un.reason), 'REC-09 fee and refund');
  ok(!JSON.stringify(s.view.suggestions.map((p) => p.evidence)).match(/score|similar|confiden|\d+ ?% (match|sure)/i), 'no scores or percentages in evidence');
  // AT10 totals add up
  ok(s.view.totals.ok, 'AT10 totals add up at start', s.view.totals.checks.filter((x) => !x.ok).map((x) => x.text).join(' | '));
}

// AT3 tolerance 0 moves the REC-02 cases to review
{
  const { s } = await session();
  E.changeSettings(s, { tolAbs: 0n, tolBp: 0 });
  ok(place(s, 'XMPL2611170020').place === 'review' && place(s, 'XMPL2611170022').place === 'review', 'AT3 tolerance 0: REC-02 cases wait for review');
  ok(s.view.counts.auto === 12 && s.trail[s.trail.length - 13].action === 'settings changed' && /0 decisions by a person undone/.test(s.trail[s.trail.length - 13].detail), 'AT3 restart is in the trail', s.view.counts.auto);
  const { s: s2 } = await session(undefined, undefined, { tolAbs: 500000n, tolBp: 0 });
  ok(place(s2, 'XMPL2611170020').place === 'review', 'tolerance is the smaller of the two settings');
}

// AT4 REC-06 with two possible combinations matches nothing
{
  const rows = [[2001, 'kestrel', '500.00', '2026-11-01'], [2002, 'kestrel', '700.00', '2026-11-02'], [2003, 'kestrel', '300.00', '2026-11-03'], [2004, 'kestrel', '900.00', '2026-11-04']];
  const entries = [['REC-06', 'kestrel', '1200.00', 'October deliveries']];
  const { s } = await session(statementXml({ entries }), invoiceCsv(rows));
  const p = place(s, 'XMPL2611170001');
  ok(p.place === 'unmatched' && p.un.rule === 'REC-06' && /several combinations possible/.test(p.un.reason), 'AT4 several combinations: unmatched', p.un && p.un.reason);
  // single invoice and a combination both fit: also not a guess
  const rows2 = [[2001, 'kestrel', '1200.00', '2026-11-01'], [2002, 'kestrel', '700.00', '2026-11-02'], [2003, 'kestrel', '500.00', '2026-11-03']];
  const { s: s2 } = await session(statementXml({ entries }), invoiceCsv(rows2));
  ok(place(s2, 'XMPL2611170001').place === 'unmatched', 'AT4 one invoice and one combination fit: unmatched');
  // more than 30 open invoices for one payer
  const many = Array.from({ length: 31 }, (_, i) => [3000 + i, 'kestrel', '10.00', '2026-11-01']);
  const { s: s3 } = await session(statementXml({ entries: [['x', 'kestrel', '25.00', 'payment']] }), invoiceCsv(many));
  ok(/too many to check every combination safely/.test(place(s3, 'XMPL2611170001').un.reason), 'more than 30 open invoices: not searched');
}

// AT5 partial payment, then a second payment completes it; AT7 undo
{
  const { s } = await session();
  const p = s.view.suggestions.find((x) => x.entries[0] === 'XMPL2611170005');
  E.accept(s, p.id);
  const inv = s.view.invState.find((x) => x.inv.number === 'INV-1055');
  ok(inv.status === 'closed', 'AT5 second payment completes INV-1055 automatically', inv.status + ' ' + E.amt(inv.open));
  const m2 = place(s, 'XMPL2611170024').match;
  ok(m2 && m2.kind === 'auto' && m2.rule === 'REC-01' && s.trail[s.trail.length - 1].detail.startsWith('after line 16'), 'AT5 the completing match is automatic and names its cause');
  const before = s.trail.length;
  E.undo(s);
  const inv2 = s.view.invState.find((x) => x.inv.number === 'INV-1055');
  ok(inv2.status === 'open' && place(s, 'XMPL2611170005').place === 'review' && place(s, 'XMPL2611170024').place === 'review', 'AT7 undo restores the previous state');
  ok(s.trail.length === before + 1 && s.trail[s.trail.length - 1].action === 'undo' && /undoes line 16 and the 1 automatic match it allowed \(line 17\)/.test(s.trail[s.trail.length - 1].detail), 'AT7 undo line in the trail', s.trail[s.trail.length - 1].detail);
  // partial accepted alone leaves the remaining amount
  const { s: s4 } = await session(statementXml({ entries: [['REC-03', 'ordway', '800.00', 'INV-1055 first instalment']] }));
  E.accept(s4, s4.view.suggestions[0].id);
  const x4 = s4.view.invState.find((x) => x.inv.number === 'INV-1055');
  ok(x4.status === 'partly paid' && E.amt(x4.open) === '400.00', 'AT5 partial leaves 400.00 open');
  ok(E.undo && s4.view.totals.ok, 'AT10 totals after a partial');
}

// AT6 reasons are needed; manual match with live balance
{
  const { s } = await session();
  const p = s.view.suggestions[0];
  let threw = false; try { E.reject(s, p.id, '  '); } catch (e) { threw = /reason is needed/.test(e.message); }
  ok(threw, 'AT6 reject without a reason is refused');
  E.reject(s, p.id, 'Customer says it pays other invoices');
  const u = place(s, 'XMPL2611170001');
  ok(u.place === 'unmatched' && /You rejected the suggestion REC-05/.test(u.un.reason), 'AT6 a rejected suggestion goes to unmatched with the reason');
  const pv = E.manualPreview(s, ['XMPL2611170001'], ['INV-1042', 'INV-1047']);
  ok(E.amt(pv.paid) === '3,450.00' && E.amt(pv.due) === '2,450.00' && E.amt(pv.diff) === '1,000.00' && pv.options.join() === 'credit,small-diff', 'AT6 manual match live balance');
  threw = false; try { E.manual(s, ['XMPL2611170001'], ['INV-1042', 'INV-1047'], 'credit', ''); } catch (e) { threw = /reason is needed/.test(e.message); }
  ok(threw, 'AT6 manual match without a reason is refused');
  E.manual(s, ['XMPL2611170001'], ['INV-1042', 'INV-1047'], 'credit', 'Customer will use the rest as a deposit');
  ok(place(s, 'XMPL2611170001').match.kind === 'manual' && s.trail[s.trail.length - 1].action === 'manual match', 'AT6 recorded as Manual');
  ok(s.view.totals.ok, 'AT10 totals after reject and manual match', s.view.totals.checks.filter((x) => !x.ok).map((x) => x.text).join(' | '));
  // USD entry matched by hand to the USD invoice using the instructed amount
  const pv2 = E.manualPreview(s, ['XMPL2611170023'], ['INV-1060']);
  ok(pv2.ccy === 'USD' && pv2.diff === 0n && !pv2.problems.length, 'manual match in the original currency');
  ok(E.manualPreview(s, ['XMPL2611170008'], ['INV-1050']).problems.some((x) => /not a booked customer payment/.test(x)), 'a bank fee cannot be matched to an invoice');
  // partial by hand over two invoices: oldest due date first
  const { s: s5 } = await session();
  E.reject(s5, s5.view.suggestions[0].id, 'checking by hand');
  E.manual(s5, ['XMPL2611170001'], ['INV-1042', 'INV-1047', 'INV-1051', 'INV-1046'], 'partial', 'Customer paid the oldest first');
  const st5 = Object.fromEntries(s5.view.invState.map((x) => [x.inv.number, x]));
  ok(st5['INV-1042'].status === 'closed' && st5['INV-1047'].status === 'closed' && st5['INV-1051'].status === 'closed' && st5['INV-1046'].status === 'open', 'manual partial allocates by due date', ['INV-1042', 'INV-1047', 'INV-1051', 'INV-1046'].map((n) => st5[n].status).join());
  // reject an automatic match
  const auto = place(s5, 'XMPL2611170002').match;
  E.reject(s5, auto.id, 'Wrong customer');
  ok(place(s5, 'XMPL2611170002').place === 'unmatched' && s5.trail.some((l) => l.action === 'reject match' && l.reason === 'Wrong customer' && /undoes automatic match of line 2/.test(l.detail)), 'an automatic match can be rejected, with a reason');
  ok(place(s5, 'XMPL2611170019').match && place(s5, 'XMPL2611170019').match.invoices.join() === 'INV-1031', 'the same payer\'s second payment then takes the freed invoice');
  ok(s5.view.totals.ok, 'AT10 totals after rejecting an automatic match');
}

// AT8 exported trail: intact, one line edited, one line removed; CSV formula guard survives the round trip
{
  const { st, s } = await session();
  E.reject(s, s.view.suggestions[1].id, '=HYPERLINK("http://x","click")');
  E.manual(s, ['XMPL2611170023'], ['INV-1060'], 'closed', '-USD invoice paid via conversion');
  const csv = R.trailCsv(ctx(s, st)), jsonl = R.trailJsonl(ctx(s, st));
  ok(csv.includes(`'=HYPERLINK`) && csv.includes(`'-USD`), 'trail CSV guards formula-like cells');
  ok(/^# Reconciliation Workbench 0\.1\.0, catalogue/.test(csv) && csv.includes('Final fingerprint ' + s.trail[s.trail.length - 1].fingerprint), 'trail CSV header names versions and the final fingerprint');
  for (const [name, text] of [['CSV', csv], ['JSON Lines', jsonl]]) {
    const r = E.verifyTrail(R.parseTrail(text));
    ok(r.ok && r.count === s.trail.length && r.last === s.trail[s.trail.length - 1].fingerprint, `AT8 ${name} trail checks out`, JSON.stringify(r.problem));
  }
  const lines = jsonl.trim().split('\n');
  const edited = lines.slice(); edited[6] = edited[6].replace('"paid":"712.00"', '"paid":"7120.00"');
  const r1 = E.verifyTrail(R.parseTrail(edited.join('\n')));
  ok(!r1.ok && r1.problem.line === 7 && /Line 7 .* was changed/.test(r1.problem.message), 'AT8 an edited line is named', r1.problem && r1.problem.message);
  const removed = lines.filter((_, i) => i !== 9);
  const r2 = E.verifyTrail(R.parseTrail(removed.join('\n')));
  ok(!r2.ok && r2.problem.line === 10 && /chain breaks at line 10/.test(r2.problem.message), 'AT8 a removed line shows at the next line', r2.problem && r2.problem.message);
  const csvEdited = csv.replace('Wrong', 'Right').replace(',INV-1033,REC-01,425.50,', ',INV-1033,REC-01,425.00,');
  const r3 = E.verifyTrail(R.parseTrail(csvEdited));
  ok(!r3.ok && r3.problem.line === 4, 'AT8 an edited CSV line is named', r3.problem && r3.problem.message);
  let threw = ''; try { R.parseTrail('a,b\n1,2'); } catch (e) { threw = e.message; }
  ok(/not an audit trail/.test(threw), 'a file that is not a trail is refused');
  // other exports
  const html = R.recHtml(ctx(s, st));
  ok(!/<script/i.test(html) && html.includes("default-src 'none'") && html.includes(s.trail[s.trail.length - 1].fingerprint) && html.includes('not accounting software'), 'HTML report: no script, own CSP, final fingerprint, honest line');
  const junit = R.recJUnit(ctx(s, st));
  ok(/tests="29" failures="5"/.test(junit) && /skipped="6"/.test(junit), 'JUnit: 3 checks + 26 entries', junit.match(/<testsuite [^>]*>/)[0]);
  const open = R.openInvoicesCsv(ctx(s, st));
  ok(open.split('\n').filter((l) => /^INV-/.test(l)).length === s.view.counts.open + s.view.counts.partly, 'open invoices CSV lists what is left');
  ok(R.csvCellForTest('＝1+1') === "'＝1+1" && R.csvCellForTest('a\rb') === '"a\rb"', 'CSV guard: full-width and CR');
}

// AT9 wrong closing balance and invalid schema are not reconciled; safety gate; other messages
{
  const b = await session(REC_SAMPLES.find((x) => x.id === 'balance').statement());
  ok(!b.s && b.st.status === 'control-errors' && b.st.findings.some((f) => f.id === 'STM-02' && /difference 100\.00/.test(f.message)), 'AT9 wrong closing balance: not reconciled');
  const v = await session(REC_SAMPLES.find((x) => x.id === 'schema').statement());
  ok(!v.s && v.st.status === 'schema-errors' && v.st.findings.some((f) => f.id === 'STM-01' && !/pain/.test(f.message + f.fix)), 'AT9 invalid statement shows schema findings', v.st.findings.map((f) => f.message + ' ' + f.fix).join(' | '));
  const dt = await readStatement('<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "b">]><Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08"/>', { validateSchema });
  ok(dt.status === 'refused', 'DOCTYPE refused by the shared safety gate');
  const pain = await readStatement('<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.09"><CstmrCdtTrfInitn/></Document>', { validateSchema });
  ok(pain.status === 'unsupported' && /Payment file check/.test(pain.reason), 'a pain.001 is sent to the Payment file check');
  const c54 = await readStatement('<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.054.001.08"/>', { validateSchema });
  ok(c54.status === 'unsupported' && /camt\.054/.test(c54.reason), 'camt.054 recognised, not supported');
  const nwf = await readStatement('<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08"><BkToCstmrStmt>', { validateSchema });
  ok(nwf.status === 'not-wellformed', 'not well-formed statement');
  // pending entry: shown apart, out of the balance and of the matching
  const pend = statementXml().replace('<Sts><Cd>BOOK</Cd></Sts>', '<Sts><Cd>PDNG</Cd></Sts>');
  const st = await readStatement(pend, { validateSchema });
  ok(st.findings.some((f) => f.id === 'STM-05') && st.findings.some((f) => f.id === 'STM-02'), 'pending entry is shown apart and left out of the balance');
  // entry in another currency than the account
  const usd = statementXml().replace('<Amt Ccy="EUR">10.00</Amt>', '<Amt Ccy="USD">10.00</Amt>');
  ok((await readStatement(usd, { validateSchema })).findings.some((f) => f.id === 'STM-04'), 'STM-04 entry in another currency');
  // duplicate bank reference and wrong summary
  const dup = statementXml().replace('XMPL2611170003', 'XMPL2611170002').replace('<NbOfNtries>24</NbOfNtries>', '<NbOfNtries>23</NbOfNtries>');
  const sd = await readStatement(dup, { validateSchema });
  ok(sd.findings.some((f) => f.id === 'STM-06') && sd.findings.some((f) => f.id === 'STM-07') && sd.reconcilable, 'STM-06 and STM-07 are warnings');
  // a debit opening balance (overdraft) carries its sign
  const od = statementXml({ opening: '0.00' }).replace(/(<Tp><CdOrPrtry><Cd>OPBD<\/Cd><\/CdOrPrtry><\/Tp>\s*<Amt Ccy="EUR">)0\.00(<\/Amt>\s*<CdtDbtInd>)CRDT/, '$1500.00$2DBIT');
  const so = await readStatement(od, { validateSchema });
  ok(so.stmt.balance.opening === -50000000n && so.findings.some((f) => f.id === 'STM-02'), 'overdraft opening balance is negative');
  // RF with wrong check digits is not used as a reference
  const badRf = statementXml().replace('RF18539007547034', 'RF19539007547034');
  const { s: sb } = await session(badRf);
  ok(place(sb, 'XMPL2611170006').place !== 'auto', 'RF reference with wrong check digits is not matched automatically', place(sb, 'XMPL2611170006').place);
}

// PRCD (previous closing booked) is accepted as the opening balance when there is no OPBD (Mia)
{
  const prcd = statementXml().replace('<Cd>OPBD</Cd>', '<Cd>PRCD</Cd>');
  const st = await readStatement(prcd, { validateSchema });
  ok(st.reconcilable && st.stmt.balance.ok && !st.findings.some((f) => f.id === 'STM-03'), 'PRCD accepted as opening balance', st.findings.map((f) => f.message).join(' | '));
  const none = await readStatement(statementXml().replace('<Cd>OPBD</Cd>', '<Cd>ITBD</Cd>'), { validateSchema });
  ok(none.findings.some((f) => f.id === 'STM-03'), 'no opening balance at all is still STM-03');
}
// a reason that really starts with an apostrophe survives the CSV round trip (Mia)
{
  const { st, s } = await session();
  E.reject(s, s.view.suggestions[0].id, "'=quoted by the customer");
  E.reject(s, s.view.suggestions[0].id, "'plain apostrophe");
  const lines = R.parseTrail(R.trailCsv(ctx(s, st)));
  ok(E.verifyTrail(lines).ok && lines.some((l) => l.reason === "'=quoted by the customer") && lines.some((l) => l.reason === "'plain apostrophe"), 'apostrophe reasons check out from CSV');
}

// a reversal sends the reversed payment to review instead of leaving it matched (Daniel, PORT-42)
{
  const smp = REC_SAMPLES.find((x) => x.id === 'reversal');
  const { st, s } = await session(smp.statement());
  ok(st.reconcilable && st.schema.valid, 'reversal sample is schema-valid and balances');
  const o = place(s, 'XMPL2611170027'), r = place(s, 'XMPL2611170028');
  ok(o.place === 'review' && o.sug.rule === 'REC-01' && o.sug.evidence.some((l) => l.m === '✗' && l.k === 'Reversed' && /XMPL2611170028/.test(l.t)), 'reversed payment waits for review, flagged', o.place);
  ok(r.place === 'unmatched' && /A reversal of entry XMPL2611170027/.test(r.un.reason) && /AC04/.test(r.un.reason), 'the reversal names the entry it takes back', r.un && r.un.reason);
  ok(s.view.counts.auto === 14 && s.view.invState.find((x) => x.inv.number === 'INV-1056').status === 'open', 'INV-1056 stays open');
  E.accept(s, o.sug.id);
  ok(/is matched to INV-1056 \(accepted\): check that decision/.test(place(s, 'XMPL2611170028').un.reason), 'after a person accepts it, the reversal points at that decision');
  ok(s.view.totals.ok, 'AT10 totals with a reversal');
}

// invoices CSV reader
{
  const dec5 = readInvoices('invoice,customer,amount,currency\nINV-1,A,10.12345,EUR\nINV-2,B,1000,JPY\nINV-3,C,1.5,JPY\nINV-4,D,1.125,KWD\n');
  ok(!dec5.ok && dec5.problems.length === 2 && /more decimals than EUR allows \(2\)/.test(dec5.problems[0].message) && /JPY allows \(0\)/.test(dec5.problems[1].message), 'more decimals than the currency allows are refused', dec5.problems.map((p) => p.message).join(' | '));
  const semi = 'Rechnungsnummer;Kunde;IBAN;Betrag;Währung;Fälligkeit\nINV-1;Alpha GmbH;;1.250,50;EUR;17.11.2026\nINV-2;Beta;;"2.000,00";EUR;2026-11-18\n';
  const a = readInvoices(semi);
  ok(a.ok && a.sep === ';' && a.decimal === ',' && E.amt(a.invoices[0].amount) === '1,250.50' && a.invoices[0].due === '2026-11-17', 'semicolon CSV with decimal comma and German headers', a.error);
  const amb = readInvoices('invoice,customer,amount,currency\nINV-1,A,"1,200",EUR\n');
  ok(!amb.ok && amb.needsMapping && /1\.2 or as 1200/.test(amb.error), 'ambiguous "1,200" is not guessed');
  const amb2 = readInvoices('invoice,customer,amount,currency\nINV-1,A,"1,200",EUR\n', { mapping: amb.mapping, decimal: '.' });
  ok(amb2.ok && E.amt(amb2.invoices[0].amount) === '1,200.00', '"1,200" read as 1200 once the decimal point is chosen');
  const mixed = readInvoices('invoice,customer,amount,currency\nINV-1,A,"1,50",EUR\nINV-2,B,2.50,EUR\n');
  ok(!mixed.ok && /both a decimal point and a decimal comma/.test(mixed.error), 'mixed decimal marks refused');
  const odd = readInvoices('Ref,Who,Value,Cur\nINV-1,A,10.00,EUR\n');
  ok(!odd.ok && odd.needsMapping && /Invoice number, Customer, Amount\./.test(odd.error), 'unknown headers ask for the column mapping');
  const mapped = readInvoices('Ref,Who,Value,Cur\nINV-1,A,10.00,EUR\n', { mapping: { number: 0, customer: 1, amount: 2, currency: 3 } });
  ok(mapped.ok && mapped.invoices[0].number === 'INV-1', 'column mapping chosen by the person');
  const bad = readInvoices('invoice,customer,customer_account,amount,currency,due_date\nINV-1,A,DE00 1234,10.00,EUR,2026-02-30\nINV-1,B,,x,EURO,\n');
  ok(!bad.ok && bad.problems.length === 5 && !bad.invoices.length, 'bad IBAN, date, duplicate number, amount and currency refuse the file', bad.problems.map((p) => p.message).join(' | '));
  const formula = readInvoices('invoice,customer,amount,currency\n=1+1,"=HYPERLINK(""x"")",10.00,EUR\n');
  ok(formula.ok && formula.invoices[0].number === '=1+1' && formula.invoices[0].customer === '=HYPERLINK("x")', 'formula-like cells stay plain text');
  ok(!readInvoices('invoice,customer,amount,currency\nINV-1,A,10.00,EUR\u0007\n').ok, 'control characters refused');
  const neg = readInvoices('invoice,customer,amount,currency\nCN-1,A,-10.00,EUR\n');
  ok(!neg.ok && /Credit notes are not in this version/.test(neg.problems[0].message), 'negative amount: credit notes are not in this version');
  ok(parseAmount('1 234,56', ',') === 123456000n && parseAmount('1,23,4.00', '.') === null && parseAmount('12.345.678,9', ',') === 1234567890000n, 'amount reader');
  const big = readInvoices('invoice,customer,amount,currency\n' + 'INV-1,A,1.00,EUR\n'.repeat(5001));
  ok(!big.ok && /limit is 5,000/.test(big.error), 'more than 5,000 invoices refused');
}

// AT11 no network: the workbench code makes no requests of its own (the schema file is fetched once by the shared loader)
{
  const dir = new URL('js/', base);
  for (const f of readdirSync(dir).filter((n) => /^(rec-|camt053|invoices|sha256)/.test(n))) {
    const src = readFileSync(new URL(f, dir), 'utf8');
    ok(!/\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource|localStorage|indexedDB|document\.cookie|innerHTML|insertAdjacentHTML|eval\s*\(|new Function/.test(src), `AT11 ${f}: no network, storage or HTML injection`);
  }
}

// AT12 the same files twice give identical results and an identical trail apart from times (and so fingerprints)
{
  const a = (await session()).s, b = (await session()).s;
  for (const s of [a, b]) { E.accept(s, s.view.suggestions[2].id); E.reject(s, s.view.suggestions[0].id, 'not sure'); }
  const strip = (s) => s.trail.map((l) => { const { time, prev, fingerprint, ...rest } = l; return JSON.stringify(rest); }).join('\n');
  ok(strip(a) === strip(b) && a.trail[1].time !== b.trail[1].time, 'AT12 identical trails apart from times');
  const view = (s) => JSON.stringify([...s.view.places].map(([k, p]) => [k, p.place, ruleOf(p)]));
  ok(view(a) === view(b), 'AT12 identical matches');
}

// Daniel's measure: 2,000 entries against 3,000 invoices
{
  const invoices = Array.from({ length: 3000 }, (_, i) => ({ number: `INV-${100000 + i}`, customer: `Customer ${i % 400}`, account: null, amount: BigInt(10000000 + (i % 977) * 100000), currency: 'EUR', due: '2026-11-10', reference: null }));
  const entries = Array.from({ length: 2000 }, (_, i) => ({ idx: i, line: i, ref: `R${String(i).padStart(5, '0')}`, amt: BigInt(10000000 + (i % 977) * 100000), ccy: 'EUR', cd: 'CRDT', status: 'BOOK', reversal: false, bookDate: '2026-11-17', valDate: '2026-11-17', btc: 'PMNT/RCDT/ESCT', instd: null, e2e: null, payer: 'X', payerIban: null, ustrd: [i % 3 ? `INV-${100000 + i}` : 'payment'], strdRefs: [], addtl: null, txCount: 1 }));
  const t0 = Date.now();
  const s = E.createSession({ stmt: { id: 'perf', entries, ccy: 'EUR' }, invoices, inputs: {}, clock: () => 't' });
  const ms = Date.now() - t0;
  console.log(`Measured: 2,000 entries against 3,000 invoices in ${ms} ms (${s.view.counts.auto} auto-matched).`);
  ok(ms < 10000 && s.view.totals.ok, 'large statement reconciles and totals add up', ms);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

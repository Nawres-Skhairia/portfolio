// MT to MX Migration Lab: automatic proof of Olivia's acceptance tests (PORT-41) at engine level.
// Run: npm i --no-save xmllint-wasm@5.3.0 && node tests/mt-to-mx.test.mjs
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { validateXML } = require(process.env.XMLLINT_WASM || 'xmllint-wasm');
const base = new URL('../projects/payment-xml-lab/', import.meta.url);
const { convert, MAP_RULES, MAP_SOURCES, guessAddress, REJECTED, REJECTED_LINE, REJECTING_RULES } = await import(new URL('js/mt-map.js', base));
const { MT_SAMPLES, NATIVE_PACS008 } = await import(new URL('js/mt-samples.js', base));
const { reverseCheck, toX } = await import(new URL('js/mt-reverse.js', base));
const { mapJson, mapJUnit, mapCsv, mapHtml } = await import(new URL('js/mt-reports.js', base));
const xsd = readFileSync(new URL('schemas/pacs.008.001.08.xsd', base), 'utf8');
const valid = async (xml) => { const r = await validateXML({ xml: [{ fileName: 'p.xml', contents: xml }], schema: [{ fileName: 'x.xsd', contents: xsd }], modifyArguments: (a) => a.concat(['--nonet']) }); return r.valid ? true : r.errors.map((e) => e.rawMessage).join(' | '); };

let failed = 0, passed = 0;
const ok = (cond, name, detail) => { if (cond) passed++; else { failed++; console.log('FAIL', name, detail ? '\n   ' + detail : ''); } };
const S = Object.fromEntries(MT_SAMPLES.map((s) => [s.id, s.text]));

// AT1 sample 2: three review points (two addresses, field 72), no errors, schema-valid
{
  const r = convert(S.address);
  const rev = r.findings.filter((f) => f.severity === 'review').map((f) => f.rule).join(' ');
  ok(rev === 'MAP-50 MAP-50 MAP-72' && r.errors.length === 0, 'AT1 sample 2 findings', rev);
  ok(r.rows.some((x) => x.rule === 'MAP-50' && /town "LYON" and country "FR"/.test(x.note)), 'AT1 Lyon/FR found');
  ok(r.rows.some((x) => x.rule === 'MAP-02' && x.status === 'defaulted' && x.value === 'NOTPROVIDED'), 'AT1 MAP-02 defaulted');
  ok((await valid(r.xml)) === true, 'AT1 sample 2 schema-valid');
}
// AT2 sample 1 clean
{
  const r = convert(S.clean);
  ok(r.verdict === 'Clean' && r.counts.lost === 0 && r.counts.review === 0, 'AT2 sample 1 clean', JSON.stringify(r.counts));
  ok((await valid(r.xml)) === true, 'AT2 schema-valid');
}
// AT3 every MT field and block-3 tag has a row; every sample is schema-valid
for (const s of MT_SAMPLES) {
  const r = convert(s.text);
  const missing = r.mt.fields.filter((f) => !r.rows.some((x) => x.tag === f.tag && x.mtLines.some((l) => f.lineNos.includes(l))));
  ok(!missing.length, `AT3 ${s.id} every field has a row`, missing.map((f) => f.tag).join(' '));
  const b3 = r.mt.blocks.b3.filter((b) => !r.rows.some((x) => x.tag === b.tag));
  ok(!b3.length, `AT3 ${s.id} every block 3 tag has a row`);
  ok((await valid(r.xml)) === true, `AT3 ${s.id} schema-valid`, await valid(r.xml));
}
// AT4 no UETR: error, nothing invented
{
  const r = convert(S['no-uetr']);
  ok(r.errors.some((e) => e.rule === 'MAP-03') && !/<UETR>/.test(r.xml), 'AT4 missing UETR is an error and none is invented');
}
// AT5 broken MT
{
  const r = convert(S.broken);
  const lines = r.errors.map((e) => e.mtLine);
  ok(lines.includes(3) && lines.includes(5) && r.verdict !== 'Clean', 'AT5 wrong 32A (line 5) and unknown tag (line 3) marked', JSON.stringify(r.errors.map((e) => [e.mtLine, e.message])));
}
// AT6 charges
{
  const sha = convert(S.charges), our = convert(S.our);
  ok(/<ChrgBr>SHAR<\/ChrgBr>/.test(sha.xml) && /<ChrgBr>DEBT<\/ChrgBr>/.test(our.xml), 'AT6 SHA to SHAR, OUR to DEBT');
  const ben = convert(S.charges.replace(':71A:SHA', ':71A:BEN'));
  ok(/<ChrgBr>CRED<\/ChrgBr>/.test(ben.xml), 'AT6 BEN to CRED');
  ok(/<Amt Ccy="EUR">2.50<\/Amt>/.test(sha.xml) && /<Amt Ccy="EUR">5.00<\/Amt>/.test(sha.xml) && /<Amt Ccy="EUR">15.00<\/Amt>/.test(our.xml), 'AT6 71F and 71G amounts reach ChrgsInf unchanged');
  ok(convert(S.our.replace(':71G:EUR15,00', ':71F:EUR15,00')).errors.some((e) => e.rule === 'MAP-61'), 'AT6 OUR with 71F is flagged');
  ok(convert(S.charges.replace(':71A:SHA\n:71F:EUR2,50\n:71F:EUR5,00', ':71A:BEN')).errors.some((e) => e.rule === 'MAP-61'), 'AT6 BEN without 71F is flagged');
}
// AT7 reverse check on the native pacs.008 (180-character remittance)
{
  ok((await valid(NATIVE_PACS008)) === true, 'AT7 native sample is schema-valid');
  const rv = reverseCheck(NATIVE_PACS008);
  const rem = rv.rows.find((x) => x.element === 'RmtInf/Ustrd');
  ok(rem && rem.cut && rem.after.split('\n').length === 4 && rem.after.split('\n').every((l) => l.length <= 35) && /\(18\d characters\)/.test(rem.before), 'AT7 remittance cut to 4 x 35 with before and after', rem && rem.before);
  ok(toX('Große Négoce & Co') === 'Grosse Negoce + Co', 'AT7 character set conversion');
}
// AT11 repeatable
{
  ok(MT_SAMPLES.every((s) => convert(s.text).xml === convert(s.text).xml), 'AT11 same input gives byte-identical XML');
}
// AT9 exports carry versions and SHA-256
{
  const r = convert(S.address); const ctx = { res: r, schema: { valid: true, errors: [] }, sha: 'abc123', name: 'sample 2', when: '2026-11-18T10:00:00.000Z' };
  const j = JSON.parse(mapJson(ctx));
  ok(j.toolVersion && j.catalogue && j.sha256 === 'abc123', 'AT9 JSON metadata');
  ok(/mtSha256" value="abc123"/.test(mapJUnit(ctx)) && /catalogue 2026/.test(mapCsv(ctx)) && /abc123/.test(mapHtml(ctx)), 'AT9 JUnit, CSV and HTML metadata');
  ok(!/<script/i.test(mapHtml(ctx)), 'AT9 HTML report has no script');
}
// AT12 every rule names a source or says it is our documented choice
ok(MAP_RULES.every((r) => r.source.length && r.source.every((s) => MAP_SOURCES[s])), 'AT12 every rule has a source or "our documented choice"');
// Daniel: block addresses, group header, EndToEndId, 13C/26T/55A rows, free-text address error
{
  const r = convert(S.clean);
  ok(/<InstgAgt>\s*<FinInstnId>\s*<BICFI>XMPLDEFFXXX/.test(r.xml) && /<InstdAgt>\s*<FinInstnId>\s*<BICFI>XMPLFRPPXXX/.test(r.xml), 'Block 1/2 BIC = chars 1-8 + 10-12');
  ok(/<MsgId>XMPL2611180001<\/MsgId>/.test(r.xml) && /<CreDtTm>2026-11-18T00:00:00<\/CreDtTm>/.test(r.xml) && /<SttlmMtd>INDA<\/SttlmMtd>/.test(r.xml), 'Group header MsgId, CreDtTm from value date, INDA');
  const cov = convert(S.clean.replace(':50F:', ':53A:XMPLBEBBXXX\n:50F:'));
  ok(/<SttlmMtd>COVE<\/SttlmMtd>/.test(cov.xml) && (await valid(cov.xml)) === true, 'COVE with 53A');
  const extra = convert(S.clean.replace(':23B:CRED', ':13C:/CLSTIME/0915+0100\n:23B:CRED\n:26T:K90').replace(':70:', ':55A:XMPLITMMXXX\n:70:'));
  ok(['13C', '26T', '55A'].every((t) => extra.rows.some((x) => x.tag === t && x.status !== 'lost')), '13C, 26T, 55A have real targets');
  ok((await valid(extra.xml)) === true, '13C, 26T, 55A output schema-valid', await valid(extra.xml));
  const free = convert(S.address.replace('3511 AB UTRECHT\nNL', 'SOMEWHERE IN TOWN'));
  ok(free.errors.some((e) => e.rule === 'MAP-50'), 'Free-text address without town and country is an error');
  ok(guessAddress(['12 RUE DE L EXEMPLE', '69002 LYON', 'FR']).town === 'LYON', 'Address guess: postcode and town');
  ok(guessAddress(['VOORBEELDSTRAAT 12', '3511 AB UTRECHT', 'NL']).pc === '3511 AB', 'Address guess: Dutch postcode');
  ok(convert(S.clean.replace('EUR1250,00', 'JPY1250,50')).errors.some((e) => e.rule === 'MAP-10'), 'Decimals checked against the currency');
  ok(convert(S.charges.replace(':33B:EUR', ':33B:USD')).errors.some((e) => e.rule === 'MAP-11'), '33B in another currency needs 36');
  const esc = convert(S.clean.replace('INVOICE 2026-118', "O'NEIL + SONS"));
  ok(/O'NEIL \+ SONS/.test(esc.xml) && (await valid(esc.xml)) === true, 'Text is escaped and stays valid');
  { const c = convert(S.clean.replace('INVOICE 2026-118', 'INVOICE\u0000 2026-118')); ok(c.refused && c.errors.length === 1 && /control character/.test(c.errors[0].message), 'Control characters refused up front (Noah)'); }
  ok(convert('x'.repeat(10001)).errors.length === 1 && convert('').errors.length === 1, 'Too long or empty input is refused');
}
// Mia's test round (PORT-41)
{
  const ga = (l) => { const g = guessAddress(l); return g ? [g.pc, g.town, g.sub, g.ctry].join('|') : null; };
  ok(ga(['10 EXAMPLE ROAD', 'LONDON SW1A 1AA', 'GB']) === 'SW1A 1AA|LONDON||GB', 'Mia 1 UK town then postcode', ga(['10 EXAMPLE ROAD', 'LONDON SW1A 1AA', 'GB']));
  ok(ga(['1 EXAMPLE AVENUE', 'NEW YORK NY 10001', 'US']) === '10001|NEW YORK|NY|US', 'Mia 1 US town, state, ZIP', ga(['1 EXAMPLE AVENUE', 'NEW YORK NY 10001', 'US']));
  ok(ga(['12 RUE DE L EXEMPLE', '69002 LYON FRANCE']) === '69002|LYON||FR', 'Mia 1 country name at the end of the town line', ga(['12 RUE DE L EXEMPLE', '69002 LYON FRANCE']));
  ok(ga(['12 RUE DE L EXEMPLE', 'LYON, FR']) === '|LYON||FR', 'Country code after the town', ga(['12 RUE DE L EXEMPLE', 'LYON, FR']));
  ok(ga(['BEISPIELSTRASSE 12', 'DE']) === null, 'A street with a house number is not taken as a town');
  ok(ga(['NOWHERE IN PARTICULAR']) === null, 'No town and country still gives nothing');
  const us = convert(S.address.replace('12 RUE DE L EXEMPLE\n69002 LYON\nFRANCE', '1 EXAMPLE AVENUE\nNEW YORK NY 10001\nUS'));
  ok(!us.errors.some((e) => e.rule === 'MAP-50') && (await valid(us.xml)) === true, 'Mia 1 US address converts and is schema-valid', await valid(us.xml));
  const rep = convert(S.clean.replace(':23B:CRED', ':13C:/CLSTIME/0915+0100\n:13C:/SNDTIME/0800+0100\n:23B:CRED\n:23E:PHOB\n:23E:SDVA'));
  ok(!rep.errors.some((e) => /appears twice/.test(e.message)), 'Mia 2 13C and 23E may repeat');
  ok((await valid(rep.xml)) === true, 'Mia 2 repeated 13C/23E output schema-valid', await valid(rep.xml));
  ok(convert(S.charges.replace(':33B:EUR1250,00', ':33B:EUR1250,00\n:36:1,0')).errors.some((e) => e.rule === 'MAP-11'), 'Mia 3 :36: with the same currency is refused');
  ok(convert(S.clean.replace(':50F:', ':36:1,0\n:50F:')).errors.some((e) => e.rule === 'MAP-11'), 'Mia 3 :36: without :33B: is refused');
  ok(!convert(S.charges.replace(':33B:EUR1250,00', ':33B:USD1350,00\n:36:0,925925')).errors.some((e) => e.rule === 'MAP-11'), 'Mia 3 :36: with another currency is fine');
  const r = convert(S.clean.replace('INVOICE 2026-118', '=HYPERLINK(1)')); const csv = mapCsv({ res: r, schema: { valid: true }, sha: 'x', name: 'n', when: '2026-11-18T10:00:00Z' });
  ok(csv.includes("'=HYPERLINK(1)") && !/(^|,)=HYPERLINK/m.test(csv), 'Mia 4 CSV formula guard');
  { const { csvCellForTest: c } = await import(new URL('js/mt-reports.js', base));
    for (const ch of ['=', '+', '-', '@', '\t', '\r', '\uFF1D', '\uFF0B', '\uFF0D', '\uFF20']) ok(c(ch + '1+1').replace(/^"/, '').startsWith("'" + ch), 'CSV guard for ' + JSON.stringify(ch));
    ok(c('a\rb') === '"a\rb"', 'CSV cell with a CR in the middle is quoted'); }
  const c1 = convert(S.clean.replace('INVOICE 2026-118', 'INVOICE\u0001 2026-118'));
  ok(c1.refused && c1.xml === '', 'Mia 5 U+0001 is refused, so no broken pacs.008 can be downloaded');
  ok(convert(S.clean.replace('INVOICE', 'INV\uD800OICE')).refused, 'A lone surrogate is refused');
  const b4 = convert(S.clean.slice(S.clean.indexOf('{4:') + 4));
  const last = b4.mt.fields[b4.mt.fields.length - 1];
  ok(last.tag === '71A' && last.value === 'SHA', 'Info: block 4 only, "-}" not joined to the last field', last.value);
  const full = convert(S.clean.replace(':70:INVOICE 2026-118', ':70:' + ['A'.repeat(35), 'B'.repeat(35), 'C'.repeat(35), 'D'.repeat(35)].join('\n')));
  ok(full.rows.some((x) => x.rule === 'MAP-60' && x.status === 'review' && /glued/.test(x.note)), 'Info: 4 full :70: lines flagged for review');
  const two = convert(S.clean.replace(':70:INVOICE 2026-118', ':70:INVOICE 2026-118\nORDER 5521'));
  ok(/<Ustrd>INVOICE 2026-118 ORDER 5521<\/Ustrd>/.test(two.xml), 'Info: :70: lines joined with a space');
  ok(/reviewPoints" value="3"/.test(mapJUnit({ res: convert(S.address), schema: { valid: true }, sha: 'x', name: 'n', when: '2026-11-18T10:00:00Z' })), 'Info: JUnit carries the number of review points');
}
// Daniel's hands-on Minors (PORT-41 10668)
{
  const today = '2026-11-17';
  const base0 = convert(S.clean, { today });
  const rev = (r) => r.findings.filter((f) => f.severity === 'review');
  ok(rev(base0).length === 0, 'clean sample: no review point for today');
  const badIban = convert(S.clean.replace(':59F:/FR1420041010050500013M02606', ':59F:/FR1520041010050500013M02606'), { today });
  ok(rev(badIban).some((f) => /looks like an IBAN, but its check digits are wrong/.test(f.message)) && !/<IBAN>FR15/.test(badIban.xml), 'IBAN-like account with bad check digits: needs review, not written as IBAN');
  const notIban = convert(S.clean.replace(':59F:/FR1420041010050500013M02606', ':59F:/123456789'), { today });
  ok(!rev(notIban).some((f) => /check digits/.test(f.message)), 'a plain account number is not called a bad IBAN');
  const far = convert(S.clean.replace(':32A:261118EUR1250,00', ':32A:991231EUR1250,00'), { today });
  ok(rev(far).some((f) => /2099-12-31, which is more than a year ahead/.test(f.message)), 'value date 991231: needs review', JSON.stringify(rev(far).map((f) => f.message)));
  ok(!rev(convert(S.clean.replace(':32A:261118', ':32A:271110'), { today })).length, 'value date within a year: no review point');
  const zero = convert(S.clean.replace(':32A:261118EUR1250,00', ':32A:261118EUR0,00'), { today });
  ok(rev(zero).some((f) => /amount is zero/.test(f.message)), 'amount 0,00: needs review');
}
// AT5 v1.1 (Olivia, PORT-41 10682): three levels; an Error gives "Would be rejected", never "SWIFT rejects"
{
  const v = (id) => convert(S[id]).verdict;
  ok(v('broken') === REJECTED && v('no-uetr') === REJECTED, 'AT5 v1.1 broken MT and missing UETR: Would be rejected', v('broken') + ' / ' + v('no-uetr'));
  ok(v('clean') === 'Clean' && v('address') === 'Needs review', 'AT5 v1.1 clean stays Clean, guesses stay Needs review');
  const broken = convert(S.broken);
  ok(broken.findings.filter((f) => f.severity === 'error').every((f) => f.rule), 'AT5 v1.1 findings keep Error severity and rule ID');
  ok(REJECTED_LINE === 'This MT breaks a basic format rule (listed below). A bank would refuse it before any conversion. The pacs.008 below is shown for learning only.', 'AT5 v1.1 exact line under the chip');
  const src = readFileSync(new URL('js/mt-map.js', base), 'utf8');
  const used = new Set([...src.matchAll(/fail\('(MAP-\d+)'/g)].map((m) => m[1]));
  ok([...used].every((id) => REJECTING_RULES.includes(id)) && REJECTING_RULES.every((id) => id === 'MT' || MAP_RULES.some((r) => r.id === id)), 'catalogue names every rule that can give the red status', [...used].join(','));
  ok(mapHtml({ res: convert(S.broken), schema: { valid: true }, sha: 'x', name: 'n', when: '2026-11-17T10:00:00Z' }).includes('A bank would refuse it before any conversion.'), 'HTML report carries the red line');
  ok(JSON.parse(mapJson({ res: convert(S.broken), schema: { valid: true }, sha: 'x', name: 'n', when: '2026-11-17T10:00:00Z' })).verdictLine === REJECTED_LINE && !('verdictLine' in JSON.parse(mapJson({ res: convert(S.clean), schema: { valid: true }, sha: 'x', name: 'n', when: 't' }))), 'JSON export carries the red line only when rejected (Mia)');
  ok((readFileSync(new URL('mt-to-mx/index.html', base), 'utf8').match(/class="table-wrap" tabindex="0" role="region"/g) || []).length === 3, 'scrolling tables reachable by keyboard (Mia)');
  const page = readFileSync(new URL('mt-to-mx/index.html', base), 'utf8') + readFileSync(new URL('js/mt-app.js', base), 'utf8');
  ok(/id="learnBand"/.test(page) && /For learning only/.test(page) && !/SWIFT rejects/i.test(page + src), 'grey band present; never "SWIFT rejects"');
}
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

// Payment XML Lab: automatic proof (PORT-40). Every factory scenario must give exactly its own finding at the
// line written in the file's top comment; valid files must give none; the sample must give its 5 planned findings.
// Run: npm i --no-save xmllint-wasm@5.3.0 && node tests/payment-xml-lab.test.mjs
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { validateXML } = require(process.env.XMLLINT_WASM || 'xmllint-wasm');
const base = new URL('../projects/payment-xml-lab/', import.meta.url);
const { check, detect } = await import(new URL('js/engine.js', base));
const detectNs = (s) => detect(s).id;
const { generate, SCENARIOS, sample } = await import(new URL('js/factory.js', base));
const xsd = readFileSync(new URL('schemas/pain.001.001.09.xsd', base), 'utf8');

const validateSchema = async (xml) => {
  const r = await validateXML({ xml: [{ fileName: 'payment.xml', contents: xml }], schema: [{ fileName: 'pain.001.001.09.xsd', contents: xsd }], modifyArguments: (a) => a.concat(['--nonet']), maxMemoryPages: 4096 });
  return { valid: r.valid, errors: r.errors.map((e) => ({ line: e.loc ? e.loc.lineNumber : null, raw: e.rawMessage, message: e.rawMessage.replace(/^payment\.xml:\d+:\s*/, '') })) };
};
const procDate = '2026-11-16';
let failed = 0, passed = 0;
const ok = (cond, name, detail) => { if (cond) passed++; else { failed++; console.log('FAIL', name, detail ? '\n   ' + detail : ''); } };
const ids = (r) => r.findings.map((f) => (f.layer === 'xsd' ? 'XSD' : f.layer === 'xml' ? 'XML' : f.id) + '@' + f.line);

// AT1 sample
{
  const r = await check(sample(procDate), { procDate, validateSchema });
  const got = r.findings.map((f) => f.layer === 'xsd' ? 'XSD:' + f.element : f.id);
  ok(JSON.stringify(got) === JSON.stringify(['XSD:CreDtTm', 'SCT-03', 'SCT-08', 'SCT-05', 'SCT-14']), 'AT1 sample findings', got.join(', ') + ' | ' + ids(r).join(' '));
  ok(r.verdict === 'Rejected', 'AT1 verdict', r.verdictLine);
}
// AT2 valid files
for (const count of [1, 100, 10000]) {
  const t = Date.now();
  const g = generate({ scenario: 'valid', count, procDate });
  const r = await check(g.xml, { procDate, validateSchema });
  ok(r.findings.length === 0 && r.verdict === 'Accepted', `AT2 valid ${count}`, ids(r).join(' '));
  if (count === 10000) console.log(`   10,000 payments: ${(g.xml.length / 1048576).toFixed(1)} MB, checked in ${Date.now() - t} ms`);
}
// Size limit: a file just under 10 MB must be checked in full within the engine limits (256 MB memory)
{
  let n = 21000, g = generate({ scenario: 'valid', count: n, procDate });
  while (Buffer.byteLength(g.xml) > 10 * 1024 * 1024) { n -= 500; g = generate({ scenario: 'valid', count: n, procDate }); }
  const t = Date.now(); const r = await check(g.xml, { bytes: Buffer.byteLength(g.xml), procDate, validateSchema });
  ok(r.verdict === 'Accepted' && r.summary.payments === n, `10 MB file (${n} payments, ${(Buffer.byteLength(g.xml) / 1048576).toFixed(1)} MB)`, r.verdictLine);
  console.log(`   ${n} payments, ${(Buffer.byteLength(g.xml) / 1048576).toFixed(1)} MB, checked in ${Date.now() - t} ms`);
  const big = g.xml + ' '.repeat(10 * 1024 * 1024 - Buffer.byteLength(g.xml) + 1);
  ok((await check(big, { bytes: Buffer.byteLength(big), procDate, validateSchema })).status === 'refused', 'Over 10 MB refused');
}
// Mia's cases (PORT-40 comment 10591)
{
  const v = generate({ scenario: 'valid', count: 3, procDate }).xml;
  const xsiFirst = v.replace('<Document xmlns=', '<Document xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns=');
  const r1 = await check(xsiFirst, { procDate, validateSchema });
  ok(r1.status === 'checked' && r1.verdict === 'Accepted', 'xmlns:xsi before xmlns is still pain.001.001.09', r1.verdictLine);
  const pref = v.replace('<Document xmlns=', '<p:Document xmlns:p=').replace('</Document>', '</p:Document>');
  ok(detectNs(pref) === 'pain.001.001.09', 'prefixed root detected');
  const cmt = v.replace('<Document', '<!-- an old note: <!DOCTYPE was removed -->\n<Document');
  const r2 = await check(cmt, { procDate, validateSchema });
  ok(r2.status === 'checked', 'DOCTYPE inside a comment is not refused', r2.reason);
  const open = v.replace('<Document', '<!-- unterminated <!DOCTYPE d [<!ENTITY x "y">]>\n<Document');
  ok((await check(open, { procDate, validateSchema })).status === 'refused', 'DOCTYPE after an unterminated comment is refused');
  const ly = v.replace('IE29AIBK93115212345678', 'LY83002048000020100120361').replace(/<IBAN>[A-Z]{2}\d{2}\w+<\/IBAN>/, (x) => x);
  const r3 = await check(v.replace(/(<CdtrAcct>\s*<Id><IBAN>)[^<]+/, '$1LY83002048000020100120361'), { procDate, validateSchema });
  ok(!r3.findings.some((f) => f.id === 'SCT-05'), 'valid Libyan IBAN (25) accepted', ids(r3).join(' '));
  const r4 = await check(v.replace(/(<CdtrAcct>\s*<Id><IBAN>)[^<]+/, '$1RU0204452560040702810412345678901'), { procDate, validateSchema });
  ok(!r4.findings.some((f) => f.id === 'SCT-05'), 'valid Russian IBAN (33) accepted', ids(r4).join(' '));
  const xi = v.replace('</CdtrAcct>', '</CdtrAcct>\n        <xi:include xmlns:xi="http://www.w3.org/2001/XInclude" href="x.xml"/>');
  const r5 = await check(xi, { procDate, validateSchema });
  ok(r5.findings.length === 1, 'XInclude element gives one finding', ids(r5).join(' '));
}
// AT3 / AT4 / AT6 every scenario
for (const s of SCENARIOS.filter((x) => x.expect)) {
  for (const count of [3, 25]) {
    const g = generate({ scenario: s.id, count, procDate });
    const r = await check(g.xml, { procDate, validateSchema });
    const line = Number((g.xml.match(/at line (\d+)/) || [])[1]);
    const got = ids(r);
    const want = s.expect + (s.at ? '@' + line : '');
    const good = s.expect === 'XML' ? r.status === 'not-wellformed' && r.findings.length === 1 && r.layers.xsd === 'not run' && r.layers.rules === 'not run'
      : got.length === 1 && got[0] === want;
    ok(good, `AT3 ${s.id} (${count})`, `want ${want}, got ${got.join(' ') || 'nothing'}`);
  }
}
// AT5 other messages
{
  const r1 = await check('<?xml version="1.0"?><Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03"><CstmrCdtTrfInitn/></Document>', { procDate, validateSchema });
  ok(r1.status === 'unsupported' && /pain\.001\.001\.03/.test(r1.reason), 'AT5 pain.001.001.03', r1.reason);
  const r2 = await check('<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08"><BkToCstmrStmt/></Document>', { procDate, validateSchema });
  ok(r2.status === 'unsupported' && /camt\.053/.test(r2.reason), 'AT5 camt.053', r2.reason);
  const r3 = await check('<note><to>Someone</to></note>', { procDate, validateSchema });
  ok(r3.status === 'not-iso', 'AT5 random XML', r3.reason);
}
// Safety gate
{
  const bomb = '<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;">]><Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.09">&lol2;</Document>';
  const r = await check(bomb, { procDate, validateSchema });
  ok(r.status === 'refused', 'Safety: DOCTYPE and ENTITY refused', r.reason);
  const xxe = '<?xml version="1.0"?><!DOCTYPE d [<!ENTITY x SYSTEM "file:///etc/passwd">]><Document/>';
  ok((await check(xxe, { procDate, validateSchema })).status === 'refused', 'Safety: external entity refused');
  // UTF-16LE without BOM decodes as "valid UTF-8" full of NULs: it must be refused before libxml2 sees it (Noah, PR 5)
  const u16 = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from('<?xml version="1.0" encoding="UTF-16"?><!DOCTYPE d [<!ENTITY x SYSTEM "pain.001.001.09.xsd">]><d>&x;</d>', 'utf16le'));
  ok((await check(u16, { procDate, validateSchema })).status === 'refused', 'Safety: BOM-less UTF-16LE refused');
  const ctl = (await check('<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.09">\u0001</Document>', { procDate, validateSchema }));
  ok(ctl.status === 'refused', 'Safety: control characters refused');
}
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

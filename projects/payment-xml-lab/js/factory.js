// Test-data factory: valid pain.001.001.09 SEPA files, or files broken on purpose (one defect per scenario).
// Made-up companies; only published example IBANs; made-up BICs (bank code XMPL). Never real accounts.
import { parseTree, all } from './tree.js';
import { nextBusinessDay, addDays, targetClosed } from './rules.js';

export const NS = 'urn:iso:std:iso:20022:tech:xsd:pain.001.001.09';

// Published example IBANs (from IBAN documentation and registries) with made-up BICs
const ACCOUNTS = [
  { iban: 'DE89370400440532013000', bic: 'XMPLDEFFXXX' },
  { iban: 'FR1420041010050500013M02606', bic: 'XMPLFRPPXXX' },
  { iban: 'BE68539007547034', bic: 'XMPLBEBBXXX' },
  { iban: 'AT611904300234573201', bic: 'XMPLATWWXXX' },
  { iban: 'ES9121000418450200051332', bic: 'XMPLESMMXXX' },
  { iban: 'IT60X0542811101000000123456', bic: 'XMPLITMMXXX' },
  { iban: 'IE29AIBK93115212345678', bic: 'XMPLIE2DXXX' },
  { iban: 'LU280019400644750000', bic: 'XMPLLULLXXX' },
  { iban: 'FI2112345600000785', bic: 'XMPLFIHHXXX' },
  { iban: 'PT50000201231234567890154', bic: 'XMPLPTPLXXX' },
];
const DEBTOR = { name: 'Lumen Example Trading BV', iban: 'NL91ABNA0417164300', bic: 'XMPLNL2AXXX', addr: { StrtNm: 'Voorbeeldstraat', BldgNb: '12', PstCd: '3511 AB', TwnNm: 'Utrecht', Ctry: 'NL' } };
const CREDITORS = ['Alder Example Studio', 'Birch Example Logistics', 'Cedar Example Foods', 'Dune Example Print', 'Elm Example Repairs',
  'Fjord Example Travel', 'Grove Example Office Supplies', 'Harbor Example Cleaning', 'Iris Example Design', 'Juniper Example Tech'];
const PURPOSES = ['Invoice', 'Order', 'Contract', 'Service', 'Rent'];

// seeded random numbers, so the same seed always gives the same file
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// a postal address on one line: structured fields in schema order, then address lines
const adrXml = (a) => !a ? '' : '<PstlAdr>' + ['StrtNm', 'BldgNb', 'PstCd', 'TwnNm', 'Ctry'].filter((k) => a[k]).map((k) => `<${k}>${esc(a[k])}</${k}>`).join('')
  + (a.lines || []).map((l) => `<AdrLine>${esc(l)}</AdrLine>`).join('') + '</PstlAdr>';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function makeModel({ count = 3, seed = 2026, execDate, created }) {
  const r = rng(seed);
  const txs = [];
  for (let i = 0; i < count; i++) {
    const k = Math.floor(r() * ACCOUNTS.length);
    const cents = 1000 + Math.floor(r() * 499000); // 10.00 .. 5,000.00
    txs.push({
      e2e: 'E2E-' + String(seed % 10000).padStart(4, '0') + '-' + String(i + 1).padStart(5, '0'),
      amount: (cents / 100).toFixed(2), ccy: 'EUR',
      cdtr: { name: CREDITORS[k], iban: ACCOUNTS[k].iban, bic: ACCOUNTS[k].bic },
      ustrd: [PURPOSES[i % PURPOSES.length] + ' ' + (1000 + Math.floor(r() * 9000))], strd: false,
    });
  }
  return {
    msgId: 'PXL-' + execDate.replace(/-/g, '') + '-' + seed,
    created: created || execDate + 'T09:00:00',
    initg: DEBTOR.name,
    batches: [{ id: 'BATCH-' + seed + '-1', method: 'TRF', svc: 'SEPA', execDate, chrgBr: 'SLEV', dbtr: { ...DEBTOR, addr: { ...DEBTOR.addr } }, txs }],
    header: {}, // optional overrides of NbOfTxs / CtrlSum written in the file
  };
}

function sumStr(txsIn) { // exact, as text with the decimals actually used (amounts that are not numbers are skipped)
  const txs = txsIn.filter((t) => /^\d+(\.\d+)?$/.test(t.amount));
  let scale = 2; for (const t of txs) { const f = (t.amount.split('.')[1] || '').length; if (f > scale) scale = f; }
  let s = 0n; for (const t of txs) { const [i, f = ''] = t.amount.split('.'); s += BigInt(i + f.padEnd(scale, '0')); }
  const str = s.toString().padStart(scale + 1, '0');
  return str.slice(0, -scale) + '.' + str.slice(-scale);
}

export function toXml(m, comment) {
  const all = m.batches.flatMap((b) => b.txs);
  const L = [];
  L.push('<?xml version="1.0" encoding="UTF-8"?>');
  if (comment) L.push('<!-- ' + comment + ' -->');
  L.push(`<Document xmlns="${NS}">`);
  L.push('  <CstmrCdtTrfInitn>');
  L.push('    <GrpHdr>');
  if (!m.omitMsgId) L.push(`      <MsgId>${esc(m.msgId)}</MsgId>`);
  L.push(`      <CreDtTm>${esc(m.created)}</CreDtTm>`);
  L.push(`      <NbOfTxs>${m.header.nb ?? all.length}</NbOfTxs>`);
  if (m.header.sum !== false) L.push(`      <CtrlSum>${m.header.sum ?? sumStr(all)}</CtrlSum>`);
  L.push(`      <InitgPty><Nm>${esc(m.initg)}</Nm></InitgPty>`);
  L.push('    </GrpHdr>');
  for (const b of m.batches) {
    L.push('    <PmtInf>');
    L.push(`      <PmtInfId>${esc(b.id)}</PmtInfId>`);
    L.push(`      <PmtMtd>${b.method}</PmtMtd>`);
    L.push(`      <NbOfTxs>${b.nb ?? b.txs.length}</NbOfTxs>`);
    L.push(`      <CtrlSum>${b.sum ?? sumStr(b.txs)}</CtrlSum>`);
    if (b.svc) L.push(`      <PmtTpInf><SvcLvl><Cd>${b.svc}</Cd></SvcLvl></PmtTpInf>`);
    L.push(`      <ReqdExctnDt><Dt>${b.execDate}</Dt></ReqdExctnDt>`);
    L.push(b.dbtr.name == null ? '      <Dbtr/>' : `      <Dbtr><Nm>${esc(b.dbtr.name)}</Nm>${adrXml(b.dbtr.addr)}</Dbtr>`);
    L.push(`      <DbtrAcct><Id><IBAN>${b.dbtr.iban}</IBAN></Id></DbtrAcct>`);
    L.push(`      <DbtrAgt><FinInstnId><BICFI>${b.dbtr.bic}</BICFI></FinInstnId></DbtrAgt>`);
    if (b.chrgBr) L.push(`      <ChrgBr>${b.chrgBr}</ChrgBr>`);
    for (const t of b.txs) {
      L.push('      <CdtTrfTxInf>');
      L.push(`        <PmtId><EndToEndId>${esc(t.e2e)}</EndToEndId></PmtId>`);
      L.push('        <Amt>');
      L.push(`          <InstdAmt Ccy="${esc(t.ccy)}">${esc(t.amount)}</InstdAmt>`);
      L.push('        </Amt>');
      const agt = `        <CdtrAgt><FinInstnId><BICFI>${esc(t.cdtr.bic)}</BICFI></FinInstnId></CdtrAgt>`;
      const cdtr = t.cdtr.name == null ? '        <Cdtr/>' : `        <Cdtr><Nm>${esc(t.cdtr.name)}</Nm>${adrXml(t.cdtr.addr)}</Cdtr>`;
      if (t.swapAgent) L.push(cdtr, agt); else L.push(agt, cdtr);
      L.push('        <CdtrAcct>');
      L.push(`          <Id><IBAN>${esc(t.cdtr.iban)}</IBAN></Id>`);
      L.push('        </CdtrAcct>');
      if (t.extra) L.push('        ' + t.extra);
      if (t.ustrd.length || t.strd) {
        L.push('        <RmtInf>');
        for (const u of t.ustrd) L.push(`          <Ustrd>${esc(u)}</Ustrd>`);
        for (let k = 0; k < (t.strd === true ? 1 : t.strd || 0); k++) L.push('          <Strd><CdtrRefInf><Tp><CdOrPrtry><Cd>SCOR</Cd></CdOrPrtry></Tp><Ref>RF18539007547034</Ref></CdtrRefInf></Strd>');
        L.push('        </RmtInf>');
      }
      L.push('      </CdtTrfTxInf>');
    }
    L.push('    </PmtInf>');
  }
  L.push('  </CstmrCdtTrfInitn>');
  L.push('</Document>');
  return L.join('\n') + '\n';
}

function prevBusinessDay(iso) { let d = addDays(iso, -1); while (targetClosed(d)) d = addDays(d, -1); return d; }
function nextSaturday(iso) { let d = addDays(iso, 1); while (new Date(d + 'T00:00:00Z').getUTCDay() !== 6) d = addDays(d, 1); return d; }
const tx = (m, i = 0) => m.batches[0].txs[Math.min(i, m.batches[0].txs.length - 1)];

// Each scenario: what it breaks, the finding it must give (and only that one), and where.
// expect: rule id, or 'XSD' for a schema error, or 'XML' for a file that is not well-formed.
export const SCENARIOS = [
  { id: 'valid', label: 'Valid file', expect: null },
  // layer 3: SEPA rules
  { id: 'header-count', label: 'Header count wrong', expect: 'SCT-01', at: ['NbOfTxs', 0], apply: (m) => { m.header.nb = m.batches[0].txs.length + 1; } },
  { id: 'batch-count', label: 'Batch count wrong', expect: 'SCT-02', at: ['NbOfTxs', 1], apply: (m) => { m.batches[0].nb = m.batches[0].txs.length + 2; } },
  { id: 'header-sum', label: 'Header control sum wrong', expect: 'SCT-03', at: ['CtrlSum', 0], apply: (m) => { m.header.sum = bump(m.batches[0].txs); } },
  { id: 'header-no-sum', label: 'Header control sum missing', expect: 'SCT-03', at: ['NbOfTxs', 0], apply: (m) => { m.header.sum = false; } },
  { id: 'batch-sum', label: 'Batch control sum wrong', expect: 'SCT-04', at: ['CtrlSum', 1], apply: (m) => { m.batches[0].sum = bump(m.batches[0].txs); } },
  { id: 'iban-checksum', label: 'IBAN with a wrong digit', expect: 'SCT-05', at: ['IBAN', 1], apply: (m) => { tx(m).cdtr = { ...tx(m).cdtr, iban: 'DE89370400440532013001' }; } },
  { id: 'iban-length', label: 'IBAN too short for its country', expect: 'SCT-05', at: ['IBAN', 1], apply: (m) => { tx(m).cdtr = { ...tx(m).cdtr, iban: 'DE8937040044053201300' }; } },
  { id: 'bic-country', label: 'BIC with no real country', expect: 'SCT-06', at: ['BICFI', 1], apply: (m) => { tx(m).cdtr = { ...tx(m).cdtr, bic: 'XMPLQQFFXXX' }; } },
  { id: 'currency', label: 'Currency not EUR', expect: 'SCT-07', at: ['InstdAmt', 0], apply: (m) => { tx(m).ccy = 'USD'; } },
  { id: 'amount-decimals', label: 'Amount with 3 decimals', expect: 'SCT-08', at: ['InstdAmt', 0], apply: (m) => { tx(m).amount = '150.255'; } },
  { id: 'amount-zero', label: 'Amount of 0.00', expect: 'SCT-08', at: ['InstdAmt', 0], apply: (m) => { tx(m).amount = '0.00'; } },
  { id: 'method', label: 'Payment method not TRF', expect: 'SCT-09', at: ['PmtMtd', 0], apply: (m) => { m.batches[0].method = 'CHK'; } },
  { id: 'no-sepa', label: 'No service level (warning)', expect: 'SCT-09', sev: 'warning', at: ['PmtInfId', 0], apply: (m) => { m.batches[0].svc = null; } },
  { id: 'charges', label: 'Charge bearer not SLEV', expect: 'SCT-10', at: ['ChrgBr', 0], apply: (m) => { m.batches[0].chrgBr = 'DEBT'; } },
  { id: 'date-past', label: 'Execution date in the past', expect: 'SCT-11', at: ['Dt', 0], apply: (m, o) => { m.batches[0].execDate = prevBusinessDay(addDays(o.procDate, -6)); } },
  { id: 'reference-slash', label: 'Reference with "//"', expect: 'SCT-12', at: ['EndToEndId', 0], apply: (m) => { tx(m).e2e = 'E2E//0001'; } },
  { id: 'name-length', label: 'Creditor name over 70 characters', expect: 'SCT-13', at: ['Nm', 2], apply: (m) => { tx(m).cdtr = { ...tx(m).cdtr, name: 'Alder Example Studio for Architecture Interior Design and Urban Planning Services' }; } },
  { id: 'charset', label: 'Accent and "&" in the text', expect: 'SCT-14', at: ['Ustrd', 0], apply: (m) => { tx(m).ustrd = ['Facture 42 Café & Co']; } },
  { id: 'duplicate-e2e', label: 'Same EndToEndId twice', expect: 'SCT-15', at: ['EndToEndId', 1], min: 2, apply: (m) => { tx(m, 1).e2e = tx(m, 0).e2e; } },
  { id: 'remittance-both', label: 'Structured and unstructured remittance', expect: 'SCT-16', at: ['Strd', 0], apply: (m) => { tx(m).strd = true; } },
  { id: 'strd-twice', label: 'Two structured remittance blocks', expect: 'SCT-16', at: ['Strd', 1], apply: (m) => { tx(m).ustrd = []; tx(m).strd = 2; } },
  { id: 'date-closed', label: 'Execution date on a Saturday', expect: 'SCT-17', at: ['Dt', 0], apply: (m, o) => { m.batches[0].execDate = nextSaturday(o.procDate); } },
  { id: 'creditor-name', label: 'Creditor without a name', expect: 'SCT-18', at: ['Cdtr', 0], apply: (m) => { tx(m).cdtr = { ...tx(m).cdtr, name: null }; } },
  { id: 'debtor-name', label: 'Debtor without a name', expect: 'SCT-18', at: ['Dbtr', 0], apply: (m) => { m.batches[0].dbtr.name = null; } },
  { id: 'duplicate-batch', label: 'Same batch ID twice', expect: 'SCT-19', at: ['PmtInfId', 1], min: 2, apply: (m) => {
    const b = m.batches[0]; const half = Math.ceil(b.txs.length / 2);
    m.batches.push({ ...b, dbtr: { ...b.dbtr }, txs: b.txs.slice(half) }); b.txs = b.txs.slice(0, half);
  } },
  { id: 'same-account', label: 'Debtor pays its own account', expect: 'SCT-20', at: ['IBAN', 1], apply: (m) => { tx(m).cdtr = { ...tx(m).cdtr, iban: m.batches[0].dbtr.iban }; } },
  { id: 'address-unstructured', label: 'Creditor address with address lines only', expect: 'SCT-21', at: ['PstlAdr', 1], apply: (m) => { tx(m).cdtr = { ...tx(m).cdtr, addr: { Ctry: 'DE', lines: ['Beispielweg 4', '10115 Berlin'] } }; } },
  { id: 'address-three-lines', label: 'Debtor address with 3 address lines', expect: 'SCT-21', sev: 'error', at: ['AdrLine', 2], apply: (m) => { m.batches[0].dbtr.addr = { TwnNm: 'Utrecht', Ctry: 'NL', lines: ['Voorbeeldstraat 12', 'Floor 3', 'Building B'] }; } },
  { id: 'address-no-town', label: 'Structured debtor address without a town', expect: 'SCT-21', sev: 'error', at: ['PstlAdr', 0], apply: (m) => { delete m.batches[0].dbtr.addr.TwnNm; } },
  // layer 2: schema
  { id: 'xsd-missing', label: 'Mandatory MsgId missing', expect: 'XSD', at: ['CreDtTm', 0], apply: (m) => { m.omitMsgId = true; } },
  { id: 'xsd-order', label: 'Elements in the wrong order', expect: 'XSD', at: ['CdtrAgt', 0], apply: (m) => { tx(m).swapAgent = true; } },
  { id: 'xsd-amount', label: 'Amount written with a comma', expect: 'XSD', at: ['InstdAmt', 0], apply: (m) => { tx(m).amount = '1250,00'; } },
  { id: 'xsd-bic', label: 'BIC in a wrong format', expect: 'XSD', at: ['BICFI', 1], apply: (m) => { tx(m).cdtr = { ...tx(m).cdtr, bic: 'XMPL1DE' }; } },
  { id: 'xsd-datetime', label: 'Creation time not in ISO format', expect: 'XSD', at: ['CreDtTm', 0], apply: (m) => { m.created = m.created.replace('T', ' '); } },
  { id: 'xsd-long-remit', label: 'Remittance text over 140 characters', expect: 'XSD', at: ['Ustrd', 0], apply: (m) => { tx(m).ustrd = ['Invoice 2026-118 '.repeat(9)]; } },
  { id: 'xsd-long-id', label: 'EndToEndId over 35 characters', expect: 'XSD', at: ['EndToEndId', 0], apply: (m) => { tx(m).e2e = 'E2E-0001-REFERENCE-TOO-LONG-FOR-ISO-20022'; } },
  { id: 'xsd-unknown', label: 'Unknown element', expect: 'XSD', at: ['Note', 0], apply: (m) => { tx(m).extra = '<Note>Please pay fast</Note>'; } },
  // layer 1
  { id: 'xml-broken', label: 'Unclosed tag (not well-formed)', expect: 'XML', post: (xml) => xml.replace('</Ustrd>', '') },
];
function bump(txs) { const s = sumStr(txs); const [i, f] = s.split('.'); return (BigInt(i) + 10n).toString() + '.' + f; }

export function generate({ scenario = 'valid', count = 3, seed = 2026, execDate, procDate }) {
  const sc = SCENARIOS.find((s) => s.id === scenario) || SCENARIOS[0];
  const exec = execDate || nextBusinessDay(procDate);
  const m = makeModel({ count: Math.max(count, sc.min || 1), seed, execDate: exec, created: procDate + 'T09:00:00' });
  if (sc.apply) sc.apply(m, { procDate });
  const what = sc.expect === null ? 'none (valid file)' : sc.expect === 'XSD' ? 'one schema (XSD) error' : sc.expect === 'XML' ? 'not well-formed XML' : 'rule ' + sc.expect;
  const head = `Payment XML Lab test file. Made-up data. Scenario: ${sc.id} (${sc.label}). Expected finding: ${what}` + (sc.at ? `, on <${sc.at[0]}> at line @@LINE@@.` : '.');
  let xml = toXml(m, head);
  if (sc.at) {
    const t = parseTree(xml); const el = all(t.root, sc.at[0])[sc.at[1]];
    xml = xml.replace('@@LINE@@', String(el ? el.line : '?'));
  }
  if (sc.post) xml = sc.post(xml);
  return { xml, scenario: sc, fileName: `pain001-${sc.id}-${m.batches.reduce((n, b) => n + b.txs.length, 0)}.xml` };
}

// The preloaded sample: 1 batch, 3 payments, 5 findings on purpose (Olivia's spec, section 4)
export function sample(procDate) {
  const exec = nextBusinessDay(procDate);
  const m = makeModel({ count: 3, seed: 7, execDate: exec, created: procDate + ' 10:30:00' });
  m.msgId = 'PXL-SAMPLE-0001';
  const t = m.batches[0].txs;
  t[0].amount = '500.00'; t[1].amount = '500.00'; t[2].amount = '150.255';
  t[0].cdtr = { name: 'Alder Example Studio', iban: 'IE29AIBK93115212345678', bic: 'XMPLIE2DXXX' };
  t[1].cdtr = { name: 'Birch Example Logistics', iban: 'FR1420041010050500013M02606', bic: 'XMPLFRPPXXX' };
  t[2].cdtr = { name: 'Cedar Example Foods', iban: 'DE89370400440532013001', bic: 'XMPLDEFFXXX' };
  t[0].ustrd = ['Invoice 2026-118']; t[1].ustrd = ['Order 5521']; t[2].ustrd = ['Facture 77 - café et thé'];
  m.header.sum = '1250.00';
  return toXml(m, 'Payment XML Lab sample. Made-up data: 1 payment batch, 3 payments, 5 findings on purpose.');
}

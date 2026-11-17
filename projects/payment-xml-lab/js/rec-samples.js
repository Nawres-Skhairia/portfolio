// Reconciliation Workbench: made-up sample data only. Pretend companies, a published example IBAN for the account,
// made-up customer accounts (bank code XMPL, valid check digits, no real bank) and a made-up bank (BIC XMPLDEFF).
import { ibanWithCheck, groupIban } from './rules.js';

const gb = (n) => ibanWithCheck('GB', 'XMPL000000' + String(n).padStart(8, '0'));
const nl = (n) => ibanWithCheck('NL', 'XMPL' + String(n).padStart(10, '0'));
export const SAMPLE_OWNER = 'Larkspur Components GmbH';
export const SAMPLE_ACCOUNT = 'DE89370400440532013000';
const C = {
  alder: ['Alder Studio Ltd', gb(101)], corvid: ['Corvid Logistics BV', nl(102)], dunmore: ['Dunmore Foods Ltd', gb(103)],
  kestrel: ['Kestrel Tools GmbH', nl(104)], ordway: ['Ordway Ltd', gb(105)], pinehurst: ['Pinehurst BV', nl(106)],
  quillon: ['Quillon SpA', nl(107)], rivermead: ['Rivermead AB', nl(108)], saltmarsh: ['Saltmarsh Oy', nl(109)],
  tamberly: ['Tamberly SA', nl(110)], vantor: ['Vantor Kft', nl(111)], wexley: ['Wexley Ltd', gb(112)],
  yarrow: ['Yarrow & Co', gb(113)], bellmont: ['Bellmont SARL', nl(114)], hollin: ['Hollin Trading Ltd', gb(199)],
};
// number, customer, amount, due date, reference, currency
const INV = [
  [1031, 'alder', '1250.00', '2026-11-10'], [1032, 'corvid', '860.00', '2026-11-12'], [1033, 'dunmore', '425.50', '2026-11-14'],
  [1034, 'tamberly', '1500.00', '2026-11-15', 'RF18 5390 0754 7034'], [1035, 'quillon', '318.20', '2026-11-08'], [1036, 'rivermead', '712.00', '2026-11-13'],
  [1037, 'saltmarsh', '96.40', '2026-11-16'], [1038, 'vantor', '1040.00', '2026-11-11'], [1039, 'wexley', '230.00', '2026-11-12'],
  [1040, 'yarrow', '585.00', '2026-11-14'], [1041, 'alder', '147.30', '2026-11-15'], [1042, 'bellmont', '1150.00', '2026-11-05'],
  [1043, 'corvid', '990.00', '2026-11-09'], [1044, 'ordway', '1200.00', '2026-11-10'], [1045, 'quillon', '2000.00', '2026-11-12'],
  [1046, 'kestrel', '590.00', '2026-11-20'], [1047, 'bellmont', '1300.00', '2026-11-07'], [1048, 'kestrel', '1380.00', '2026-11-06'],
  [1049, 'pinehurst', '640.00', '2026-11-10'], [1050, 'tamberly', '275.00', '2026-11-25'], [1051, 'bellmont', '1000.00', '2026-11-10'],
  [1052, 'kestrel', '800.00', '2026-11-08'], [1053, 'kestrel', '1000.00', '2026-11-28'], [1054, 'pinehurst', '310.00', '2026-11-30'],
  [1055, 'ordway', '1200.00', '2026-11-12'], [1056, 'wexley', '1875.00', '2026-12-01'], [1057, 'rivermead', '950.00', '2026-11-11'],
  [1058, 'vantor', '420.00', '2026-12-02'], [1059, 'saltmarsh', '455.00', '2026-11-13'], [1060, 'dunmore', '500.00', '2026-11-15', '', 'USD'],
];
export function invoiceCsv(rows = INV) {
  const q = (v) => (/[",;\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v);
  return ['# Made-up open invoices of a pretend company (' + SAMPLE_OWNER + '). Never real data.',
    'invoice_number,customer,customer_account,amount,currency,due_date,reference',
    ...rows.map(([n, c, a, d, ref = '', ccy = 'EUR']) => [`INV-${n}`, C[c][0], groupIban(C[c][1]), a, ccy, d, ref].map(q).join(','))].join('\n') + '\n';
}

// [what it shows, customer key, amount, payment details, extra]
const CR = 'PMNT/RCDT/ESCT';
const ENTRIES = [
  ['REC-05', 'bellmont', '3450.00', 'Factures 1042, 1047, 1051'],
  ['REC-01', 'alder', '1250.00', 'INV-1031', { e2e: 'ALDER-PAY-7781' }],
  ['REC-01', 'corvid', '860.00', 'Invoice 1032'],
  ['REC-01', 'dunmore', '425.50', 'inv 1033 thank you'],
  ['REC-03', 'ordway', '800.00', 'INV-1055 first instalment'],
  ['REC-01', 'tamberly', '1500.00', null, { rf: 'RF18539007547034' }],
  ['REC-01', 'quillon', '318.20', 'Rechnung Nr. 1035'],
  ['REC-09', null, '10.00', null, { debit: true, btc: 'ACMT/MDOP/CHRG', addtl: 'Account fees November' }],
  ['REC-01', 'rivermead', '712.00', 'INV1036'],
  ['REC-06', 'kestrel', '2180.00', 'Payment Kestrel Tools October deliveries'],
  ['REC-01', 'saltmarsh', '96.40', 'INV-1037'],
  ['REC-01', 'vantor', '1040.00', 'Facture INV-1038'],
  ['unknown', 'hollin', '275.00', 'payment'],
  ['REC-01', 'wexley', '230.00', 'Payment for INV 1039'],
  ['REC-01', 'yarrow', '585.00', 'INV-1040 / PO 77812'],
  ['REC-04', 'rivermead', '1000.00', 'Rivermead invoice 1057'],
  ['REC-01', 'alder', '147.30', 'INV-1041'],
  ['REC-01', 'corvid', '990.00', 'Inv. 1043/2026'],
  ['REC-08', 'alder', '1250.00', 'INV-1031', { e2e: 'ALDER-PAY-7790' }],
  ['REC-02', 'ordway', '1195.00', 'INV-1044'],
  ['REC-07', 'pinehurst', '640.00', 'November payment'],
  ['REC-02', 'quillon', '1996.50', 'INV-1045'],
  ['REC-09', 'dunmore', '462.30', 'INV-1060', { instd: ['USD', '500.00'] }],
  ['REC-03', 'ordway', '400.00', 'INV-1055 rest'],
  ['REC-10', 'saltmarsh', '455.00', 'INV-1O59'],
  ['REC-09', 'wexley', '1200.00', 'Refund credit note CN-0042', { debit: true, btc: 'PMNT/ICDT/ESCT' }],
];
export const SAMPLE_PLAN = ENTRIES.map((e, i) => ({ ref: ref(i), shows: e[0] }));
function ref(i) { return 'XMPL2611170' + String(i + 1).padStart(3, '0'); }
const xe = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const cents = (s) => BigInt(s.replace('.', ''));
const dec = (c) => { const s = c.toString().padStart(3, '0'); return s.slice(0, -2) + '.' + s.slice(-2); };

export function statementXml({ opening = '12400.00', closingDelta = 0n, dropStatusOfFirst = false, entries = ENTRIES } = {}) {
  let cr = 0n, db = 0n, nCr = 0, nDb = 0;
  for (const [, , a, , x = {}] of entries) { if (x.debit) { db += cents(a); nDb++; } else { cr += cents(a); nCr++; } }
  const close = cents(opening) + cr - db + closingDelta;
  const bal = (tp, v) => `      <Bal>\n        <Tp><CdOrPrtry><Cd>${tp}</Cd></CdOrPrtry></Tp>\n        <Amt Ccy="EUR">${dec(v < 0n ? -v : v)}</Amt>\n        <CdtDbtInd>${v < 0n ? 'DBIT' : 'CRDT'}</CdtDbtInd>\n        <Dt><Dt>${tp === 'OPBD' ? '2026-11-17' : '2026-11-17'}</Dt></Dt>\n      </Bal>`;
  const ntry = ([, c, a, rem, x = {}], i) => {
    const [code, fam, sub] = (x.btc || CR).split('/');
    const party = c ? C[c] : null;
    const parties = !party ? '' : x.debit
      ? `            <RltdPties>\n              <Cdtr><Pty><Nm>${xe(party[0])}</Nm></Pty></Cdtr>\n              <CdtrAcct><Id><IBAN>${party[1]}</IBAN></Id></CdtrAcct>\n            </RltdPties>\n`
      : `            <RltdPties>\n              <Dbtr><Pty><Nm>${xe(party[0].toUpperCase())}</Nm></Pty></Dbtr>\n              <DbtrAcct><Id><IBAN>${party[1]}</IBAN></Id></DbtrAcct>\n            </RltdPties>\n`;
    const rmt = x.rf ? `            <RmtInf>\n              <Strd><CdtrRefInf><Tp><CdOrPrtry><Cd>SCOR</Cd></CdOrPrtry></Tp><Ref>${x.rf}</Ref></CdtrRefInf></Strd>\n            </RmtInf>\n`
      : rem ? `            <RmtInf>\n              <Ustrd>${xe(rem)}</Ustrd>\n            </RmtInf>\n` : '';
    const details = !party ? '' : `        <NtryDtls>\n          <TxDtls>\n            <Refs><EndToEndId>${xe(x.e2e || 'NOTPROVIDED')}</EndToEndId></Refs>\n            <Amt Ccy="EUR">${a}</Amt>\n            <CdtDbtInd>${x.debit ? 'DBIT' : 'CRDT'}</CdtDbtInd>\n` +
      (x.instd ? `            <AmtDtls><InstdAmt><Amt Ccy="${x.instd[0]}">${x.instd[1]}</Amt></InstdAmt></AmtDtls>\n` : '') + parties + rmt + `          </TxDtls>\n        </NtryDtls>\n`;
    return `      <Ntry>\n        <NtryRef>${i + 1}</NtryRef>\n        <Amt Ccy="EUR">${a}</Amt>\n        <CdtDbtInd>${x.debit ? 'DBIT' : 'CRDT'}</CdtDbtInd>\n` +
      (dropStatusOfFirst && i === 0 ? '' : `        <Sts><Cd>BOOK</Cd></Sts>\n`) +
      `        <BookgDt><Dt>2026-11-17</Dt></BookgDt>\n        <ValDt><Dt>2026-11-17</Dt></ValDt>\n        <AcctSvcrRef>${ref(i)}</AcctSvcrRef>\n` +
      `        <BkTxCd><Domn><Cd>${code}</Cd><Fmly><Cd>${fam}</Cd><SubFmlyCd>${sub}</SubFmlyCd></Fmly></Domn></BkTxCd>\n` + details +
      (x.addtl ? `        <AddtlNtryInf>${xe(x.addtl)}</AddtlNtryInf>\n` : '') + `      </Ntry>`;
  };
  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- Made-up statement from a pretend bank (BIC XMPLDEFF), for testing only. Never a real statement. -->
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08">
  <BkToCstmrStmt>
    <GrpHdr>
      <MsgId>XMPL-CAMT053-20261117</MsgId>
      <CreDtTm>2026-11-17T18:00:00</CreDtTm>
    </GrpHdr>
    <Stmt>
      <Id>STMT-20261117-001</Id>
      <CreDtTm>2026-11-17T18:00:00</CreDtTm>
      <FrToDt><FrDtTm>2026-11-17T00:00:00</FrDtTm><ToDtTm>2026-11-17T23:59:59</ToDtTm></FrToDt>
      <Acct>
        <Id><IBAN>${SAMPLE_ACCOUNT}</IBAN></Id>
        <Ccy>EUR</Ccy>
        <Ownr><Nm>${SAMPLE_OWNER}</Nm></Ownr>
        <Svcr><FinInstnId><BICFI>XMPLDEFFXXX</BICFI></FinInstnId></Svcr>
      </Acct>
${bal('OPBD', cents(opening))}
${bal('CLBD', close)}
      <TxsSummry>
        <TtlCdtNtries><NbOfNtries>${nCr}</NbOfNtries><Sum>${dec(cr)}</Sum></TtlCdtNtries>
        <TtlDbtNtries><NbOfNtries>${nDb}</NbOfNtries><Sum>${dec(db)}</Sum></TtlDbtNtries>
      </TxsSummry>
${entries.map(ntry).join('\n')}
    </Stmt>
  </BkToCstmrStmt>
</Document>
`;
}

export const REC_SAMPLES = [
  { id: 'day', label: 'Statement of 17 Nov 2026 (26 entries)', statement: () => statementXml(), invoices: () => invoiceCsv() },
  { id: 'balance', label: 'Closing balance off by 100.00', statement: () => statementXml({ closingDelta: 10000n }), invoices: () => invoiceCsv() },
  { id: 'schema', label: 'Not schema-valid (entry status missing)', statement: () => statementXml({ dropStatusOfFirst: true }), invoices: () => invoiceCsv() },
];

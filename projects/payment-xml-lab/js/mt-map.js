// MT103 to pacs.008.001.08: our own simplified mapping, rule by rule, with a status for every piece of data.
// Simplified, not SWIFT's official translation, not affiliated with SWIFT. Each rule names its public source,
// or says it is our documented choice.
import { readMt, FIELDS, date6, amountToIso, isValidDate6, bicFromLT } from './mt103.js';
import { ibanIsValid, COUNTRIES } from './rules.js';

export const MX = { ns: 'urn:iso:std:iso:20022:tech:xsd:pacs.008.001.08', id: 'pacs.008.001.08', xsd: 'pacs.008.001.08.xsd' };
export const MAP_TOOL = { name: 'MT to MX Converter', version: '0.1.0' };
export const MAP_CATALOGUE_VERSION = '2026.11-mvp1';

export const MAP_SOURCES = {
  s1: { name: 'Swift FAQ: removal of unstructured addresses', url: 'https://www.swift.com/standards/iso-20022/iso-20022-faqs/iso-20022-removal-unstructured-address' },
  s3: { name: 'ISO 20022 pacs.008.001.08 schema', url: 'https://www.iso20022.org/iso-20022-message-definitions' },
  own: { name: 'Our documented choice', url: null },
};

export const STATUS = {
  mapped: 'Mapped', transformed: 'Transformed', defaulted: 'Defaulted', lost: 'Cut or lost', review: 'Needs review',
};

// Olivia, spec v1.1 (PORT-41 10682): any Error from these rules gives the red status. Never name SWIFT as the one who refuses: these are
// the format rules of our own catalogue, not SWIFT's network check. 'MT' is the MT103 format check itself.
export const REJECTED = 'Would be rejected';
export const REJECTED_LINE = 'This MT breaks a basic format rule (listed below). A bank would refuse it before any conversion. The pacs.008 below is shown for learning only.';
export const REJECTING_RULES = ['MT', 'MAP-03', 'MAP-10', 'MAP-11', 'MAP-21', 'MAP-31', 'MAP-50', 'MAP-61'];

// The catalogue: one entry per rule. source: s1, s3 or own; several may be listed.
export const MAP_RULES = [
  { id: 'MAP-01', mt: ':20:', target: 'PmtId/InstrId', statuses: 'Mapped', source: ['own'], what: 'The sender\'s reference becomes the instruction ID.' },
  { id: 'MAP-02', mt: '(none)', target: 'PmtId/EndToEndId', statuses: 'Defaulted', source: ['own'], what: 'An MT103 has no end-to-end reference, so EndToEndId is always NOTPROVIDED. Nothing is guessed from other fields.' },
  { id: 'MAP-03', mt: 'Block 3, 121', target: 'PmtId/UETR', statuses: 'Mapped, Error if missing', source: ['own'], what: 'The unique end-to-end transaction reference is copied. If it is missing the tool reports an error and never invents one (the schema itself makes UETR optional).' },
  { id: 'MAP-04', mt: '(none)', target: 'GrpHdr: MsgId, CreDtTm, NbOfTxs, SttlmInf', statuses: 'Defaulted', source: ['own'], what: 'Group header values the MT does not have: MsgId = :20:, NbOfTxs = 1, a demo creation time (the value date at 00:00:00, never the clock, so the same input always gives the same file), and settlement method INDA, or COVE when :53a: or :54a: shows a cover payment.' },
  { id: 'MAP-05', mt: 'Blocks 1 and 2', target: 'InstgAgt, InstdAgt', statuses: 'Mapped', source: ['own'], what: 'Sender and receiver BICs from the 12-character addresses of the headers (characters 1 to 8 and 10 to 12; the 9th is the terminal letter).' },
  { id: 'MAP-10', mt: ':32A:', target: 'IntrBkSttlmDt, IntrBkSttlmAmt', statuses: 'Transformed', source: ['own'], what: 'Date YYMMDD becomes YYYY-MM-DD (read as 20YY: our choice), and the decimal comma becomes a point. The number of decimals must suit the currency.' },
  { id: 'MAP-11', mt: ':33B:, :36:', target: 'InstdAmt, XchgRate', statuses: 'Transformed', source: ['own'], what: 'Instructed amount and exchange rate. A different currency in :33B: needs :36:.' },
  { id: 'MAP-12', mt: ':13C:', target: 'SttlmTmIndctn, SttlmTmReq', statuses: 'Transformed', source: ['own'], what: 'Time indications: CLSTIME to the requested closing time, SNDTIME and RNCTIME to the debit and credit times on the value date.' },
  { id: 'MAP-13', mt: ':26T:', target: 'Purp/Prtry', statuses: 'Needs review', source: ['own'], what: 'The transaction type code is kept as a proprietary purpose. A person should pick the matching ISO purpose code.' },
  { id: 'MAP-20', mt: ':50A:, :50F:, :50K:', target: 'Dbtr, DbtrAcct', statuses: 'Mapped, Transformed, Needs review', source: ['own'], what: 'Ordering customer. Account "/…" becomes an IBAN if it is a valid IBAN, otherwise Othr/Id. 50A gives the BIC as AnyBIC; 50F lines 1, 2 and 3 give name, address line, country and town; for 50K the first line is taken as the name (our choice).' },
  { id: 'MAP-21', mt: ':52a:, else sender', target: 'DbtrAgt', statuses: 'Mapped, Defaulted', source: ['own'], what: 'Ordering institution, or the sender BIC from block 1 when there is no :52a:.' },
  { id: 'MAP-30', mt: ':53a:, :54a:, :55A:', target: 'SttlmInf reimbursement agents', statuses: 'Mapped, Needs review', source: ['own'], what: 'Sender\'s and receiver\'s correspondents become the instructing and instructed reimbursement agents; :55A: becomes the third reimbursement agent (our choice).' },
  { id: 'MAP-31', mt: ':56a:, :57a:, else receiver', target: 'IntrmyAgt1, CdtrAgt', statuses: 'Mapped, Defaulted, Needs review', source: ['own'], what: 'Intermediary and beneficiary\'s bank, or the receiver BIC from block 2 when there is no :57a:.' },
  { id: 'MAP-40', mt: ':59:, :59A:, :59F:', target: 'Cdtr, CdtrAcct', statuses: 'Mapped, Transformed, Needs review', source: ['own'], what: 'Beneficiary, with the same account, BIC and line rules as MAP-20.' },
  { id: 'MAP-50', mt: 'Free-text address in :50K: or :59:', target: 'PstlAdr', statuses: 'Needs review, Error', source: ['s1', 'own'], what: 'The tool looks for a country (ISO code or name) and a town (with its postcode) and builds a hybrid address: town and country, other lines kept as address lines. A person must confirm the guess. If no town and country are found the address stays free text, which cross-border messages on the Swift network no longer accept (see S1): Error.' },
  { id: 'MAP-60', mt: ':70:', target: 'RmtInf/Ustrd', statuses: 'Mapped, Needs review', source: ['own'], what: 'Remittance lines are joined into one unstructured text (at most 4 × 35 = 140 characters, so nothing is cut). Codes such as /INV/ or /RFB/ are flagged because they could become structured remittance (our choice).' },
  { id: 'MAP-61', mt: ':71A:, :71F:, :71G:', target: 'ChrgBr, ChrgsInf', statuses: 'Transformed, Needs review', source: ['own'], what: 'OUR, SHA and BEN become DEBT, SHAR and CRED. :71F: amounts go to ChrgsInf with the sender as agent, :71G: with the receiver as agent (our choice).' },
  { id: 'MAP-70', mt: ':23B:, :23E:', target: 'PmtTpInf, InstrForCdtrAgt, InstrForNxtAgt', statuses: 'Mapped, Needs review', source: ['own'], what: '23B CRED is the normal case and needs no element. 23E codes: CHQB, HOLD, PHOB, TELB to the creditor agent; PHON, TELE, PHOI, TELI, REPA to the next agent; SDVA to the service level; INTC and CORT to the category purpose.' },
  { id: 'MAP-72', mt: ':72:', target: 'InstrForCdtrAgt, InstrForNxtAgt, PrvsInstgAgt1', statuses: 'Transformed, Needs review, Cut or lost', source: ['own'], what: '/ACC/ goes to the creditor agent; /INS/ with a BIC to the previous instructing agent; /INT/, /REC/ and other text to the next agent (our choice). Free text is not machine-readable, so it needs review. Text longer than 140 characters is cut.' },
  { id: 'MAP-77', mt: ':77B:', target: 'RgltryRptg/Dtls/Inf', statuses: 'Needs review', source: ['own'], what: 'Regulatory reporting lines are kept as text. The ISO structure is richer, so a person must check it.' },
  { id: 'MAP-90', mt: 'All text', target: 'All text', statuses: 'Mapped', source: ['s3'], what: 'The MT character set fits inside UTF-8: no loss in this direction. The loss is in the reverse check.' },
  { id: 'MAP-99', mt: 'Anything else', target: '(none)', statuses: 'Cut or lost', source: ['own'], what: 'Any MT data not covered above gets its own row with its value. Never silently dropped.' },
];

// ---------- XML builder that remembers which line each element lands on ----------
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
class N {
  constructor(name, attrs, kids) { this.name = name; this.attrs = attrs || null; this.kids = []; this.text = null; this.line = 0; this.end = 0; if (kids != null) this.add(kids); }
  add(k) { if (Array.isArray(k)) k.forEach((x) => this.add(x)); else if (k instanceof N) this.kids.push(k); else if (k != null && k !== false) this.text = String(k); return this; }
  get(name) { return this.kids.find((k) => k.name === name) || null; }
  ensure(name) { let k = this.get(name); if (!k) { k = new N(name); this.kids.push(k); } return k; }
}
const E = (name, a, b) => (a instanceof N || Array.isArray(a) || typeof a !== 'object' || a === null ? new N(name, null, a) : new N(name, a, b));
function serialize(root) {
  const L = ['<?xml version="1.0" encoding="UTF-8"?>'];
  (function w(n, d) {
    const pad = '  '.repeat(d), at = n.attrs ? Object.entries(n.attrs).map(([k, v]) => ` ${k}="${esc(v)}"`).join('') : '';
    n.line = L.length + 1;
    if (!n.kids.length) { L.push(`${pad}<${n.name}${at}>${esc(n.text ?? '')}</${n.name}>`); n.end = n.line; return; }
    L.push(`${pad}<${n.name}${at}>`);
    n.kids.forEach((k) => w(k, d + 1));
    L.push(`${pad}</${n.name}>`); n.end = L.length;
  })(root, 0);
  return L.join('\n') + '\n';
}
// order of the transaction elements in pacs.008.001.08 (CreditTransferTransaction39)
const TX_ORDER = ['PmtId', 'PmtTpInf', 'IntrBkSttlmAmt', 'IntrBkSttlmDt', 'SttlmPrty', 'SttlmTmIndctn', 'SttlmTmReq', 'AccptncDtTm', 'PoolgAdjstmntDt', 'InstdAmt', 'XchgRate', 'ChrgBr', 'ChrgsInf', 'PrvsInstgAgt1', 'PrvsInstgAgt1Acct', 'PrvsInstgAgt2', 'PrvsInstgAgt2Acct', 'PrvsInstgAgt3', 'PrvsInstgAgt3Acct', 'InstgAgt', 'InstdAgt', 'IntrmyAgt1', 'IntrmyAgt1Acct', 'IntrmyAgt2', 'IntrmyAgt2Acct', 'IntrmyAgt3', 'IntrmyAgt3Acct', 'UltmtDbtr', 'InitgPty', 'Dbtr', 'DbtrAcct', 'DbtrAgt', 'DbtrAgtAcct', 'CdtrAgt', 'CdtrAgtAcct', 'Cdtr', 'CdtrAcct', 'UltmtCdtr', 'InstrForCdtrAgt', 'InstrForNxtAgt', 'Purp', 'RgltryRptg', 'Tax', 'RltdRmtInf', 'RmtInf', 'SplmtryData'];
const ORDERS = {
  PmtTpInf: ['InstrPrty', 'ClrChanl', 'SvcLvl', 'LclInstrm', 'CtgyPurp'],
  SttlmInf: ['SttlmMtd', 'SttlmAcct', 'ClrSys', 'InstgRmbrsmntAgt', 'InstgRmbrsmntAgtAcct', 'InstdRmbrsmntAgt', 'InstdRmbrsmntAgtAcct', 'ThrdRmbrsmntAgt', 'ThrdRmbrsmntAgtAcct'],
  PstlAdr: ['AdrTp', 'Dept', 'SubDept', 'StrtNm', 'BldgNb', 'BldgNm', 'Flr', 'PstBx', 'Room', 'PstCd', 'TwnNm', 'TwnLctnNm', 'DstrctNm', 'CtrySubDvsn', 'Ctry', 'AdrLine'],
  FinInstnId: ['BICFI', 'ClrSysMmbId', 'LEI', 'Nm', 'PstlAdr', 'Othr'],
  Party: ['Nm', 'PstlAdr', 'Id', 'CtryOfRes', 'CtctDtls'],
};
const sortBy = (n, order) => { n.kids.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name)); };

// ---------- helpers ----------
const MINOR = { BIF: 0, CLP: 0, DJF: 0, GNF: 0, ISK: 0, JPY: 0, KMF: 0, KRW: 0, PYG: 0, RWF: 0, UGX: 0, VND: 0, VUV: 0, XAF: 0, XOF: 0, XPF: 0, BHD: 3, IQD: 3, JOD: 3, KWD: 3, LYD: 3, OMR: 3, TND: 3 };
export const minorUnits = (ccy) => (ccy in MINOR ? MINOR[ccy] : 2);
const COUNTRY_NAMES = { FRANCE: 'FR', GERMANY: 'DE', DEUTSCHLAND: 'DE', NETHERLANDS: 'NL', 'THE NETHERLANDS': 'NL', NEDERLAND: 'NL', BELGIUM: 'BE', BELGIQUE: 'BE', SPAIN: 'ES', ESPANA: 'ES', ITALY: 'IT', ITALIA: 'IT', AUSTRIA: 'AT', PORTUGAL: 'PT', IRELAND: 'IE', LUXEMBOURG: 'LU', FINLAND: 'FI', BULGARIA: 'BG', POLAND: 'PL', SWITZERLAND: 'CH', SCHWEIZ: 'CH', 'UNITED KINGDOM': 'GB', UK: 'GB', 'GREAT BRITAIN': 'GB', USA: 'US', 'UNITED STATES': 'US', JAPAN: 'JP', SWEDEN: 'SE', DENMARK: 'DK', NORWAY: 'NO', GREECE: 'GR', ROMANIA: 'RO', CZECHIA: 'CZ', 'CZECH REPUBLIC': 'CZ', HUNGARY: 'HU', CROATIA: 'HR', SLOVAKIA: 'SK', SLOVENIA: 'SI', CANADA: 'CA', SINGAPORE: 'SG' };
const POSTCODE_TOWN = /^(\d{4} ?[A-Z]{2}|\d{3} ?\d{2}|\d{4,6}|[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2})\s+([A-Z][A-Z' .-]{1,34})$/;
const BIC = /^[A-Z0-9]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/;
const fi = (bic) => E('FinInstnId', [E('BICFI', bic)]);

// Find town and country in free-text address lines (MAP-50). Returns null when not both are found.
const TOWN = "[A-Z][A-Z' .-]{0,33}[A-Z.]";
const UK_PC = '[A-Z]{1,2}\\d[A-Z\\d]? ?\\d[A-Z]{2}';
// "69002 LYON", "3511 AB UTRECHT" (postcode first)
const PC_FIRST = new RegExp(`^(\\d{4} ?[A-Z]{2}|\\d{3} ?\\d{2}|\\d{4,6}|${UK_PC})\\s+(${TOWN})$`);
// "LONDON SW1A 1AA", "NEW YORK NY 10001", "WIEN 1010" (town first, optional state code; never a short house number)
const TOWN_FIRST = new RegExp(`^([A-Z][A-Z' .-]{0,33}?[A-Z.])[ ,]+(?:([A-Z]{2})\\s+)?(\\d{5}(?:-\\d{4})?|${UK_PC}|\\d{4,6})$`);
function countryAtEnd(l) { // "69002 LYON FRANCE", "LYON, FR", "MILANO ITALY"
  const u = l.toUpperCase();
  for (const [name, code] of Object.entries(COUNTRY_NAMES)) if (u.endsWith(' ' + name) || u.endsWith(',' + name)) return { code, rest: u.slice(0, u.length - name.length).replace(/[ ,]+$/, '') };
  const m = /^(.*?)[ ,]+([A-Z]{2})$/.exec(u);
  if (m && COUNTRIES.has(m[2]) && m[1].length > 1 && !/\d$/.test(m[1])) return { code: m[2], rest: m[1].trim() };
  return null;
}
function townIn(l) {
  let m = PC_FIRST.exec(l); if (m) return { pc: m[1], town: m[2].trim() };
  m = TOWN_FIRST.exec(l); if (m && m[1].trim().length > 1) return { pc: m[3], town: m[1].trim(), sub: m[2] || null };
  return null;
}

// Find town and country in free-text address lines (MAP-50). Returns null when not both are found.
export function guessAddress(lines) {
  const L = lines.map((l) => l.trim()).filter(Boolean);
  if (!L.length) return null;
  let ctry = null, ctryIdx = -1, t = null, townIdx = -1;
  const last = L[L.length - 1].toUpperCase();
  if (COUNTRIES.has(last)) { ctry = last; ctryIdx = L.length - 1; } else if (COUNTRY_NAMES[last]) { ctry = COUNTRY_NAMES[last]; ctryIdx = L.length - 1; }
  const upto = ctryIdx < 0 ? L.length : ctryIdx;
  for (let i = upto - 1; i >= 0; i--) {
    let l = L[i].toUpperCase(), sameLine = false;
    if (!ctry) { const c = countryAtEnd(l); if (c) { ctry = c.code; l = c.rest; sameLine = true; } }
    t = townIn(l);
    if (t) { townIdx = i; break; }
    if ((ctry && i === upto - 1) || sameLine) {
      if (/^[A-Z][A-Z' .-]{1,34}$/.test(l)) { t = { town: l.trim(), pc: null }; townIdx = i; break; }
    }
    if (ctry) break;
  }
  if (!ctry || !t) return null;
  return { ctry, town: t.town, pc: t.pc, sub: t.sub || null, rest: L.filter((_, i) => i !== ctryIdx && i !== townIdx), ctryLine: ctryIdx, townLine: townIdx };
}

// ---------- the converter ----------
// A result for input refused before it is read (for example a file that is too big)
export function refuse(message, fix) {
  const e = { severity: 'error', line: 1, tag: null, message, fix, rule: 'MT', mtLine: 1 };
  return { mt: { fields: [], blocks: { b3: [], b5: [] }, errors: [e], lineCount: 0 }, rows: [], findings: [{ severity: 'error', rule: 'MT', mtLine: null, xmlLine: null, message, fix }], errors: [e], counts: { mapped: 0, transformed: 0, defaulted: 0, lost: 0, review: 0 }, verdict: 'Not converted', facts: {}, xml: '', refused: true, tool: MAP_TOOL, catalogue: MAP_CATALOGUE_VERSION, xsd: MX.id };
}

// today: YYYY-MM-DD, given by the tests; the page uses the visitor's date
export function convert(src, { today = new Date().toISOString().slice(0, 10) } = {}) {
  const mt = readMt(src);
  if (mt.refused) {
    const findings = mt.errors.map((e) => ({ severity: 'error', rule: 'MT', mtLine: e.line, xmlLine: null, message: e.message, fix: e.fix }));
    return { mt, rows: [], findings, errors: mt.errors.map((e) => ({ ...e, rule: 'MT', mtLine: e.line })), counts: { mapped: 0, transformed: 0, defaulted: 0, lost: 0, review: 0 }, verdict: 'Not converted', facts: {}, xml: '', refused: true, tool: MAP_TOOL, catalogue: MAP_CATALOGUE_VERSION, xsd: MX.id };
  }
  const rows = []; const errors = mt.errors.map((e) => ({ ...e, rule: 'MT', mtLine: e.line }));
  let n = 0;
  const row = (r) => { const x = { n: ++n, status: 'mapped', node: null, mtLines: [], ...r }; rows.push(x); return x; };
  const fail = (rule, mtLine, message, fix, why) => errors.push({ severity: 'error', rule, mtLine, line: mtLine, message, fix, why });
  const field = (tag) => mt.fields.find((f) => f.tag === tag) || null;
  const fieldsOf = (re) => mt.fields.filter((f) => re.test(f.tag));
  const used = new Set();
  const use = (f) => { used.add(f); return f; };

  const doc = E('Document', { xmlns: MX.ns });
  const root = E('FIToFICstmrCdtTrf'); doc.add(root);
  const gh = E('GrpHdr'); const tx = E('CdtTrfTxInf'); root.add([gh, tx]);
  const put = (parent, node) => { parent.add(node); return node; };

  // blocks 1 and 2 (MAP-05)
  let sender = null, receiver = null, senderLine = null, receiverLine = null;
  const b1 = mt.blocks.b1, b2 = mt.blocks.b2;
  if (b1 && /^F01[A-Z0-9]{12}/.test(b1.raw)) { const lt = b1.raw.slice(3, 15); if (b2 && b2.raw.startsWith('O')) { receiver = bicFromLT(lt); receiverLine = b1.line; } else { sender = bicFromLT(lt); senderLine = b1.line; } }
  if (b2 && /^I103[A-Z0-9]{12}/.test(b2.raw)) { receiver = bicFromLT(b2.raw.slice(4, 16)); receiverLine = b2.line; }
  if (b2 && /^O103\d{10}[A-Z0-9]{12}/.test(b2.raw)) { sender = bicFromLT(b2.raw.slice(14, 26)); senderLine = b2.line; }
  if (sender && !BIC.test(sender)) sender = null;
  if (receiver && !BIC.test(receiver)) receiver = null;

  // :20: and group header (MAP-01, MAP-04)
  const f20 = field('20'); if (f20) use(f20);
  const ref = f20 ? f20.lines[0] : null;
  const f32 = field('32A'); if (f32) use(f32);
  const m32 = f32 ? /^(\d{6})([A-Z]{3})(.*)$/.exec(f32.lines[0]) : null;
  const vdOk = m32 && isValidDate6(m32[1]);
  const vd = vdOk ? date6(m32[1]) : null;

  const msgId = put(gh, E('MsgId', ref || 'NOTPROVIDED'));
  row({ rule: 'MAP-04', tag: '20', mtLines: f20 ? [f20.line] : [], mtValue: ref || '(none)', path: 'GrpHdr/MsgId', value: ref || 'NOTPROVIDED', status: 'defaulted', node: msgId, note: 'The message ID reuses the sender\'s reference: an MT103 carries one payment per message.' });
  const cre = put(gh, E('CreDtTm', vd ? vd + 'T00:00:00' : '2000-01-01T00:00:00'));
  row({ rule: 'MAP-04', tag: null, mtValue: '(none)', path: 'GrpHdr/CreDtTm', value: cre.text, status: 'defaulted', node: cre, note: 'Demo creation time: the value date at 00:00:00, so the same input always gives the same file. Your system sets the real time when it sends.' });
  const nb = put(gh, E('NbOfTxs', '1'));
  row({ rule: 'MAP-04', tag: null, mtValue: '(none)', path: 'GrpHdr/NbOfTxs', value: '1', status: 'defaulted', node: nb, note: 'One payment per MT103.' });
  const sttl = put(gh, E('SttlmInf'));
  const f53 = fieldsOf(/^53[ABD]$/)[0] || null, f54 = fieldsOf(/^54[ABD]$/)[0] || null, f55 = field('55A');
  const cover = (f53 && f53.tag !== '53B') || f54;
  const smtd = put(sttl, E('SttlmMtd', cover ? 'COVE' : 'INDA'));
  row({ rule: 'MAP-04', tag: null, mtValue: '(none)', path: 'GrpHdr/SttlmInf/SttlmMtd', value: smtd.text, status: 'defaulted', node: smtd, note: cover ? 'COVE, because :53a: or :54a: shows that the money moves through correspondents (a cover payment). Our documented choice.' : 'INDA: the receiver books the payment on the account it holds for the sender. Our documented choice, as the MT has no correspondents.' });

  // PmtId (MAP-01, MAP-02, MAP-03)
  const pid = put(tx, E('PmtId'));
  if (ref) { const x = put(pid, E('InstrId', ref)); row({ rule: 'MAP-01', tag: '20', mtLines: [f20.line], mtValue: ref, path: 'PmtId/InstrId', value: ref, status: 'mapped', node: x, note: 'Sender\'s reference.' }); }
  const e2e = put(pid, E('EndToEndId', 'NOTPROVIDED'));
  row({ rule: 'MAP-02', tag: null, mtValue: '(none)', path: 'PmtId/EndToEndId', value: 'NOTPROVIDED', status: 'defaulted', node: e2e, note: 'An MT103 has no end-to-end reference, so EndToEndId is set to NOTPROVIDED.', why: 'The receiver cannot match this payment to the payer\'s own reference.', fix: 'If the payer gave an end-to-end reference, send the payment as ISO 20022 from the start.' });
  const b3 = mt.blocks.b3 || [];
  const u121 = b3.find((b) => b.tag === '121');
  if (u121) {
    if (/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(u121.value)) {
      const x = put(pid, E('UETR', u121.value)); row({ rule: 'MAP-03', tag: '121', mtLines: [u121.line], mtValue: u121.value, path: 'PmtId/UETR', value: u121.value, status: 'mapped', node: x, note: 'Unique end-to-end transaction reference (block 3, field 121).' });
    } else {
      row({ rule: 'MAP-03', tag: '121', mtLines: [u121.line], mtValue: u121.value, path: 'PmtId/UETR', value: '(not written)', status: 'review', note: 'The UETR is not a version 4 UUID in lower case.' });
      fail('MAP-03', u121.line, `UETR "${u121.value}" is not a version 4 UUID in lower case.`, 'Correct field 121 in block 3.', 'Every bank on the way tracks the payment by this reference.');
    }
  } else {
    row({ rule: 'MAP-03', tag: '121', mtValue: '(none)', path: 'PmtId/UETR', value: '(not written)', status: 'review', note: 'Block 3 has no field 121, so the pacs.008 has no UETR. The tool does not invent one.' });
    fail('MAP-03', mt.blocks.b3.length ? mt.blocks.b3[0].line : 1, 'The MT103 has no UETR (block 3, field 121). Cross-border pacs.008 messages need one, and the tool will not invent it.', 'Ask the sender for the UETR the payment was created with.', 'Without it the payment cannot be tracked end to end; the base schema allows it to be missing, so only this rule catches it.');
  }
  for (const b of b3.filter((x) => x.tag !== '121')) row({ rule: 'MAP-99', tag: b.tag, mtLines: [b.line], mtValue: `{${b.tag}:${b.value}}`, path: '(none)', value: '', status: 'lost', note: b.tag === '108' ? 'Message user reference (block 3, 108): a network reference with no place in pacs.008.' : `Block 3 field ${b.tag} has no place in pacs.008 in this simplified mapping.` });

  // 23B, 23E (MAP-70)
  const f23 = field('23B');
  if (f23) {
    use(f23); const c = f23.lines[0];
    if (c === 'CRED') row({ rule: 'MAP-70', tag: '23B', mtLines: [f23.line], mtValue: c, path: '(message type)', value: 'pacs.008', status: 'mapped', note: 'CRED is a normal customer transfer, which is what a pacs.008 is: no element is needed.' });
    else row({ rule: 'MAP-70', tag: '23B', mtLines: [f23.line], mtValue: c, path: '(none)', value: '', status: 'review', note: `Bank operation code ${c} has no agreed element in this mapping${c === 'CRTS' ? ' (CRTS marks a test message)' : ''}.`, fix: 'Agree with the receiver how this should be shown, for example as a service level.' });
  }
  for (const f of fieldsOf(/^23E$/)) {
    use(f); const [code, ...more] = f.lines[0].split('/'); const info = more.join('/');
    const pt = () => tx.ensure('PmtTpInf');
    let node = null, path = '', status = 'mapped';
    if (['CHQB', 'HOLD', 'PHOB', 'TELB'].includes(code)) { node = E('InstrForCdtrAgt', [E('Cd', code), info ? E('InstrInf', info) : null]); tx.add(node); path = 'InstrForCdtrAgt/Cd'; }
    else if (['PHON', 'TELE', 'PHOI', 'TELI'].includes(code)) { const c2 = code.startsWith('PHO') ? 'PHOA' : 'TELA'; node = E('InstrForNxtAgt', [E('Cd', c2), info ? E('InstrInf', info) : null]); tx.add(node); path = 'InstrForNxtAgt/Cd'; status = 'transformed'; }
    else if (code === 'REPA') { node = E('InstrForNxtAgt', [E('InstrInf', 'REPA' + (info ? '/' + info : ''))]); tx.add(node); path = 'InstrForNxtAgt/InstrInf'; status = 'review'; }
    else if (code === 'SDVA') { node = E('SvcLvl', [E('Cd', 'SDVA')]); pt().add(node); path = 'PmtTpInf/SvcLvl/Cd'; }
    else if (code === 'INTC' || code === 'CORT') { node = E('CtgyPurp', [E('Cd', code)]); pt().add(node); path = 'PmtTpInf/CtgyPurp/Cd'; }
    row({ rule: node ? 'MAP-70' : 'MAP-99', tag: '23E', mtLines: f.lineNos, mtValue: f.value, path: path || '(none)', value: node ? code : '', status: node ? status : 'lost', node, note: node ? 'Instruction code (our documented choice of target).' : `Instruction code ${code} has no place in this simplified mapping.` });
  }

  // 32A (MAP-10)
  if (f32 && m32) {
    const ccy = m32[2], amt = amountToIso(m32[3]);
    const dec = (m32[3].split(',')[1] || '').length;
    if (dec > minorUnits(ccy)) fail('MAP-10', f32.line, `${ccy} has ${minorUnits(ccy)} decimals, but the amount has ${dec}.`, `Round the amount to ${minorUnits(ccy)} decimals.`, 'The receiving bank cannot book a fraction of the smallest unit.');
    // Daniel (PORT-41 10668): a zero amount and a value date more than a year away are read, but a person must look
    const zero = amt && !/[1-9]/.test(amt);
    if (amt) { const x = put(tx, E('IntrBkSttlmAmt', { Ccy: ccy }, amt)); row({ rule: 'MAP-10', tag: '32A', mtLines: [f32.line], mtValue: m32[2] + m32[3], path: 'IntrBkSttlmAmt', value: `${amt} ${ccy}`, status: zero ? 'review' : 'transformed', node: x, note: zero ? 'The amount is zero. A customer transfer of nothing is almost always a mistake.' : 'Decimal comma becomes a decimal point.', fix: zero ? 'Check the amount with the ordering customer.' : undefined }); }
    if (vd) {
      const days = Math.round((Date.parse(vd + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / 86400000), far = Math.abs(days) > 366;
      const x = put(tx, E('IntrBkSttlmDt', vd));
      row({ rule: 'MAP-10', tag: '32A', mtLines: [f32.line], mtValue: m32[1], path: 'IntrBkSttlmDt', value: vd, status: far ? 'review' : 'transformed', node: x, note: far ? `YYMMDD read as ${vd}, which is more than a year ${days > 0 ? 'ahead' : 'ago'}. Check the year.` : 'YYMMDD becomes YYYY-MM-DD, read as 20YY (our choice).', fix: far ? 'Correct the value date in :32A:.' : undefined });
    }
  }
  // 13C (MAP-12)
  for (const f of fieldsOf(/^13C$/)) {
    use(f); const m = /^\/(CLSTIME|RNCTIME|SNDTIME)\/(\d{2})(\d{2})([+-])(\d{2})(\d{2})$/.exec(f.lines[0]);
    if (!m) { row({ rule: 'MAP-12', tag: '13C', mtLines: f.lineNos, mtValue: f.value, path: '(none)', value: '', status: 'lost', note: 'Time indication not in the form /CODE/hhmm+hhmm, so it was not mapped.' }); continue; }
    const t = `${m[2]}:${m[3]}:00${m[4]}${m[5]}:${m[6]}`;
    let node, p;
    if (m[1] === 'CLSTIME') { node = E('CLSTm', t); tx.ensure('SttlmTmReq').add(node); p = 'SttlmTmReq/CLSTm'; }
    else { node = E(m[1] === 'SNDTIME' ? 'DbtDtTm' : 'CdtDtTm', `${vd || '2000-01-01'}T${t}`); tx.ensure('SttlmTmIndctn').add(node); p = 'SttlmTmIndctn/' + node.name; }
    row({ rule: 'MAP-12', tag: '13C', mtLines: f.lineNos, mtValue: f.value, path: p, value: node.text, status: 'transformed', node, note: 'Time indication (our documented choice of target).' });
  }
  // 33B, 36 (MAP-11)
  const f33 = field('33B'), f36 = field('36');
  if (f33) {
    use(f33); const m = /^([A-Z]{3})(.*)$/.exec(f33.lines[0]); const a = m && amountToIso(m[2]);
    if (a) { const x = put(tx, E('InstdAmt', { Ccy: m[1] }, a)); row({ rule: 'MAP-11', tag: '33B', mtLines: [f33.line], mtValue: f33.value, path: 'InstdAmt', value: `${a} ${m[1]}`, status: 'transformed', node: x, note: 'Instructed amount, decimal comma becomes a point.' }); }
    if (m && m32 && m[1] !== m32[2] && !f36) fail('MAP-11', f33.line, `The instructed currency ${m[1]} differs from the settled currency ${m32[2]}, but there is no exchange rate :36:.`, 'Add field 36 with the rate used.', 'Without the rate the two amounts cannot be reconciled.');
  }
  if (f36) {
    const m33 = f33 && /^([A-Z]{3})/.exec(f33.lines[0]);
    if (!m33 || (m32 && m33[1] === m32[2])) fail('MAP-11', f36.line, m33 ? `An exchange rate :36: is given, but :33B: has the same currency as :32A: (${m32[2]}).` : 'An exchange rate :36: is given without an instructed amount :33B:.', 'Remove :36:, or check the currencies.', 'A rate only makes sense when two different currencies are involved.');
  }
  if (f36) { use(f36); const r = f36.lines[0].replace(',', '.').replace(/\.$/, ''); const x = put(tx, E('XchgRate', r)); row({ rule: 'MAP-11', tag: '36', mtLines: [f36.line], mtValue: f36.value, path: 'XchgRate', value: r, status: 'transformed', node: x, note: 'Exchange rate, decimal comma becomes a point (our choice).' }); }

  // 71A, 71F, 71G (MAP-61)
  const f71 = field('71A');
  const f71F = fieldsOf(/^71F$/), f71G = field('71G');
  if (f71) {
    use(f71); const c = { OUR: 'DEBT', SHA: 'SHAR', BEN: 'CRED' }[f71.lines[0]];
    if (c) { const x = put(tx, E('ChrgBr', c)); row({ rule: 'MAP-61', tag: '71A', mtLines: [f71.line], mtValue: f71.lines[0], path: 'ChrgBr', value: c, status: 'transformed', node: x, note: `${f71.lines[0]} means ${c === 'DEBT' ? 'the payer pays all charges' : c === 'SHAR' ? 'each side pays its own bank' : 'the beneficiary pays all charges'}.` }); }
    const v = f71.lines[0];
    if (v === 'BEN' && !f71F.length) fail('MAP-61', f71.line, 'With BEN, at least one :71F: (charges taken) is expected.', 'Add the sender\'s charges as :71F:.', 'The beneficiary would not see what was deducted.');
    if (v === 'OUR' && f71F.length) fail('MAP-61', f71F[0].line, 'With OUR, no :71F: is expected: the payer pays all charges.', 'Remove :71F:, or check 71A.', 'The charge information contradicts itself.');
    if (v !== 'OUR' && f71G) fail('MAP-61', f71G.line, `:71G: (receiver's charges) is only used with OUR, not ${v}.`, 'Remove :71G:, or check 71A.', 'The charge information contradicts itself.');
  }
  const charge = (f, agentBic, who) => {
    use(f); const m = /^([A-Z]{3})(.*)$/.exec(f.lines[0]); const a = m && amountToIso(m[2]); if (!a) return;
    const node = E('ChrgsInf', [E('Amt', { Ccy: m[1] }, a), E('Agt', [fi(agentBic || 'NOTPROVIDED')])]); tx.add(node);
    row({ rule: 'MAP-61', tag: f.tag, mtLines: [f.line], mtValue: f.value, path: 'ChrgsInf', value: `${a} ${m[1]}, agent ${agentBic || '?'}`, status: 'transformed', node, note: `Charges amount unchanged, decimal comma becomes a point. The agent is the ${who} (our documented choice: only licensed rules confirm which bank goes here).` });
  };
  f71F.forEach((f) => charge(f, sender, 'sender'));
  if (f71G) charge(f71G, receiver, 'receiver');

  // previous instructing agent from 72 /INS/ is placed later; agents
  const agentFrom = (f, parentName, accName) => {
    use(f); const L = f.lines.slice(); let acct = null;
    if (L[0] && L[0].startsWith('/') && (f.tag.endsWith('A') || f.tag.endsWith('D') || f.tag.endsWith('B') || f.tag.endsWith('C'))) {
      if (f.tag.endsWith('C') || L.length > 1 || f.tag.endsWith('B')) acct = L.shift();
    }
    const node = E(parentName); let status = 'mapped', note = FIELDS[f.tag] + '.';
    if (f.tag.endsWith('A')) node.add(fi(L[L.length - 1]));
    else if (f.tag.endsWith('D')) { node.add(E('FinInstnId', [E('Nm', L[0] || ''), L.length > 1 ? E('PstlAdr', L.slice(1).map((l) => E('AdrLine', l))) : null])); status = 'review'; note = 'Name and address of a bank without a BIC: kept as name and address lines. Use a BIC where possible.'; }
    else if (f.tag.endsWith('C')) { node.add(E('FinInstnId', [E('ClrSysMmbId', [E('MmbId', (acct || '').replace(/^\/\/?/, '').slice(0, 35) || 'NOTPROVIDED')])])); status = 'review'; note = 'Clearing code without a BIC: the clearing system must be added by a person.'; acct = null; }
    else if (f.tag.endsWith('B')) { status = 'review'; note = 'Location only, no BIC: the bank cannot be identified this way in pacs.008.'; node.add(E('FinInstnId', [E('Nm', L[0] || 'NOTPROVIDED')])); }
    return { node, acct, status, note };
  };
  const acctNode = (name, raw) => { const id = raw.replace(/^\/(?:[CD]\/)?/, ''); return ibanIsValid(id) && /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(id) ? E(name, [E('Id', [E('IBAN', id)])]) : E(name, [E('Id', [E('Othr', [E('Id', id.slice(0, 34))])])]); };

  // 53a, 54a, 55A (MAP-30)
  const reimb = (f, nm, accNm) => {
    if (!f) return;
    if (f.tag === '53B') { use(f); const a = acctNode('SttlmAcct', f.lines[0]); sttl.add(a); row({ rule: 'MAP-30', tag: f.tag, mtLines: f.lineNos, mtValue: f.value, path: 'SttlmInf/SttlmAcct', value: f.lines[0].replace(/^\//, ''), status: 'review', node: a, note: 'Account of the sender at the receiver: kept as the settlement account. Check it.' }); return; }
    const a = agentFrom(f, nm); sttl.add(a.node);
    if (a.acct) sttl.add(acctNode(accNm, a.acct));
    row({ rule: 'MAP-30', tag: f.tag, mtLines: f.lineNos, mtValue: f.value, path: 'SttlmInf/' + nm, value: f.lines[f.lines.length - 1], status: f.tag === '55A' ? 'review' : a.status, node: a.node, note: f.tag === '55A' ? 'Third reimbursement institution (our documented choice of target).' : a.note });
  };
  reimb(f53, 'InstgRmbrsmntAgt', 'InstgRmbrsmntAgtAcct'); reimb(f54, 'InstdRmbrsmntAgt', 'InstdRmbrsmntAgtAcct'); reimb(f55, 'ThrdRmbrsmntAgt', 'ThrdRmbrsmntAgtAcct');
  sortBy(sttl, ORDERS.SttlmInf);

  // 72 /INS/ with a BIC -> PrvsInstgAgt1 (handled with 72 below, but placed here in order)
  // InstgAgt / InstdAgt (MAP-05)
  if (sender) { const x = put(tx, E('InstgAgt', [fi(sender)])); row({ rule: 'MAP-05', tag: '{1:', mtLines: [senderLine], mtValue: b2 && b2.raw.startsWith('O') ? b2.raw : b1.raw, path: 'InstgAgt', value: sender, status: 'mapped', node: x, note: 'Sender BIC: characters 1 to 8 and 10 to 12 of the header address.' }); }
  if (receiver) { const x = put(tx, E('InstdAgt', [fi(receiver)])); row({ rule: 'MAP-05', tag: '{2:', mtLines: [receiverLine], mtValue: b2 && b2.raw.startsWith('I') ? b2.raw : b1.raw, path: 'InstdAgt', value: receiver, status: 'mapped', node: x, note: 'Receiver BIC: characters 1 to 8 and 10 to 12 of the header address.' }); }
  if (!b1 && !b2) row({ rule: 'MAP-05', tag: null, mtValue: '(no blocks 1 and 2)', path: 'InstgAgt, InstdAgt', value: '(not written)', status: 'review', note: 'Only block 4 was given, so sender and receiver are unknown.' });

  // 56a (MAP-31)
  const f56 = fieldsOf(/^56[ACD]$/)[0];
  if (f56) { const a = agentFrom(f56, 'IntrmyAgt1'); tx.add(a.node); if (a.acct) tx.add(acctNode('IntrmyAgt1Acct', a.acct)); row({ rule: 'MAP-31', tag: f56.tag, mtLines: f56.lineNos, mtValue: f56.value, path: 'IntrmyAgt1', value: f56.lines[f56.lines.length - 1], status: a.status, node: a.node, note: a.note }); }

  // parties (MAP-20, MAP-40, MAP-50)
  const party = (f, P, accName) => {
    if (!f) return;
    use(f);
    const node = E(P); tx.add(node);
    const L = f.lines.slice(); const lines0 = f.lineNos.slice();
    let acct = null, acctLine = null;
    if (f.tag.endsWith('F') && L[0] && !L[0].startsWith('/') && /^[A-Z]{4}\//.test(L[0])) {
      const idl = L.shift(); const ln = lines0.shift();
      row({ rule: 'MAP-20', tag: f.tag, mtLines: [ln], mtValue: idl, path: '(none)', value: '', status: 'lost', note: 'Party identifier (code/country/number): not mapped in this simplified version.' });
    } else if (L[0] && L[0].startsWith('/') && (L.length > 1 || f.tag === '59')) { acct = L.shift(); acctLine = lines0.shift(); }
    const rule = P === 'Dbtr' ? 'MAP-20' : 'MAP-40';
    if (f.tag.endsWith('A')) {
      const id = E('Id', [E('OrgId', [E('AnyBIC', L[L.length - 1])])]); node.add(id);
      row({ rule, tag: f.tag, mtLines: [lines0[lines0.length - 1]], mtValue: L[L.length - 1], path: P + '/Id/OrgId/AnyBIC', value: L[L.length - 1], status: 'mapped', node: id, note: 'Party identified by its BIC.' });
      row({ rule, tag: f.tag, mtLines: [f.line], mtValue: '(no name)', path: P + '/Nm', value: '(not written)', status: 'review', note: 'The MT gives only a BIC for this party, no name. Many receiving banks expect a name.', fix: 'Add the name if you know it.' });
    } else if (f.tag.endsWith('F')) {
      const names = [], adr = [], lost = []; let ctry = null, town = null;
      L.forEach((l, k) => {
        const m = /^(\d)\/(.*)$/.exec(l); const ln = lines0[k];
        if (!m) { lost.push([ln, l]); return; }
        if (m[1] === '1') names.push([ln, m[2]]);
        else if (m[1] === '2') adr.push([ln, m[2]]);
        else if (m[1] === '3') { const [c, ...t] = m[2].split('/'); ctry = [ln, c]; if (t.length) town = [ln, t.join('/')]; }
        else lost.push([ln, l]);
      });
      if (names.length) { const v = names.map((x) => x[1]).join(' '); const x = E('Nm', v); node.add(x); row({ rule, tag: f.tag, mtLines: names.map((x) => x[0]), mtValue: names.map((x) => '1/' + x[1]).join(' '), path: P + '/Nm', value: v, status: names.length > 1 ? 'transformed' : 'mapped', node: x, note: names.length > 1 ? 'Name lines joined with a space.' : 'Name.' }); }
      if (adr.length || ctry) {
        const pa = E('PstlAdr'); node.add(pa);
        if (town) { const x = E('TwnNm', town[1]); pa.add(x); row({ rule, tag: f.tag, mtLines: [town[0]], mtValue: '3/…/' + town[1], path: P + '/PstlAdr/TwnNm', value: town[1], status: 'mapped', node: x, note: 'Town, from line 3.' }); }
        if (ctry) { const x = E('Ctry', ctry[1]); pa.add(x); row({ rule, tag: f.tag, mtLines: [ctry[0]], mtValue: '3/' + ctry[1], path: P + '/PstlAdr/Ctry', value: ctry[1], status: 'mapped', node: x, note: 'Country, from line 3.' }); }
        for (const [ln, v] of adr) { const x = E('AdrLine', v); pa.add(x); row({ rule, tag: f.tag, mtLines: [ln], mtValue: '2/' + v, path: P + '/PstlAdr/AdrLine', value: v, status: 'mapped', node: x, note: 'Address line (with town and country: a hybrid address).' }); }
        sortBy(pa, ORDERS.PstlAdr);
        if (!town || !ctry) fail('MAP-50', f.line, `The ${P === 'Dbtr' ? 'ordering customer' : 'beneficiary'} has no ${!town ? 'town' : 'country'} in line 3.`, 'Write line 3 as 3/CC/TOWN, for example 3/FR/LYON.', 'Cross-border messages need at least town and country (see the Swift FAQ in the sources).');
      }
      for (const [ln, v] of lost) row({ rule, tag: f.tag, mtLines: [ln], mtValue: v, path: '(none)', value: '', status: 'lost', note: 'Birth details, identity numbers and other numbered lines are not mapped in this simplified version.' });
    } else {
      // 50K or 59: first line name, rest free-text address (MAP-50)
      if (L.length) { const x = E('Nm', L[0]); node.add(x); row({ rule, tag: f.tag, mtLines: [lines0[0]], mtValue: L[0], path: P + '/Nm', value: L[0], status: 'mapped', node: x, note: 'First line taken as the name (our choice).' }); }
      const adrL = L.slice(1), adrN = lines0.slice(1);
      if (adrL.length) {
        const g = guessAddress(adrL);
        const pa = E('PstlAdr'); node.add(pa);
        if (g) {
          if (g.pc) pa.add(E('PstCd', g.pc));
          if (g.sub) pa.add(E('CtrySubDvsn', g.sub));
          const tw = E('TwnNm', g.town), ct = E('Ctry', g.ctry); pa.add([tw, ct]);
          g.rest.forEach((l) => pa.add(E('AdrLine', l)));
          sortBy(pa, ORDERS.PstlAdr);
          row({ rule: 'MAP-50', tag: f.tag, mtLines: adrN, mtValue: adrL.join(' | '), path: P + '/PstlAdr', value: [g.pc && 'PstCd ' + g.pc, 'TwnNm ' + g.town, g.sub && 'CtrySubDvsn ' + g.sub, 'Ctry ' + g.ctry, g.rest.length && g.rest.length + ' AdrLine'].filter(Boolean).join(', '), status: 'review', node: pa,
            note: `${P === 'Dbtr' ? 'Ordering customer' : 'Beneficiary'} address is free text. We found town "${g.town}" and country "${g.ctry}" and built a hybrid address with the other lines kept as address lines. Check them.`,
            why: 'Cross-border messages on the Swift network need at least town and country as separate fields (see the Swift FAQ in the sources).', fix: 'Confirm the town and country, or correct them.' });
        } else {
          adrL.forEach((l) => pa.add(E('AdrLine', l)));
          row({ rule: 'MAP-50', tag: f.tag, mtLines: adrN, mtValue: adrL.join(' | '), path: P + '/PstlAdr/AdrLine', value: adrL.length + ' address line(s), no town or country', status: 'review', node: pa, note: 'No town and country could be found: the address stays free text.' });
          fail('MAP-50', adrN[0], `The ${P === 'Dbtr' ? 'ordering customer' : 'beneficiary'} address is free text and no town and country were found in it.`, 'Add a line with the postcode and town, and a line with the country code, or use the structured option (50F or 59F).', 'Cross-border messages on the Swift network no longer accept fully free-text addresses (see the Swift FAQ in the sources).');
        }
      }
    }
    sortBy(node, ORDERS.Party);
    if (acct) { const a = acctNode(accName, acct); tx.add(a); const id = acct.replace(/^\/(?:[CD]\/)?/, ''); const iban = !!a.get('Id').get('IBAN'), badIban = !iban && /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(id) && COUNTRIES.has(id.slice(0, 2)); row({ rule, tag: f.tag, mtLines: [acctLine], mtValue: acct, path: accName + (iban ? '/Id/IBAN' : '/Id/Othr/Id'), value: id, status: badIban ? 'review' : 'mapped', node: a, note: iban ? 'Account is a valid IBAN.' : badIban ? `Account ${id} looks like an IBAN, but its check digits are wrong, so it is written as another account identifier.` : 'Account is not a valid IBAN, so it is written as another account identifier.', fix: badIban ? 'Check the account number with the customer: one character is probably mistyped.' : undefined }); }
  };
  party(fieldsOf(/^50[AFK]$/)[0], 'Dbtr', 'DbtrAcct');

  // 52a (MAP-21)
  const f52 = fieldsOf(/^52[AD]$/)[0];
  if (f52) { const a = agentFrom(f52, 'DbtrAgt'); tx.add(a.node); if (a.acct) tx.add(acctNode('DbtrAgtAcct', a.acct)); row({ rule: 'MAP-21', tag: f52.tag, mtLines: f52.lineNos, mtValue: f52.value, path: 'DbtrAgt', value: f52.lines[f52.lines.length - 1], status: a.status, node: a.node, note: a.note }); }
  else if (sender) { const x = E('DbtrAgt', [fi(sender)]); tx.add(x); row({ rule: 'MAP-21', tag: null, mtLines: senderLine ? [senderLine] : [], mtValue: '(no :52a:)', path: 'DbtrAgt', value: sender, status: 'defaulted', node: x, note: 'No ordering institution, so the sender (block 1) is the debtor agent.' }); }
  else fail('MAP-21', 1, 'The debtor agent is unknown: there is no :52a: and no block 1.', 'Add block 1 with the sender address, or :52A:.', 'DbtrAgt is mandatory in pacs.008.');

  // 57a (MAP-31)
  const f57 = fieldsOf(/^57[ABCD]$/)[0];
  if (f57) { const a = agentFrom(f57, 'CdtrAgt'); tx.add(a.node); if (a.acct) tx.add(acctNode('CdtrAgtAcct', a.acct)); row({ rule: 'MAP-31', tag: f57.tag, mtLines: f57.lineNos, mtValue: f57.value, path: 'CdtrAgt', value: f57.lines[f57.lines.length - 1], status: a.status, node: a.node, note: a.note }); }
  else if (receiver) { const x = E('CdtrAgt', [fi(receiver)]); tx.add(x); row({ rule: 'MAP-31', tag: null, mtLines: receiverLine ? [receiverLine] : [], mtValue: '(no :57a:)', path: 'CdtrAgt', value: receiver, status: 'defaulted', node: x, note: 'No beneficiary\'s bank, so the receiver (block 2) is the creditor agent.' }); }
  else fail('MAP-31', 1, 'The creditor agent is unknown: there is no :57a: and no block 2.', 'Add block 2 with the receiver address, or :57A:.', 'CdtrAgt is mandatory in pacs.008.');

  party(fieldsOf(/^59[AF]?$/)[0], 'Cdtr', 'CdtrAcct');

  // 72 (MAP-72)
  const f72 = field('72');
  if (f72) {
    use(f72);
    const items = []; // [code, text, lines]
    f72.lines.forEach((l, k) => {
      const ln = f72.lineNos[k]; const m = /^\/([A-Z0-9]{1,8})\/(.*)$/.exec(l);
      if (l.startsWith('//') && items.length) { const it = items[items.length - 1]; it[1] += ' ' + l.slice(2); it[2].push(ln); }
      else if (m) items.push([m[1], m[2], [ln]]);
      else if (items.length && !items[items.length - 1][0]) { const it = items[items.length - 1]; it[1] += ' ' + l; it[2].push(ln); }
      else items.push([null, l, [ln]]);
    });
    for (const [code, txt, lns] of items) {
      const val = (code && !['ACC', 'INS', 'INT', 'REC'].includes(code) ? '/' + code + '/' : '') + txt;
      if (code === 'INS' && BIC.test(txt.trim())) { const x = E('PrvsInstgAgt1', [fi(txt.trim())]); tx.add(x); row({ rule: 'MAP-72', tag: '72', mtLines: lns, mtValue: '/INS/' + txt, path: 'PrvsInstgAgt1', value: txt.trim(), status: 'transformed', node: x, note: 'Instructing institution BIC becomes the previous instructing agent (our documented choice).' }); continue; }
      const cut = val.length > 140; const v = val.slice(0, 140);
      const name = code === 'ACC' ? 'InstrForCdtrAgt' : 'InstrForNxtAgt';
      const x = E(name, [E('InstrInf', v)]); tx.add(x);
      row({ rule: 'MAP-72', tag: '72', mtLines: lns, mtValue: (code ? '/' + code + '/' : '') + txt, path: name + '/InstrInf', value: v, status: cut ? 'lost' : 'review', node: x,
        note: cut ? `Text of ${val.length} characters cut to 140.` : `${code ? '/' + code + '/ text' : 'Free text'} kept as instruction text for the ${code === 'ACC' ? 'creditor agent' : 'next agent'}. It is not machine-readable: check that the receiver reads it.`,
        fix: 'Where the instruction has a code in pacs.008 (for example PHOA, TELA, CHQB), use the code instead of text.' });
    }
  }
  // 26T (MAP-13)
  const f26 = field('26T');
  if (f26) { use(f26); const x = E('Purp', [E('Prtry', f26.lines[0])]); tx.add(x); row({ rule: 'MAP-13', tag: '26T', mtLines: [f26.line], mtValue: f26.value, path: 'Purp/Prtry', value: f26.lines[0], status: 'review', node: x, note: 'Transaction type code kept as a proprietary purpose. Choose the matching ISO purpose code.' }); }
  // 77B (MAP-77)
  const f77 = field('77B');
  if (f77) { use(f77); const x = E('RgltryRptg', [E('Dtls', f77.lines.map((l) => E('Inf', l)))]); tx.add(x); row({ rule: 'MAP-77', tag: '77B', mtLines: f77.lineNos, mtValue: f77.value, path: 'RgltryRptg/Dtls/Inf', value: f77.lines.join(' '), status: 'review', node: x, note: 'Regulatory reporting kept as text. The ISO structure (authority, type, code, amount) is richer: check it.' }); }
  // 70 (MAP-60)
  const f70 = field('70');
  if (f70) {
    use(f70);
    let v = f70.lines.join(' '); const glued = v.length > 140; if (glued) v = f70.lines.join('');
    const x = E('RmtInf', [E('Ustrd', v)]); tx.add(x);
    const codes = [...new Set((v.match(/\/(INV|RFB|ROC|IPI|RFF|TSU)\//g) || []))];
    row({ rule: 'MAP-60', tag: '70', mtLines: f70.lineNos, mtValue: f70.value, path: 'RmtInf/Ustrd', value: v, status: codes.length || glued ? 'review' : f70.lines.length > 1 ? 'transformed' : 'mapped', node: x,
      note: glued ? 'The 4 full lines only fit in 140 characters when joined without spaces, so a word split across two lines is kept whole but two words may be glued together: check the text.' + (codes.length ? ` It also holds the codes ${codes.join(' ')}.` : '') : codes.length ? `Kept as unstructured text. It holds the codes ${codes.join(' ')}, which could become structured remittance (invoice or creditor reference): check with the receiver.` : f70.lines.length > 1 ? 'Lines joined into one text of at most 140 characters: nothing is cut.' : 'Remittance information.' });
  }
  // everything else (MAP-99)
  for (const f of mt.fields) if (!used.has(f)) row({ rule: 'MAP-99', tag: f.tag, mtLines: f.lineNos, mtValue: f.value, path: '(none)', value: '', status: 'lost', note: FIELDS[f.tag] ? `${FIELDS[f.tag]} (:${f.tag}:) has no place in this simplified mapping.` : `:${f.tag}: is not an MT103 field.` });
  for (const b of mt.blocks.b5 || []) row({ rule: 'MAP-99', tag: '{5:', mtLines: [b.line], mtValue: `{${b.tag}:${b.value}}`, path: '(none)', value: '', status: 'lost', note: 'Trailer (block 5): network checks, not business content. Not carried into pacs.008.' });

  // P3: every MT field has at least one row
  for (const f of mt.fields) if (!rows.some((r) => r.tag === f.tag && r.mtLines.some((l) => f.lineNos.includes(l)))) row({ rule: 'MT', tag: f.tag, mtLines: f.lineNos, mtValue: f.value, path: '(none)', value: '', status: 'review', note: `:${f.tag}: could not be converted because of the error found in it.` });

  // finish: element order, XML, lines
  const pt = tx.get('PmtTpInf'); if (pt) sortBy(pt, ORDERS.PmtTpInf);
  const order = (k) => TX_ORDER.indexOf(k.name);
  tx.kids.sort((a, b) => order(a) - order(b));
  const xml = serialize(doc);
  for (const r of rows) { r.xmlLine = r.node ? r.node.line : null; r.xmlEnd = r.node ? r.node.end : null; }

  // findings
  const findings = errors.map((e) => ({ severity: 'error', rule: e.rule, mtLine: e.mtLine || null, xmlLine: null, message: e.message, why: e.why || null, fix: e.fix || null }));
  for (const r of rows) {
    if (r.status === 'review' || r.status === 'lost' || (r.status === 'defaulted' && r.rule !== 'MAP-04')) {
      if (r.rule === 'MAP-03' || (r.rule === 'MAP-50' && errors.some((e) => e.rule === 'MAP-50' && r.mtLines.includes(e.mtLine)))) continue; // already an error
      findings.push({ severity: r.status === 'defaulted' ? 'info' : 'review', status: r.status, rule: r.rule, mtLine: r.mtLines[0] || null, xmlLine: r.xmlLine, message: r.note, why: r.why || null, fix: r.fix || null, row: r.n });
    }
  }
  const SEV = { error: 0, review: 1, info: 2 };
  findings.sort((a, b) => SEV[a.severity] - SEV[b.severity] || (a.mtLine || 0) - (b.mtLine || 0));
  const counts = { mapped: 0, transformed: 0, defaulted: 0, lost: 0, review: 0 };
  rows.forEach((r) => counts[r.status]++);
  const nErr = errors.length, nRev = counts.review;
  const verdict = nErr ? REJECTED : nRev ? 'Needs review' : counts.lost ? 'Converted with warnings' : 'Clean';
  const facts = { uetr: u121 ? u121.value : null, ref, valueDate: vd, amount: m32 ? `${m32[2]} ${amountToIso(m32[3]) || m32[3]}` : null };
  return { mt, rows, findings, errors, counts, verdict, facts, xml, tool: MAP_TOOL, catalogue: MAP_CATALOGUE_VERSION, xsd: MX.id };
}

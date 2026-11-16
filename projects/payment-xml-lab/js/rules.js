// SEPA Credit Transfer rule catalogue for pain.001.001.09 (layer 3).
// One data list drives the finding cards, the catalogue page and the JUnit export.
// Rules are written in our own words; sources are credited and linked, not copied.
import { kid, kids, path, text, all } from './tree.js';

export const CATALOGUE_VERSION = '2026.11-mvp1';

export const SOURCES = {
  iso: { name: 'ISO 20022 pain.001.001.09 message definition', url: 'https://www.iso20022.org/iso-20022-message-definitions' },
  epc: { name: 'EPC SEPA Credit Transfer customer-to-bank implementation guidelines', url: 'https://www.europeanpaymentscouncil.eu/what-we-do/epc-payment-schemes/sepa-credit-transfer/sepa-credit-transfer-rulebook-and' },
  iban: { name: 'ISO 13616 IBAN: length per country and mod-97 check digits', url: 'https://www.swift.com/standards/data-standards/iban-international-bank-account-number' },
  bic: { name: 'ISO 9362 BIC structure', url: 'https://www.swift.com/standards/data-standards/bic-business-identifier-code' },
  t2: { name: 'TARGET closing days (European Central Bank)', url: 'https://www.ecb.europa.eu/paym/target/html/index.en.html' },
  gp: { name: 'Common bank practice, not a guideline requirement', url: null },
};

// ---------- reference data ----------
export const IBAN_LENGTH = { AD: 24, AE: 23, AL: 28, AT: 20, AZ: 28, BA: 20, BE: 16, BG: 22, BH: 22, BI: 27, BR: 29, BY: 28, DJ: 27, FK: 18, HN: 28, LY: 25, MN: 20, NI: 28, OM: 23, RU: 33, SD: 18, SO: 23, YE: 30, CH: 21, CR: 22, CY: 28, CZ: 24, DE: 22, DK: 18, DO: 28, EE: 20, EG: 29, ES: 24, FI: 18, FO: 18, FR: 27, GB: 22, GE: 22, GI: 23, GL: 18, GR: 27, GT: 28, HR: 21, HU: 28, IE: 22, IL: 23, IQ: 23, IS: 26, IT: 27, JO: 30, KW: 30, KZ: 20, LB: 28, LC: 32, LI: 21, LT: 20, LU: 20, LV: 21, MC: 27, MD: 24, ME: 22, MK: 19, MR: 27, MT: 31, MU: 30, NL: 18, NO: 15, PK: 24, PL: 28, PS: 29, PT: 25, QA: 29, RO: 24, RS: 22, SA: 24, SC: 31, SE: 24, SI: 19, SK: 24, SM: 27, ST: 25, SV: 28, TL: 23, TN: 24, TR: 26, UA: 29, VA: 22, VG: 24, XK: 20 };
// ISO 3166 alpha-2 (current), for the country part of a BIC
const COUNTRIES = new Set('AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW'.split(' '));
// EPC basic Latin character set, in our words: a-z A-Z 0-9 / - ? : ( ) . , ' + and space
const SEPA_CHAR = /[A-Za-z0-9/\-?:().,'+ ]/;

// ---------- helpers ----------
export function ibanIsValid(iban) {
  const s = iban.replace(/\s+/g, '').toUpperCase();
  const r = s.slice(4) + s.slice(0, 4);
  let rem = 0;
  for (const ch of r) {
    const v = ch >= '0' && ch <= '9' ? ch : String(ch.charCodeAt(0) - 55);
    for (const d of v) rem = (rem * 10 + (d.charCodeAt(0) - 48)) % 97;
  }
  return rem === 1;
}
export function ibanWithCheck(country, bban) { // builds a valid IBAN for test data
  const r = bban + country + '00';
  let rem = 0;
  for (const ch of r) { const v = ch >= '0' && ch <= '9' ? ch : String(ch.charCodeAt(0) - 55); for (const d of v) rem = (rem * 10 + (d.charCodeAt(0) - 48)) % 97; }
  return country + String(98 - rem).padStart(2, '0') + bban;
}
export const groupIban = (s) => s.replace(/(.{4})/g, '$1 ').trim();
// exact money: BigInt scaled to 10^5 (the pain.001 maximum of 5 decimals)
export const SCALE = 5;
export function money(s) {
  if (s == null || !/^\d+(\.\d+)?$/.test(s)) return null;
  const [i, f = ''] = s.split('.');
  if (f.length > SCALE) return null;
  return BigInt(i + f.padEnd(SCALE, '0'));
}
export function euro(v, minDec = 2) { // 115025500n -> "1,150.255" (dot decimals as in the file)
  let s = v.toString().padStart(SCALE + 1, '0');
  let int = s.slice(0, -SCALE), frac = s.slice(-SCALE).replace(/0+$/, '');
  if (frac.length < minDec) frac = frac.padEnd(minDec, '0');
  int = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return frac ? int + '.' + frac : int;
}
function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25),
    g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4,
    l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451),
    month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return Date.UTC(y, month - 1, day);
}
export function targetClosed(iso) {
  const [y, mo, d] = iso.split('-').map(Number);
  const t = Date.UTC(y, mo - 1, d), wd = new Date(t).getUTCDay();
  if (wd === 0) return 'a Sunday';
  if (wd === 6) return 'a Saturday';
  const md = mo + '-' + d, e = easter(y), DAY = 86400000;
  if (md === '1-1') return 'New Year\'s Day';
  if (md === '5-1') return 'Labour Day (1 May)';
  if (md === '12-25') return 'Christmas Day';
  if (md === '12-26') return '26 December';
  if (t === e - 2 * DAY) return 'Good Friday';
  if (t === e + DAY) return 'Easter Monday';
  return null;
}
export function addDays(iso, n) { return new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10); }
export function nextBusinessDay(iso) { let d = addDays(iso, 1); while (targetClosed(d)) d = addDays(d, 1); return d; }
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || '') && !Number.isNaN(Date.parse(v + 'T00:00:00Z'));
const short = (v, n = 50) => (v.length > n ? v.slice(0, n) + '…' : v);
const execDateEl = (pi) => path(pi, 'ReqdExctnDt', 'Dt') || path(pi, 'ReqdExctnDt', 'DtTm');
const amtEl = (tx) => path(tx, 'Amt', 'InstdAmt');
const pmtId = (pi) => text(kid(pi, 'PmtInfId')) || '';

function sumCheck(el, txs, where) {
  const want = money(text(el)); if (want == null) return [];
  const amounts = txs.map((tx) => money(text(amtEl(tx)))).filter((v) => v != null);
  const sum = amounts.reduce((s, a) => s + a, 0n);
  if (sum === want) return [];
  return [{ el, message: `The control sum for ${where} says ${euro(want)}, but the ${amounts.length} amounts add up to ${euro(sum)}.`, expected: euro(sum).replace(/,/g, ''), found: text(el), fix: 'Correct the control sum, or find the amount that was added, removed or changed.' }];
}

// check(ctx) returns findings { el, message, expected?, found?, fix }
// ctx: { root, pmtInfs, txs, procDate }
export const RULES = [
  {
    id: 'SCT-01', title: 'Number of payments in the group header matches the file', severity: 'error', source: 'iso',
    good: '<NbOfTxs>3</NbOfTxs> with 3 payments', bad: '<NbOfTxs>4</NbOfTxs> with 3 payments', scenario: 'header-count',
    check({ root, txs }) {
      const el = path(root, 'GrpHdr', 'NbOfTxs'); const n = text(el);
      if (!/^\d+$/.test(n || '') || Number(n) === txs.length) return [];
      return [{ el, message: `The group header says ${n} payment(s), but the file contains ${txs.length}.`, expected: String(txs.length), found: n, fix: 'Correct NbOfTxs, or add or remove the missing payments.' }];
    },
  },
  {
    id: 'SCT-02', title: 'Number of payments in each payment batch matches the batch', severity: 'error', source: 'iso',
    good: '<NbOfTxs>2</NbOfTxs> in a batch of 2', bad: '<NbOfTxs>5</NbOfTxs> in a batch of 2', scenario: 'batch-count',
    check({ pmtInfs }) {
      return pmtInfs.flatMap((pi) => {
        const el = kid(pi, 'NbOfTxs'); const n = text(el); const c = kids(pi, 'CdtTrfTxInf').length;
        return /^\d+$/.test(n || '') && Number(n) !== c ? [{ el, message: `Payment batch ${pmtId(pi)} says ${n} payment(s), but holds ${c}.`, expected: String(c), found: n, fix: 'Correct this NbOfTxs.' }] : [];
      });
    },
  },
  {
    id: 'SCT-03', title: 'Control sum in the group header equals the sum of all amounts', severity: 'error', source: 'iso',
    good: '<CtrlSum>1150.255</CtrlSum> for 500 + 500 + 150.255', bad: '<CtrlSum>1250.00</CtrlSum> for the same amounts', scenario: 'header-sum',
    check({ root, txs }) { return sumCheck(path(root, 'GrpHdr', 'CtrlSum'), txs, 'the file'); },
  },
  {
    id: 'SCT-04', title: 'Control sum in each payment batch equals its amounts', severity: 'error', source: 'iso',
    good: 'batch <CtrlSum> equal to its amounts', bad: 'batch <CtrlSum> 10.00 too high', scenario: 'batch-sum',
    check({ pmtInfs }) { return pmtInfs.flatMap((pi) => sumCheck(kid(pi, 'CtrlSum'), kids(pi, 'CdtTrfTxInf'), 'batch ' + pmtId(pi))); },
  },
  {
    id: 'SCT-05', title: 'IBAN has the right length for its country and valid mod-97 check digits', severity: 'error', source: 'iban',
    good: 'DE89370400440532013000', bad: 'DE89370400440532013001', scenario: 'iban-checksum',
    check({ root }) {
      const out = [];
      for (const el of all(root, 'IBAN')) {
        const v = text(el) || '';
        if (!/^[A-Z]{2}[0-9]{2}[a-zA-Z0-9]{1,30}$/.test(v)) continue; // the schema reports the format
        const cc = v.slice(0, 2), len = IBAN_LENGTH[cc];
        if (!len) out.push({ el, message: `The IBAN starts with "${cc}", which is not a country that issues IBANs.`, found: v, fix: 'The first two letters must be the country of the account.' });
        else if (v.length !== len) out.push({ el, message: `This IBAN has ${v.length} characters; ${cc} IBANs always have ${len}.`, expected: len + ' characters', found: groupIban(v), fix: 'A character is missing or extra: copy the IBAN again from its source.' });
        else if (!ibanIsValid(v)) out.push({ el, message: 'The IBAN check digits do not match the rest of the number, so at least one character is wrong.', expected: 'a number that passes the mod-97 test', found: groupIban(v), fix: 'Look for a typing mistake, often two swapped or changed digits near the end.' });
      }
      return out;
    },
  },
  {
    id: 'SCT-06', title: 'BIC is 8 or 11 characters with a real country code', severity: 'error', source: 'bic',
    good: 'XMPLDEFFXXX', bad: 'XMPLQQFFXXX (QQ is not a country)', scenario: 'bic-country',
    check({ root }) {
      return all(root, 'BICFI').filter((el) => {
        const v = text(el) || '';
        return /^[A-Z0-9]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(v) && !COUNTRIES.has(v.slice(4, 6));
      }).map((el) => ({ el, message: `Characters 5 and 6 of a BIC are its country, but "${text(el).slice(4, 6)}" is not a country code.`, found: text(el), fix: 'Check the BIC with the account holder\'s bank.' }));
    },
  },
  {
    id: 'SCT-07', title: 'Currency is EUR', severity: 'error', source: 'epc',
    good: 'Ccy="EUR"', bad: 'Ccy="USD"', scenario: 'currency',
    check({ txs }) {
      return txs.map(amtEl).filter((el) => el && el.getAttribute('Ccy') && el.getAttribute('Ccy') !== 'EUR')
        .map((el) => ({ el, message: `The amount is in ${el.getAttribute('Ccy')}. SEPA credit transfers are in euro only.`, expected: 'EUR', found: el.getAttribute('Ccy'), fix: 'Pay in EUR, or send it as an international (non-SEPA) payment.' }));
    },
  },
  {
    id: 'SCT-08', title: 'Amount between 0.01 and 999,999,999.99, with at most 2 decimals', severity: 'error', source: 'epc',
    good: '150.25', bad: '150.255 (the schema accepts 5 decimals)', scenario: 'amount-decimals',
    check({ txs }) {
      const out = [];
      for (const el of txs.map(amtEl)) {
        const v = text(el); const m = money(v); if (m == null) continue;
        const dec = (v.split('.')[1] || '').replace(/0+$/, '').length;
        if (dec > 2) out.push({ el, message: `Amount ${v} has ${dec} decimals. The ISO schema accepts up to 5, but SEPA allows only 2.`, expected: 'at most 2 decimals', found: v, fix: 'Round the amount to the cent.' });
        else if (m < 1000n) out.push({ el, message: `Amount ${v} is below the SEPA minimum of 0.01.`, expected: '0.01 or more', found: v, fix: 'Remove the payment or enter the real amount.' });
        else if (m > 99999999999000n) out.push({ el, message: `Amount ${v} is above the SEPA maximum of 999,999,999.99.`, expected: 'at most 999999999.99', found: v, fix: 'Split it into several payments.' });
      }
      return out;
    },
  },
  {
    id: 'SCT-09', title: 'Payment method is TRF and the service level is SEPA', severity: 'error', source: 'epc',
    good: '<PmtMtd>TRF</PmtMtd> and <SvcLvl><Cd>SEPA</Cd>', bad: '<PmtMtd>CHK</PmtMtd>, or no SEPA service level', scenario: 'method',
    check({ pmtInfs }) {
      const out = [];
      for (const pi of pmtInfs) {
        const m = kid(pi, 'PmtMtd');
        if (text(m) && text(m) !== 'TRF') out.push({ el: m, message: `Payment method is ${text(m)}. A SEPA credit transfer must be TRF.`, expected: 'TRF', found: text(m), fix: 'Set PmtMtd to TRF.' });
        const piSvc = text(path(pi, 'PmtTpInf', 'SvcLvl', 'Cd'));
        if (piSvc === 'SEPA') continue;
        const txs = kids(pi, 'CdtTrfTxInf');
        const missing = txs.filter((tx) => text(path(tx, 'PmtTpInf', 'SvcLvl', 'Cd')) !== 'SEPA');
        if (missing.length) {
          const el = path(pi, 'PmtTpInf', 'SvcLvl', 'Cd') || kid(pi, 'PmtTpInf') || kid(pi, 'PmtInfId') || pi;
          out.push({ el, message: piSvc ? `Service level is ${piSvc}, not SEPA.` : 'The batch has no SEPA service level, so it is not marked as a SEPA credit transfer.', expected: 'SEPA', found: piSvc || '(none)', fix: 'Add <PmtTpInf><SvcLvl><Cd>SEPA</Cd></SvcLvl></PmtTpInf> to the batch.' });
        }
      }
      return out;
    },
  },
  {
    id: 'SCT-10', title: 'Charge bearer is SLEV', severity: 'error', source: 'epc',
    good: '<ChrgBr>SLEV</ChrgBr>', bad: '<ChrgBr>DEBT</ChrgBr>', scenario: 'charges',
    check({ pmtInfs, txs }) {
      return pmtInfs.map((pi) => kid(pi, 'ChrgBr')).concat(txs.map((tx) => kid(tx, 'ChrgBr'))).filter((el) => el && text(el) !== 'SLEV')
        .map((el) => ({ el, message: `Charge bearer is ${text(el)}. In SEPA each side pays its own bank, which is SLEV.`, expected: 'SLEV', found: text(el), fix: 'Set ChrgBr to SLEV, or leave it out.' }));
    },
  },
  {
    id: 'SCT-11', title: 'Requested execution date is not before the processing date', severity: 'error', source: 'gp',
    good: 'tomorrow', bad: 'last week', scenario: 'date-past',
    check({ pmtInfs, procDate }) {
      return pmtInfs.map(execDateEl).filter((el) => { const v = (text(el) || '').slice(0, 10); return isDate(v) && v < procDate; })
        .map((el) => ({ el, message: `The requested execution date ${text(el).slice(0, 10)} is before the processing date ${procDate}.`, expected: procDate + ' or later', found: text(el), fix: 'Set today or a future business day. Banks reject or re-date payments in the past.' }));
    },
  },
  {
    id: 'SCT-12', title: 'References (MsgId, PmtInfId, EndToEndId) do not start or end with "/" or contain "//"', severity: 'error', source: 'epc',
    good: 'INV-2026-0042', bad: '/INV//2026', scenario: 'reference-slash', note: 'Their maximum of 35 characters is checked by the schema.',
    check({ root }) {
      return ['MsgId', 'PmtInfId', 'EndToEndId', 'InstrId'].flatMap((f) => all(root, f)).filter((el) => /^\/|\/$|\/\//.test(text(el) || ''))
        .map((el) => ({ el, message: `The reference "${text(el)}" starts or ends with "/" or contains "//", which SEPA does not allow.`, found: text(el), fix: 'Remove the extra slashes.' }));
    },
  },
  {
    id: 'SCT-13', title: 'Names have at most 70 characters', severity: 'error', source: 'epc',
    good: 'a 40-character name', bad: 'a 90-character name (the schema allows 140)', scenario: 'name-length', note: 'Remittance text (140) is checked by the schema.',
    check({ root }) {
      const out = [];
      for (const el of all(root, 'Nm')) { const v = text(el) || ''; if (v.length > 70) out.push({ el, message: `This name has ${v.length} characters. The schema allows 140, SEPA only 70.`, expected: 'at most 70 characters', found: short(v), fix: 'Shorten the name.' }); }
      return out;
    },
  },
  {
    id: 'SCT-14', title: 'Text uses only the SEPA character set', severity: 'warning', source: 'epc',
    good: 'Invoice 42 - Cafe', bad: 'Facture 42 – Café & Co', scenario: 'charset',
    check({ root }) {
      const out = [];
      for (const f of ['Nm', 'Ustrd', 'AdrLine', 'StrtNm', 'TwnNm', 'MsgId', 'PmtInfId', 'EndToEndId', 'InstrId']) for (const el of all(root, f)) {
        const v = text(el) || ''; const bad = [...new Set([...v].filter((ch) => !SEPA_CHAR.test(ch)))];
        if (bad.length) out.push({ el, message: `The text uses ${bad.length === 1 ? 'a character' : 'characters'} outside the SEPA character set (${bad.join(' ')}). Many banks replace or reject ${bad.length === 1 ? 'it' : 'them'}.`, found: short(v), fix: 'Use plain letters (é → e, & → +), digits, spaces and / - ? : ( ) . , \' +' });
      }
      return out;
    },
  },
  {
    id: 'SCT-15', title: 'EndToEndId is unique within the file', severity: 'warning', source: 'gp',
    good: 'E2E-0001, E2E-0002', bad: 'E2E-0001 twice', scenario: 'duplicate-e2e',
    check({ root }) {
      const seen = new Set(), out = [];
      for (const el of all(root, 'EndToEndId')) {
        const v = text(el); if (!v || v === 'NOTPROVIDED') continue;
        if (seen.has(v)) out.push({ el, message: `EndToEndId "${v}" is used by an earlier payment too.`, found: v, fix: 'Give each payment its own reference: duplicates make reconciliation and recalls hard and can hide a double payment.' });
        seen.add(v);
      }
      return out;
    },
  },
  {
    id: 'SCT-16', title: 'Remittance is one unstructured line or one structured block, not both', severity: 'error', source: 'epc',
    good: 'one <Ustrd>', bad: '<Ustrd> and <Strd> together, two <Ustrd> or two <Strd>', scenario: 'remittance-both',
    check({ txs }) {
      const out = [];
      for (const tx of txs) {
        const r = kid(tx, 'RmtInf'); if (!r) continue;
        const u = kids(r, 'Ustrd'), s = kids(r, 'Strd');
        if (u.length && s.length) out.push({ el: s[0], message: 'This payment has both unstructured and structured remittance information. SEPA allows one or the other.', fix: 'Keep either Ustrd or Strd.' });
        else if (u.length > 1) out.push({ el: u[1], message: `This payment has ${u.length} unstructured remittance lines. SEPA allows one.`, fix: 'Join them into one Ustrd of at most 140 characters.' });
        else if (s.length > 1) out.push({ el: s[1], message: `This payment has ${s.length} structured remittance blocks. SEPA allows one.`, fix: 'Keep one Strd.' });
      }
      return out;
    },
  },
  {
    id: 'SCT-17', title: 'Requested execution date is a TARGET business day', severity: 'warning', source: 't2',
    good: 'a Tuesday', bad: 'a Saturday or 25 December', scenario: 'date-closed',
    check({ pmtInfs }) {
      return pmtInfs.map(execDateEl).filter((el) => { const v = (text(el) || '').slice(0, 10); return isDate(v) && targetClosed(v); })
        .map((el) => { const v = text(el).slice(0, 10); return { el, message: `The requested execution date ${v} is ${targetClosed(v)}, when euro payment systems are closed.`, expected: nextBusinessDay(v), found: v, fix: `Most banks move it to the next business day (${nextBusinessDay(v)}). Set that date to be sure.` }; });
    },
  },
  {
    id: 'SCT-18', title: 'Every debtor and creditor has a name', severity: 'error', source: 'epc',
    good: '<Cdtr><Nm>Alder Example Studio</Nm></Cdtr>', bad: '<Cdtr/> with no name (the schema allows it)', scenario: 'creditor-name',
    check({ pmtInfs, txs }) {
      const dbtr = pmtInfs.filter((pi) => !text(path(pi, 'Dbtr', 'Nm'))).map((pi) => ({ el: kid(pi, 'Dbtr') || kid(pi, 'PmtInfId') || pi, message: 'The debtor (payer) has no name. The schema allows that, SEPA does not.', expected: 'a name', found: '(none)', fix: 'Add Nm with the name of the account holder who pays.' }));
      return dbtr.concat(txs.filter((tx) => !text(path(tx, 'Cdtr', 'Nm'))).map((tx) => ({ el: kid(tx, 'Cdtr') || tx, message: 'The creditor has no name. The schema allows that, SEPA does not.', expected: 'a name', found: '(none)', fix: 'Add Nm with the name of the person or company being paid.' })));
    },
  },
  {
    id: 'SCT-19', title: 'PmtInfId is unique within the file', severity: 'error', source: 'gp',
    good: 'BATCH-1, BATCH-2', bad: 'BATCH-1 twice', scenario: 'duplicate-batch',
    check({ pmtInfs }) {
      const seen = new Set(), out = [];
      for (const el of pmtInfs.map((pi) => kid(pi, 'PmtInfId'))) { const v = text(el); if (!v) continue; if (seen.has(v)) out.push({ el, message: `Payment batch ID "${v}" is used twice.`, found: v, fix: 'Give each batch its own ID: banks use it to detect duplicate files.' }); seen.add(v); }
      return out;
    },
  },
  {
    id: 'SCT-20', title: 'Nobody pays their own account', severity: 'warning', source: 'gp',
    good: 'creditor IBAN differs from the debtor IBAN', bad: 'the same IBAN on both sides', scenario: 'same-account',
    check({ pmtInfs }) {
      const out = [];
      for (const pi of pmtInfs) {
        const d = (text(path(pi, 'DbtrAcct', 'Id', 'IBAN')) || '').toUpperCase(); if (!d) continue;
        for (const tx of kids(pi, 'CdtTrfTxInf')) { const el = path(tx, 'CdtrAcct', 'Id', 'IBAN'); if ((text(el) || '').toUpperCase() === d) out.push({ el, message: 'The creditor account is the debtor account itself.', found: groupIban(d), fix: 'Check the creditor IBAN: the money would come straight back.' }); }
      }
      return out;
    },
  },
];

export function runRules(tree, procDate) {
  const doc = tree.documentElement;
  const root = doc && kid(doc, 'CstmrCdtTrfInitn');
  if (!root) return { findings: [], unreadable: ['CstmrCdtTrfInitn (the whole message)'], stats: { blocks: 0, txs: 0 } };
  const pmtInfs = kids(root, 'PmtInf');
  const txs = pmtInfs.flatMap((pi) => kids(pi, 'CdtTrfTxInf'));
  const ctx = { root, pmtInfs, txs, procDate };
  const unreadable = [];
  if (!kid(root, 'GrpHdr')) unreadable.push('GrpHdr (group header)');
  const findings = [];
  for (const r of RULES) {
    for (const f of r.check(ctx)) {
      findings.push({ layer: 'rule', id: r.id, severity: r.severity, title: r.title, source: r.source, line: f.el ? f.el.line : null, col: f.el ? f.el.col : null, path: f.el ? f.el.path : '', element: f.el ? f.el.localName : '', message: f.message, expected: f.expected || null, found: f.found || null, fix: f.fix });
    }
  }
  const amounts = txs.map((tx) => money(text(amtEl(tx)))).filter((v) => v != null);
  return { findings, unreadable, stats: { blocks: pmtInfs.length, txs: txs.length, total: amounts.reduce((a, b) => a + b, 0n) } };
}

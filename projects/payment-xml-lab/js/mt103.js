// MT103 reader for the MT to MX Migration Lab.
// Reads blocks 1 to 5 and the fields of block 4, keeps the line of every field, and checks the basic
// format of each field. Field descriptions are written in our own words.

export const MAX_CHARS = 10000; // an MT message is at most 10,000 characters
// MT "x" character set: letters, digits, space and / - ? : ( ) . , ' +
const X_CHARS = /^[A-Za-z0-9/\-?:().,'+ ]*$/;
const BIC = /^[A-Z0-9]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/;

// The fields an MT103 can hold, with a short description in our own words.
export const FIELDS = {
  '13C': 'Time indication', '20': 'Sender\'s reference', '23B': 'Bank operation code', '23E': 'Instruction code',
  '26T': 'Transaction type code', '32A': 'Value date, currency and settled amount', '33B': 'Currency and instructed amount',
  '36': 'Exchange rate', '50A': 'Ordering customer (BIC)', '50F': 'Ordering customer (structured)', '50K': 'Ordering customer (free text)',
  '51A': 'Sending institution', '52A': 'Ordering institution (BIC)', '52D': 'Ordering institution (name and address)',
  '53A': 'Sender\'s correspondent (BIC)', '53B': 'Sender\'s correspondent (account)', '53D': 'Sender\'s correspondent (name and address)',
  '54A': 'Receiver\'s correspondent (BIC)', '54B': 'Receiver\'s correspondent (account)', '54D': 'Receiver\'s correspondent (name and address)',
  '55A': 'Third reimbursement institution', '56A': 'Intermediary institution (BIC)', '56C': 'Intermediary institution (account)',
  '56D': 'Intermediary institution (name and address)', '57A': 'Beneficiary\'s bank (BIC)', '57B': 'Beneficiary\'s bank (location)',
  '57C': 'Beneficiary\'s bank (account)', '57D': 'Beneficiary\'s bank (name and address)', '59': 'Beneficiary (free text)',
  '59A': 'Beneficiary (BIC)', '59F': 'Beneficiary (structured)', '70': 'Remittance information', '71A': 'Details of charges',
  '71F': 'Sender\'s charges', '71G': 'Receiver\'s charges', '72': 'Sender to receiver information', '77B': 'Regulatory reporting',
  '77T': 'Envelope contents',
};
const MAX_LINES = { '20': 1, '23B': 1, '23E': 1, '26T': 1, '32A': 1, '33B': 1, '36': 1, '13C': 1, '71A': 1, '71F': 1, '71G': 1,
  '50K': 5, '50F': 5, '50A': 2, '59': 5, '59F': 5, '59A': 2, '52A': 2, '53A': 2, '54A': 2, '56A': 2, '57A': 2, '51A': 2, '55A': 2,
  '52D': 5, '53D': 5, '54D': 5, '56D': 5, '57D': 5, '53B': 2, '54B': 2, '57B': 2, '56C': 1, '57C': 1, '70': 4, '72': 6, '77B': 3 };
const MANDATORY = [['20'], ['23B'], ['32A'], ['50A', '50F', '50K'], ['59', '59A', '59F'], ['71A']];

const err = (line, tag, message, fix) => ({ severity: 'error', line, tag, message, fix });

export function isValidDate6(v) {
  const m = /^(\d{2})(\d{2})(\d{2})$/.exec(v || ''); if (!m) return false;
  const y = 2000 + Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}
export const date6 = (v) => `20${v.slice(0, 2)}-${v.slice(2, 4)}-${v.slice(4, 6)}`;
// MT amount: digits with one mandatory decimal comma, at most 15 characters in all
export const AMOUNT = /^(\d{1,14}),(\d*)$/;
export function amountToIso(v) { const m = AMOUNT.exec(v); if (!m) return null; const i = m[1].replace(/^0+(?=\d)/, ''); return m[2] ? i + '.' + m[2] : i; }
export const bicFromLT = (lt) => (lt && lt.length === 12 ? lt.slice(0, 8) + lt.slice(9) : null); // drop the logical terminal letter

// Returns { blocks, fields: [{ tag, line, lines: [text...], value }], errors, lineCount }
export function readMt(src) {
  const text = String(src).replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  const out = { blocks: { b1: null, b2: null, b3: [], b5: [] }, fields: [], errors: [], lineCount: lines.length, hasBlock4: false };
  if (text.length > MAX_CHARS) { out.errors.push(err(1, null, `The message has ${text.length} characters. An MT message has at most ${MAX_CHARS}.`, 'Paste a single MT103.')); out.refused = true; return out; }
  if (!text.trim()) { out.errors.push(err(1, null, 'The message is empty.', 'Paste an MT103 or load a sample.')); out.refused = true; return out; }

  // where block 4 starts and ends
  let b4Start = -1, b4End = lines.length;
  lines.forEach((l, i) => { if (b4Start < 0 && l.includes('{4:')) b4Start = i; });
  if (b4Start >= 0) {
    out.hasBlock4 = true;
    for (let i = b4Start; i < lines.length; i++) if (/^-\}/.test(lines[i])) { b4End = i; break; }
    const head = lines.slice(0, b4Start + 1).join('\n');
    const h = head.slice(0, head.indexOf('{4:'));
    const b1 = /\{1:([^}]*)\}/.exec(h), b2 = /\{2:([^}]*)\}/.exec(h), b3 = /\{3:((?:\{[^}]*\})*)\}/.exec(h);
    if (b1) out.blocks.b1 = { raw: b1[1], line: lineOf(lines, '{1:') };
    if (b2) out.blocks.b2 = { raw: b2[1], line: lineOf(lines, '{2:') };
    if (b3) out.blocks.b3 = [...b3[1].matchAll(/\{(\d{3}):([^}]*)\}/g)].map((m) => ({ tag: m[1], value: m[2], line: lineOf(lines, '{' + m[1] + ':') }));
    const tail = lines.slice(b4End).join('\n');
    const b5 = /\{5:((?:\{[^}]*\})*)\}/.exec(tail);
    if (b5) out.blocks.b5 = [...b5[1].matchAll(/\{([A-Z]{3}):([^}]*)\}/g)].map((m) => ({ tag: m[1], value: m[2], line: lineOf(lines, '{5:') }));
    if (b4End === lines.length) out.errors.push(err(lines.length, null, 'Block 4 has no end marker "-}".', 'End the text block with a line "-}".'));
  }
  // block 4 fields
  const from = b4Start >= 0 ? b4Start : 0;
  let cur = null;
  for (let i = from; i < b4End; i++) {
    let l = lines[i];
    if (i === b4Start) { l = l.slice(l.indexOf('{4:') + 3); if (!l.trim()) continue; }
    const m = /^:(\d{2}[A-Z]?):(.*)$/.exec(l);
    if (m) { cur = { tag: m[1], line: i + 1, lines: [m[2]] }; out.fields.push(cur); continue; }
    if (!l.trim() && !cur) continue;
    if (cur) cur.lines.push(l); else out.errors.push(err(i + 1, null, 'Text before the first field.', 'Each field starts with a tag such as :20:.'));
  }
  for (const f of out.fields) { f.value = f.lines.join('\n'); f.lineNos = f.lines.map((_, k) => f.line + k); }
  checkFields(out);
  return out;
}
function lineOf(lines, needle) { const i = lines.findIndex((l) => l.includes(needle)); return i < 0 ? 1 : i + 1; }

function checkFields(mt) {
  const E = mt.errors;
  const b1 = mt.blocks.b1, b2 = mt.blocks.b2;
  if (b1 && !/^F01[A-Z0-9]{12}\d{4}\d{6}$/.test(b1.raw)) E.push(err(b1.line, '{1:', 'Block 1 is not in the form F01 + 12-character address + session and sequence numbers.', 'Check the basic header.'));
  if (b2 && !/^I103[A-Z0-9]{12}[NUS]?\d{0,3}\d{0,3}$/.test(b2.raw) && !/^O103\d{4}\d{6}[A-Z0-9]{12}\d{10}\d{6}\d{4}[NUS]?$/.test(b2.raw)) E.push(err(b2.line, '{2:', 'Block 2 is not an MT103 application header.', 'Use I103 followed by the receiver address, for example I103XMPLFRPPXXXXN.'));
  for (const f of mt.fields) {
    if (!FIELDS[f.tag]) { E.push(err(f.line, f.tag, `Field :${f.tag}: is not a field of an MT103.`, 'Remove it, or correct the tag.')); continue; }
    f.lines.forEach((l, k) => {
      if (l.length > 35) E.push(err(f.line + k, f.tag, `Line of field :${f.tag}: has ${l.length} characters. MT lines have at most 35.`, 'Split the text over more lines, or shorten it.'));
      if (!X_CHARS.test(l)) { const bad = [...l].filter((c) => !X_CHARS.test(c)); E.push(err(f.line + k, f.tag, `Field :${f.tag}: uses characters outside the MT character set: ${[...new Set(bad)].map((c) => JSON.stringify(c)).join(' ')}.`, 'Use only letters, digits, space and / - ? : ( ) . , \' +.')); }
    });
    if (MAX_LINES[f.tag] && f.lines.length > MAX_LINES[f.tag]) E.push(err(f.line, f.tag, `Field :${f.tag}: has ${f.lines.length} lines. It allows at most ${MAX_LINES[f.tag]}.`, 'Remove the extra lines.'));
    const v = f.lines[0];
    switch (f.tag) {
      case '20': if (!v || v.length > 16 || v.startsWith('/') || v.endsWith('/') || v.includes('//')) E.push(err(f.line, '20', 'The sender\'s reference must have 1 to 16 characters and must not start or end with "/" or contain "//".', 'Correct the reference.')); break;
      case '23B': if (!/^(CRED|CRTS|SPAY|SPRI|SSTD)$/.test(v)) E.push(err(f.line, '23B', `Bank operation code "${v}" is not one of CRED, CRTS, SPAY, SPRI, SSTD.`, 'Use CRED for a normal customer transfer.')); break;
      case '32A': {
        const m = /^(\d{6})([A-Z]{3})(.*)$/.exec(v);
        if (!m) E.push(err(f.line, '32A', 'Field 32A must be a date (YYMMDD), a currency and an amount, for example 261117EUR1250,00.', 'Correct the format.'));
        else {
          if (!isValidDate6(m[1])) E.push(err(f.line, '32A', `Value date "${m[1]}" is not a real date.`, 'Use YYMMDD, for example 261117.'));
          if (!AMOUNT.test(m[3]) || m[3].length > 15) E.push(err(f.line, '32A', `Amount "${m[3]}" must have digits and one decimal comma, at most 15 characters.`, 'Write the amount like 1250,00.'));
        }
        break;
      }
      case '33B': case '71F': case '71G': {
        const m = /^([A-Z]{3})(.*)$/.exec(v);
        if (!m || !AMOUNT.test(m[2]) || m[2].length > 15) E.push(err(f.line, f.tag, `Field :${f.tag}: must be a currency and an amount with a decimal comma, for example EUR10,00.`, 'Correct the format.'));
        break;
      }
      case '36': if (!/^\d{1,11},\d*$/.test(v) || v.length > 12) E.push(err(f.line, '36', 'The exchange rate must have digits and one decimal comma, at most 12 characters.', 'Write it like 1,0845.')); break;
      case '71A': if (!/^(BEN|OUR|SHA)$/.test(v)) E.push(err(f.line, '71A', `Details of charges "${v}" must be BEN, OUR or SHA.`, 'Use SHA when each side pays its own bank.')); break;
      case '50A': case '59A': case '52A': case '53A': case '54A': case '56A': case '57A': case '51A': case '55A': {
        const bic = f.lines[f.lines.length - 1];
        if (!BIC.test(bic)) E.push(err(f.line + f.lines.length - 1, f.tag, `"${bic}" is not a BIC (8 or 11 characters).`, 'Correct the BIC.'));
        break;
      }
      default:
    }
  }
  for (const set of MANDATORY) if (!mt.fields.some((f) => set.includes(f.tag))) E.push(err(1, set[0], `Mandatory field :${set.join(': or :')}: (${FIELDS[set[0]]}) is missing.`, 'Add it.'));
  const seen = new Set();
  for (const f of mt.fields) { if (f.tag !== '71F' && seen.has(f.tag)) E.push(err(f.line, f.tag, `Field :${f.tag}: appears twice.`, 'Keep only one.')); seen.add(f.tag); }
}

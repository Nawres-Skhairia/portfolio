// Reverse check: what would be cut if this pacs.008 goes back to a party that still works in MT
// (lines of 35 characters, a fixed number of lines, the MT character set). Our own simplified view.
import { parseTree, kid, kids, path, text } from './tree.js';

const X_CHAR = /[A-Za-z0-9/\-?:().,'+ ]/;
const SPECIAL = { 'ß': 'ss', 'Æ': 'AE', 'æ': 'ae', 'Ø': 'O', 'ø': 'o', 'Œ': 'OE', 'œ': 'oe', 'Ł': 'L', 'ł': 'l', 'Đ': 'D', 'đ': 'd', '&': '+', '_': '-', '@': '(AT)', '"': '\'' };
// to the MT character set: accents dropped, a few letters spelled out, anything else becomes "."
export function toX(s) {
  let out = '';
  for (const ch of String(s)) {
    if (X_CHAR.test(ch)) { out += ch; continue; }
    if (SPECIAL[ch] !== undefined) { out += SPECIAL[ch]; continue; }
    const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
    out += base && [...base].every((c) => X_CHAR.test(c)) ? base : '.';
  }
  return out;
}
// split text into lines of at most 35, at a space where possible
export function wrap35(s) {
  const out = []; let rest = String(s).trim();
  while (rest.length > 35) {
    let cut = rest.lastIndexOf(' ', 35); if (cut < 20) cut = 35;
    out.push(rest.slice(0, cut).trimEnd()); rest = rest.slice(cut).trimStart();
  }
  if (rest) out.push(rest);
  return out;
}

function partyLines(p) {
  const L = [];
  const nm = text(kid(p, 'Nm')); if (nm) L.push(...wrap35(nm));
  const a = kid(p, 'PstlAdr');
  if (a) {
    const g = (n) => text(kid(a, n)) || '';
    const street = [g('StrtNm'), g('BldgNb')].filter(Boolean).join(' ');
    if (street) L.push(...wrap35(street));
    kids(a, 'AdrLine').forEach((l) => L.push(...wrap35(text(l))));
    const town = [g('PstCd'), g('TwnNm')].filter(Boolean).join(' ');
    if (town) L.push(...wrap35(town));
    if (g('Ctry')) L.push(g('Ctry'));
  }
  return L;
}

// Returns { rows: [{ element, mt, before, after, issue, cut }], cuts }
export function reverseCheck(xml) {
  const tree = parseTree(xml);
  const doc = tree.documentElement; const tx = doc && path(doc, 'FIToFICstmrCdtTrf', 'CdtTrfTxInf');
  const rows = [];
  if (!tx) return { rows, cuts: 0, error: 'This is not a pacs.008 with a CdtTrfTxInf.' };
  const add = (element, mt, before, afterLines, max, extra) => {
    const x = afterLines.map(toX);
    const kept = x.slice(0, max);
    const changedChars = x.join('') !== afterLines.join('');
    const cut = afterLines.length > max;
    const issues = [];
    if (cut) issues.push(`needs ${afterLines.length} lines of 35, the MT field has ${max}: ${afterLines.length - max} line(s) cut`);
    if (changedChars) issues.push('characters outside the MT set replaced');
    if (extra) issues.push(extra);
    rows.push({ element, mt, before, after: kept.join('\n'), issue: issues.join('; ') || 'fits', cut: cut || changedChars || !!extra });
  };
  const instr = text(path(tx, 'PmtId', 'InstrId'));
  if (instr) add('PmtId/InstrId', ':20:', instr, [instr.slice(0, 16)], 1, instr.length > 16 ? `${instr.length} characters, :20: holds 16` : null);
  const e2e = text(path(tx, 'PmtId', 'EndToEndId'));
  if (e2e && e2e !== 'NOTPROVIDED') rows.push({ element: 'PmtId/EndToEndId', mt: '(none)', before: e2e, after: '', issue: 'MT103 has no end-to-end reference field: lost unless both sides agree to carry it in :70:', cut: true });
  const dbtr = kid(tx, 'Dbtr'); if (dbtr) { const L = partyLines(dbtr); add('Dbtr (name and address)', ':50K:', L.join('\n'), L, 4); }
  const cdtr = kid(tx, 'Cdtr'); if (cdtr) { const L = partyLines(cdtr); add('Cdtr (name and address)', ':59:', L.join('\n'), L, 4); }
  const ustrd = kids(path(tx, 'RmtInf'), 'Ustrd').map(text);
  if (ustrd.length) { const all = ustrd.join(' '); add('RmtInf/Ustrd', ':70:', all + `  (${all.length} characters)`, wrap35(all), 4); }
  if (kids(path(tx, 'RmtInf'), 'Strd').length) rows.push({ element: 'RmtInf/Strd', mt: ':70:', before: 'structured remittance', after: '', issue: 'MT103 has no structured remittance: only a short code such as /RFB/ can be kept', cut: true });
  const instrs = [...kids(tx, 'InstrForCdtrAgt'), ...kids(tx, 'InstrForNxtAgt')].map((n) => text(kid(n, 'InstrInf'))).filter(Boolean);
  if (instrs.length) { const L = instrs.flatMap(wrap35); add('Instructions (InstrInf)', ':72:', instrs.join('\n'), L, 6); }
  return { rows, cuts: rows.filter((r) => r.cut).length };
}

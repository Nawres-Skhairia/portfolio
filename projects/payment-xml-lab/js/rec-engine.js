// Reconciliation Workbench: the matching rules, the decisions of the person, and the fingerprinted audit trail.
// Rules only, no AI, on purpose: every match is a rule you can read. No clock in the matching logic: the same files
// and settings always give the same matches in the same order (times appear only in trail lines).
import { euro, ibanIsValid } from './rules.js';
import { sha256 } from './sha256.js';

export const REC_TOOL = { name: 'Reconciliation Workbench', version: '0.1.0' };
export const REC_CATALOGUE_VERSION = '2026.11-mvp1';
export const ENGINE = `Rules engine ${REC_TOOL.version}`;
export const DEFAULT_SETTINGS = Object.freeze({ tolAbs: 500000n, tolBp: 50 }); // 5.00 and 0.5 %
export const MAX_COMBO_INVOICES = 30;

export const REC_RULES = [
  { id: 'REC-01', name: 'Exact by reference', auto: true, gives: 'Auto-matched', what: 'The invoice number or its payment reference is in the payment details, and the amount is the same.' },
  { id: 'REC-02', name: 'Reference, small difference', auto: true, gives: 'Auto-matched or To review', what: 'The reference is found and the difference is within the tolerance (the smaller of the two settings). Automatic only when the payer account is the customer\'s account; the difference is booked as a "small difference".' },
  { id: 'REC-03', name: 'Partial payment', auto: false, gives: 'To review', what: 'The reference is found and less is paid, beyond the tolerance. On accept, the invoice stays open with what is left; a later payment can complete it.' },
  { id: 'REC-04', name: 'Overpayment', auto: false, gives: 'To review', what: 'The reference is found and more is paid, beyond the tolerance. On accept, the invoice is closed and the excess is shown as customer credit.' },
  { id: 'REC-05', name: 'Grouped by references', auto: false, gives: 'To review', what: 'Several invoice references in one payment, and the amount equals their sum (within the tolerance).' },
  { id: 'REC-06', name: 'Grouped by amount', auto: false, gives: 'To review or Unmatched', what: 'No reference, the payer account belongs to a customer, and exactly one combination of 2 to 5 of that customer\'s open invoices adds up to the amount. If several fit, nothing is matched.' },
  { id: 'REC-07', name: 'By payer and amount', auto: false, gives: 'To review', what: 'No reference, the payer account belongs to a customer, and exactly one of that customer\'s open invoices has this amount.' },
  { id: 'REC-08', name: 'Possible duplicate', auto: false, gives: 'Unmatched', what: 'Same payer, same amount and same reference as an entry that is already matched.' },
  { id: 'REC-09', name: 'Not a customer payment', auto: false, gives: 'Unmatched', what: 'Debits (bank fees, payments going out), reversals and payments made in another currency are listed with their type.' },
  { id: 'REC-10', name: 'Reference with a typo', auto: false, gives: 'To review', what: 'No exact reference, but one open invoice number is found with one character different or a common mix-up (letter O for zero, letter I or L for one), and the amount fits.' },
];
const RULE = Object.fromEntries(REC_RULES.map((r) => [r.id, r]));
export const TREATMENT = { closed: 'Invoice closed', 'small-diff': 'Closed, small difference booked', partial: 'Partial payment, invoice stays open', credit: 'Closed, excess as customer credit' };

// ---------- money and text helpers ----------
export const amt = (v) => (v < 0n ? '−' + euro(-v) : euro(v));
export const plain = (v) => (v == null ? '' : (v < 0n ? '-' : '') + euro(v < 0n ? -v : v).replace(/,/g, ''));
const abs = (v) => (v < 0n ? -v : v);
const sum = (a) => a.reduce((x, y) => x + y, 0n);
export function tolerance(due, st) { const p = (due * BigInt(st.tolBp)) / 10000n; return p < st.tolAbs ? p : st.tolAbs; }
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const up = (s) => String(s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const compact = (s) => up(s).replace(/[^A-Z0-9]/g, '');
const LEGAL = /\b(GMBH|SARL|SAS|SA|LTD|LIMITED|BV|NV|AB|OY|SPA|SRL|KFT|AG|PLC|INC|LLC|CO|KG|OHG)\b|&/g;
const normName = (s) => up(s).replace(/[^A-Z0-9& ]/g, ' ').replace(LEGAL, ' ').replace(/\s+/g, ' ').trim();
const INV_WORDS = 'INVOICES?|INV|RECHNUNG(?:EN)?|RG|FACTURES?|FACT|FACTURA|FATTURA|FAKTURA';
const days = (a, b) => Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86400000);
const remText = (e) => [...e.ustrd, e.e2e && e.e2e !== 'NOTPROVIDED' ? e.e2e : '', e.addtl || ''].filter(Boolean).join(' ');
export const remShown = (e) => [...e.ustrd, ...e.strdRefs.map((r) => 'Ref ' + r)].join(' · ') || '(no payment details)';

const PAT = new WeakMap();
function refPatterns(inv) {
  if (PAT.has(inv)) return PAT.get(inv);
  const m = /^([A-Za-z]+)[\s\-_./#]*(\d+)$/.exec(inv.number);
  const pats = [];
  if (m) {
    pats.push({ re: new RegExp(`(?<![A-Z0-9])(?:${esc(m[1].toUpperCase())}|${INV_WORDS})[\\s\\-_./#:]{0,3}(?:(?:NO|NR|N°)\\.?\\s{0,2})?${m[2]}(?![0-9])`), how: 'invoice number' });
    pats.push({ re: new RegExp(`(?<![0-9.,])${m[2]}(?![0-9]|[.,][0-9])`), how: 'number in a list', digits: m[2], needsWord: true });
  } else pats.push({ re: new RegExp(`(?<![A-Z0-9])${compact(inv.number).split('').map(esc).join('[\\s\\-_./]?')}(?![A-Z0-9])`), how: 'invoice number' });
  const r = inv.reference ? compact(inv.reference) : '';
  const out = { pats, key: m ? m[2] : compact(inv.number), ref: r, refRe: r.length >= 5 ? new RegExp(`(?<![A-Z0-9])${r.split('').map(esc).join('[\\s\\-_./]?')}(?![A-Z0-9])`) : null };
  PAT.set(inv, out);
  return out;
}
// references of all invoices found in one entry
const WORD_RE = new RegExp(`(?<![A-Z])(?:${INV_WORDS})(?![A-Z])`);
// an index of the invoices by the digits of their number, so each entry only looks at invoices whose digits it contains
function hitIndex(s) {
  if (s._hix) return s._hix;
  const byDigits = new Map(), always = [], pos = new Map();
  s.invoices.forEach((inv, i) => {
    pos.set(inv, i);
    const P = refPatterns(inv);
    if (P.refRe || !/^\d+$/.test(P.key)) always.push(inv);
    if (/^\d+$/.test(P.key)) { if (!byDigits.has(P.key)) byDigits.set(P.key, []); byDigits.get(P.key).push(inv); }
  });
  return (s._hix = { byDigits, always, pos });
}
function findHits(s, e, ccy) {
  const t = up(remText(e)), hasWord = WORD_RE.test(t);
  const strd = e.strdRefs.map(compact), tc = compact(remText(e));
  const ix = hitIndex(s), cand = new Set(ix.always);
  for (const run of tc.match(/\d+/g) || []) {
    for (let i = 0; i < run.length; i++) for (let j = i + 1; j <= run.length; j++) { const l = ix.byDigits.get(run.slice(i, j)); if (l) for (const inv of l) cand.add(inv); }
  }
  const invoices = [...cand].filter((inv) => inv.currency === ccy).sort((a, b) => ix.pos.get(a) - ix.pos.get(b));
  const hits = [];
  for (const inv of invoices) {
    const P = refPatterns(inv);
    if (P.refRe) {
      const r = P.ref;
      if ((strd.includes(r) || tc.includes(r)) && (strd.includes(r) || P.refRe.test(t) || tc === r)) {
        const rf = /^RF\d{2}/.test(r);
        if (rf && !ibanIsValid(r)) continue;
        hits.push({ inv, how: rf ? `RF creditor reference ${inv.reference} found${strd.includes(r) ? ' in the structured reference' : ' in the payment details'}, check digits valid` : `payment reference ${inv.reference} found in the payment details` });
        continue;
      }
    }
    if (!tc.includes(P.key)) continue;
    for (const p of P.pats) {
      if (p.needsWord && !hasWord) continue;
      if (p.re.test(t)) { hits.push({ inv, how: p.how === 'number in a list' ? `number ${p.digits} found in a list after an invoice word, read as ${inv.number}` : `${inv.number} found in the payment details` }); break; }
    }
  }
  return hits;
}
// one character different or a common mix-up, for REC-10
function lev1(a, b) {
  if (a === b) return true; if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, d = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++d > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return d + (a.length - i) + (b.length - j) <= 1;
}
function fuzzyTokens(e) {
  return up(remText(e)).split(/[^A-Z0-9-]+/).map((x) => x.replace(/-/g, '')).filter((x) => x.length >= 4 && /\d/.test(x))
    .map((tk) => ({ tk, mixed: tk.replace(/(?<=\d)O|O(?=\d)/g, '0').replace(/(?<=\d)[IL]|[IL](?=\d)/g, '1') }));
}
function fuzzyHit(tokens, inv) {
  const target = compact(inv.number);
  for (const { tk, mixed } of tokens) {
    if (mixed === target && tk !== target) return `"${tk}" read as ${inv.number} (letter for digit)`;
    if (tk !== target && lev1(tk, target)) return `"${tk}" is one character away from ${inv.number}`;
  }
  return null;
}
function paidIn(e, ccy) { if (e.ccy === ccy) return e.amt; if (e.instd && e.instd.ccy === ccy) return e.instd.amt; return null; }

// ---------- session ----------
function orderEntries(entries) {
  return entries.slice().sort((a, b) => (a.bookDate < b.bookDate ? -1 : a.bookDate > b.bookDate ? 1 : 0) || (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0) || a.idx - b.idx);
}
export function createSession({ stmt, invoices, settings = DEFAULT_SETTINGS, inputs = {}, clock }) {
  const s = {
    stmt, entries: orderEntries(stmt.entries), invoices: invoices.slice(), settings: { ...settings }, inputs,
    clock: clock || (() => new Date().toISOString()), matches: [], rejected: new Map(), trail: [], undo: [], view: null, nextMatch: 1,
  };
  s.byRef = new Map(s.entries.map((e) => [e.ref, e]));
  s.byNum = new Map(s.invoices.map((i) => [i.number, i]));
  s.customersByIban = new Map();
  for (const i of s.invoices) if (i.account) { if (!s.customersByIban.has(i.account)) s.customersByIban.set(i.account, new Set()); s.customersByIban.get(i.account).add(i.customer); }
  log(s, { actor: ENGINE, action: 'load', detail: loadDetail(s) });
  recompute(s);
  return s;
}
const settingsText = (st) => `tolerance ${euro(st.tolAbs)} or ${(st.tolBp / 100).toFixed(2).replace(/0$/, '')} %, the smaller`;
function loadDetail(s) {
  const i = s.inputs;
  return `statement ${i.stmtName || '?'} (${s.stmt.id || 'no id'}) SHA-256 ${i.stmtSha || '?'}; invoices ${i.invName || '?'} SHA-256 ${i.invSha || '?'}; ${s.entries.length} entries, ${s.invoices.length} invoices; ${settingsText(s.settings)}; catalogue ${REC_CATALOGUE_VERSION}`;
}

export function openOf(s, inv) {
  if (s._allocFor !== s.matches || s._allocLen !== s.matches.length) {
    const t = new Map();
    for (const m of s.matches) for (const [n, a] of Object.entries(m.alloc)) t.set(n, (t.get(n) || 0n) + a);
    s._alloc = t; s._allocFor = s.matches; s._allocLen = s.matches.length;
  }
  return inv.amount - (s._alloc.get(inv.number) || 0n);
}
function matchOfEntry(s, ref) {
  if (s._entFor !== s.matches || s._entLen !== s.matches.length) { s._ent = new Map(); for (const m of s.matches) for (const r of m.entries) s._ent.set(r, m); s._entFor = s.matches; s._entLen = s.matches.length; }
  return s._ent.get(ref) || null;
}
const isPerson = (m) => m.kind !== 'auto';

function payerLines(s, e, invs) {
  const out = [];
  const customers = new Set(invs.map((i) => i.customer));
  const accts = [...new Set(invs.map((i) => i.account).filter(Boolean))];
  let accountOk = false;
  if (!e.payerIban) out.push({ m: '✗', k: 'Payer', t: 'The payment carries no payer account.' });
  else if (accts.includes(e.payerIban)) { accountOk = true; out.push({ m: '✓', k: 'Payer', t: `Account ${e.payerIban} is the account of ${[...customers].join(', ')}.` }); }
  else if (s.customersByIban.has(e.payerIban)) out.push({ m: '✗', k: 'Payer', t: `Account ${e.payerIban} belongs to ${[...s.customersByIban.get(e.payerIban)].join(', ')}, not to ${[...customers].join(', ')}.` });
  else if (accts.length) out.push({ m: '✗', k: 'Payer', t: `Account ${e.payerIban} is not the account on file for ${[...customers].join(', ')}.` });
  else out.push({ m: '≈', k: 'Payer', t: `No account on file for ${[...customers].join(', ')} to compare with ${e.payerIban}.` });
  if (e.payer) {
    const a = normName(e.payer), names = [...customers].map(normName);
    const mark = names.includes(a) ? '✓' : names.some((b) => b && (a.includes(b) || b.includes(a) || a.split(' ')[0] === b.split(' ')[0])) ? '≈' : '✗';
    out.push({ m: mark, k: 'Name', t: `Payer name "${e.payer}" ${mark === '✓' ? 'is' : mark === '≈' ? 'is close to' : 'differs from'} "${[...customers].join(', ')}".` });
  }
  return { lines: out, accountOk };
}
function dateLine(e, invs) {
  const due = invs.map((i) => i.due).filter(Boolean).sort();
  if (!due.length || !e.bookDate) return null;
  const d = days(e.bookDate, due[due.length - 1]);
  return { m: d > 30 ? '≈' : '✓', k: 'Date', t: d > 0 ? `Paid ${d} day${d > 1 ? 's' : ''} after the due date.` : d < 0 ? `Paid ${-d} day${d < -1 ? 's' : ''} before the due date.` : 'Paid on the due date.' };
}
// which setting gave the tolerance, in words (Olivia, PORT-42 v1.2)
function tolWhy(due, st) {
  const pct = (due * BigInt(st.tolBp)) / 10000n, p = `${st.tolBp / 100} % of ${amt(due)}`;
  if (st.tolAbs === 0n || st.tolBp === 0) return 'tolerance switched off';
  return pct < st.tolAbs ? `${p}, smaller than the fixed ${amt(st.tolAbs)}` : `the fixed ${amt(st.tolAbs)}, smaller than ${p} (${amt(pct)})`;
}
function amountLine(paid, due, t, ccy, n, st) {
  const d = paid - due;
  const what = n > 1 ? `${n} invoices add up to ${amt(due)}` : `${amt(due)} due`;
  if (d === 0n) return { m: '✓', k: 'Amount', t: `${amt(paid)} ${ccy} paid, ${what}.` };
  const w = abs(d) <= t && t > 0n;
  return { m: w ? '≈' : '✗', k: 'Amount', t: `${amt(paid)} paid, ${what}: ${d < 0n ? 'short by' : 'more by'} ${amt(abs(d))}${w ? `, within the tolerance of ${amt(t)} (${tolWhy(due, st)})` : t > 0n ? `, beyond the tolerance of ${amt(t)} (${tolWhy(due, st)})` : ', the tolerance is switched off'}.` };
}

// builds a proposal: rule, entry, invoices, amounts, treatment, evidence and effect
function proposal(s, rule, e, invs, hits, extra = []) {
  const ccy = invs[0].currency, paid = paidIn(e, ccy);
  const dues = invs.map((i) => openOf(s, i)), due = sum(dues), diff = paid - due, t = tolerance(due, s.settings);
  let treatment = 'closed';
  if (rule === 'REC-03') treatment = 'partial';
  else if (rule === 'REC-04') treatment = 'credit';
  else if (diff !== 0n) treatment = 'small-diff';
  const alloc = {};
  if (treatment === 'partial') alloc[invs[0].number] = paid; else invs.forEach((inv, k) => { alloc[inv.number] = dues[k]; });
  const ev = [];
  for (const h of hits) ev.push({ m: '✓', k: 'Reference', t: h.how[0].toUpperCase() + h.how.slice(1) + '.' });
  ev.push(...extra);
  ev.push(amountLine(paid, due, t, ccy, invs.length, s.settings));
  const pl = payerLines(s, e, invs); ev.push(...pl.lines);
  const dl = dateLine(e, invs); if (dl) ev.push(dl);
  const nums = invs.map((i) => i.number);
  const left = treatment === 'partial' ? due - paid : 0n;
  const effect = treatment === 'partial' ? `${nums[0]} stays open with ${amt(left)} left. A later payment can complete it.`
    : treatment === 'credit' ? `${nums[0]} is closed; ${amt(diff)} is shown as credit for ${invs[0].customer}.`
    : (invs.length > 1 ? `${invs.length} invoices closed` : `${nums[0]} closed`) + (treatment === 'small-diff' ? `; ${amt(abs(diff))} booked as small difference (${diff < 0n ? 'paid less' : 'paid more'}).` : '.');
  const key = `${rule}|${e.ref}|${nums.join('+')}`;
  return { id: key, key, rule, entries: [e.ref], invoices: nums, paid, due, diff, ccy, treatment, alloc, evidence: ev, effect, accountOk: pl.accountOk };
}

// the place of one open entry: an automatic match, a suggestion, or unmatched with a reason
function outcome(s, e, autoOnly) {
  const un = (rule, reason, candidates = []) => ({ un: { entry: e.ref, rule, reason, candidates } });
  if (e.status !== 'BOOK') return un('STM-05', `Not booked yet (status ${e.status || 'unknown'}). Pending entries are listed apart and not matched.`);
  if (e.reversal) return un('REC-09', 'A reversal of an earlier entry, not a customer payment.');
  if (e.cd === 'DBIT') {
    const fee = /CHRG|FEES|COMM/.test(e.btc) || /\b(FEE|FEES|CHARGE|CHARGES)\b/i.test(remText(e));
    return un('REC-09', fee ? `Money going out: a bank fee (${e.btc || 'no transaction code'}). Only customer payments are matched to invoices.` : `Money going out (debit, ${e.btc || 'no transaction code'})${e.payer ? ' to ' + e.payer : ''}, for example a refund. Only customer payments are matched to invoices.`);
  }
  if (e.instd && e.instd.ccy !== e.ccy) {
    const hitsInstd = new Set(findHits(s, e, e.instd.ccy).map((h) => h.inv));
    const cand = s.invoices.filter((i) => i.currency === e.instd.ccy && openOf(s, i) > 0n && (hitsInstd.has(i) || openOf(s, i) === e.instd.amt)).map((i) => i.number);
    return un('REC-09', `Paid in ${e.instd.ccy} ${amt(e.instd.amt)} and converted by the bank to ${e.ccy} ${amt(e.amt)}. This workbench does not convert currencies: match it by hand if it is right.`, cand);
  }
  const hits = findHits(s, e, e.ccy);
  const openHits = hits.filter((h) => openOf(s, h.inv) > 0n);
  const rejected = (p) => (s.rejected.has(p.key) ? un(p.rule, `You rejected the suggestion ${p.rule} (${p.invoices.join(', ')}): ${s.rejected.get(p.key)}`, p.invoices) : null);

  if (hits.length && !openHits.length) {
    const nums = hits.map((h) => h.inv.number);
    const dup = s.matches.find((m) => m.invoices.some((n) => nums.includes(n)) && m.entries.some((r) => { const o = s.byRef.get(r); return o && o.amt === e.amt && ((o.payerIban && o.payerIban === e.payerIban) || (!o.payerIban && o.payer && o.payer === e.payer)); }));
    if (dup) return un('REC-08', `Possible duplicate: same payer, same amount (${amt(e.amt)}) and same reference as entry ${dup.entries[0]}, already matched to ${dup.invoices.join(', ')}. Check with the customer before refunding.`, dup.invoices);
    return un('—', `The payment refers to ${nums.join(', ')}, which ${nums.length > 1 ? 'are' : 'is'} already paid. The amount or payer differs from the earlier payment, so it is not flagged as a duplicate.`, nums);
  }
  if (openHits.length === 1) {
    const inv = openHits[0].inv, due = openOf(s, inv), paid = e.amt, d = paid - due, t = tolerance(due, s.settings);
    let rule = d === 0n ? 'REC-01' : abs(d) <= t && t > 0n ? 'REC-02' : d < 0n ? 'REC-03' : 'REC-04';
    const p = proposal(s, rule, e, [inv], openHits);
    const auto = rule === 'REC-01' || (rule === 'REC-02' && p.accountOk);
    if (rule === 'REC-02' && !p.accountOk) p.evidence.push({ m: '≈', k: 'Why waiting', t: 'A small difference is booked without a person only when the payer account is the customer\'s account.' });
    return rejected(p) || (auto ? { auto: p } : autoOnly ? null : { sug: p });
  }
  if (autoOnly) return null;
  if (openHits.length > 1) {
    const invs = openHits.map((h) => h.inv), due = sum(invs.map((i) => openOf(s, i))), d = e.amt - due, t = tolerance(due, s.settings);
    if (abs(d) <= t) { const p = proposal(s, 'REC-05', e, invs, openHits); return rejected(p) || { sug: p }; }
    return un('REC-05', `The payment names ${invs.length} open invoices (${invs.map((i) => i.number).join(', ')}) that add up to ${amt(due)}, but ${amt(e.amt)} was paid (difference ${amt(abs(d))}). Match it by hand and choose how to treat the difference.`, invs.map((i) => i.number));
  }
  // no reference: a typo?
  const open = s.invoices.filter((i) => i.currency === e.ccy && openOf(s, i) > 0n);
  const fz = [], toks = fuzzyTokens(e);
  if (toks.length) for (const inv of open) { const how = fuzzyHit(toks, inv); if (how) { const due = openOf(s, inv); if (abs(e.amt - due) <= tolerance(due, s.settings)) fz.push({ inv, how }); } }
  if (fz.length === 1) { const p = proposal(s, 'REC-10', e, [fz[0].inv], [], [{ m: '≈', k: 'Reference', t: fz[0].how[0].toUpperCase() + fz[0].how.slice(1) + '.' }]); return rejected(p) || { sug: p }; }
  if (fz.length > 1) return un('REC-10', `The payment details look like ${fz.length} invoice numbers with a typo (${fz.map((f) => f.inv.number).join(', ')}). Too uncertain to suggest one.`, fz.map((f) => f.inv.number));
  // known payer?
  const known = e.payerIban && s.customersByIban.get(e.payerIban);
  if (known) {
    const names = [...known].join(', ');
    const theirs = open.filter((i) => i.account === e.payerIban);
    if (theirs.length > MAX_COMBO_INVOICES) return un('REC-06', `No reference. ${names} has ${theirs.length} open invoices: too many to check every combination safely (limit ${MAX_COMBO_INVOICES}). Match it by hand.`);
    const found = [];
    for (const i of theirs) if (openOf(s, i) === e.amt) found.push([i]);
    if (found.length < 2) combos(theirs.map((i) => ({ i, v: openOf(s, i) })), e.amt, found);
    if (found.length === 1) {
      const invs = found[0];
      const p = proposal(s, invs.length === 1 ? 'REC-07' : 'REC-06', e, invs, [], [{ m: '≈', k: 'Reference', t: 'No invoice reference in the payment details.' }, ...(invs.length > 1 ? [{ m: '✓', k: 'Combination', t: `The only combination of ${names}'s ${theirs.length} open invoices that adds up to ${amt(e.amt)}.` }] : [{ m: '✓', k: 'Unique', t: `The only open invoice of ${names} with this amount.` }])]);
      return rejected(p) || { sug: p };
    }
    if (found.length > 1) return un('REC-06', `No reference, and several combinations possible: ${found.slice(0, 2).map((c) => c.map((i) => i.number).join(' + ')).join(' or ')}${found.length > 2 ? ' (and more)' : ''} all add up to ${amt(e.amt)}. Nothing is matched rather than guessing.`, [...new Set(found.flat().map((i) => i.number))]);
    return un('—', `No reference. The payer is ${names}, but no open invoice of theirs, and no combination of 2 to 5 of them, adds up to ${amt(e.amt)}.`, theirs.map((i) => i.number));
  }
  const twins = open.filter((i) => openOf(s, i) === e.amt);
  return un('—', `No reference found, and the payer account ${e.payerIban || '(none)'} belongs to no customer in the list. ` + (twins.length ? `Open invoice${twins.length > 1 ? 's' : ''} of this amount: ${twins.map((i) => `${i.number} (${i.customer})`).join(', ')}. Check by hand.` : 'No open invoice has this amount.'), twins.map((i) => i.number));
}
// all combinations of 2 to 5 invoices (in number order) adding up exactly to target; stops once a second fits
function combos(items, target, found) {
  const pick = [];
  (function go(start, total) {
    if (found.length > 1) return;
    if (total === target && pick.length >= 2) { found.push(pick.map((x) => x.i)); return; }
    if (pick.length === 5) return;
    for (let k = start; k < items.length && found.length < 2; k++) {
      const t = total + items[k].v; if (t > target) continue;
      pick.push(items[k]); go(k + 1, t); pick.pop();
    }
  })(0, 0n);
}

function addMatch(s, p, kind, reason, cause) {
  const m = { id: 'M' + s.nextMatch++, kind, rule: p.rule, entries: p.entries.slice(), invoices: p.invoices.slice(), alloc: { ...p.alloc }, paid: p.paid, due: p.due, diff: p.diff, ccy: p.ccy, treatment: p.treatment, evidence: p.evidence, effect: p.effect, key: p.key, reason: reason || '' };
  s.matches.push(m);
  const line = log(s, { actor: kind === 'auto' ? ENGINE : 'Reviewer', action: kind === 'auto' ? 'auto-match' : kind === 'manual' ? 'manual match' : 'accept', entries: m.entries.join(' '), invoices: m.invoices.join(' '), rule: m.rule, paid: plain(m.paid), due: plain(m.due), difference: plain(m.diff), treatment: m.treatment, reason: m.reason, detail: kind === 'auto' ? (cause ? `after line ${cause}: ` : '') + RULE[m.rule].name : '' });
  m.seq = line.seq;
  return m;
}

export function recompute(s, cause) {
  for (const e of s.entries) {
    if (matchOfEntry(s, e.ref)) continue;
    const o = outcome(s, e, true);
    if (o && o.auto) addMatch(s, o.auto, 'auto', '', cause);
  }
  const suggestions = [], unmatched = [], places = new Map();
  for (const e of s.entries) {
    const m = matchOfEntry(s, e.ref);
    if (m) { places.set(e.ref, { place: m.kind === 'auto' ? 'auto' : 'person', match: m }); continue; }
    const o = outcome(s, e, false);
    if (o.sug) { suggestions.push(o.sug); places.set(e.ref, { place: 'review', sug: o.sug }); } else { unmatched.push(o.un); places.set(e.ref, { place: 'unmatched', un: o.un }); }
  }
  // conflicts: one invoice in two suggestions
  const byInv = new Map();
  for (const p of suggestions) for (const n of p.invoices) { if (!byInv.has(n)) byInv.set(n, []); byInv.get(n).push(p); }
  for (const p of suggestions) {
    const others = [...new Set(p.invoices.flatMap((n) => byInv.get(n).filter((q) => q !== p).map((q) => q.entries[0])))];
    if (others.length) p.evidence.push({ m: '≈', k: 'Conflict', t: `${p.invoices.filter((n) => byInv.get(n).length > 1).join(', ')} is also suggested for entry ${others.join(', ')}. Deciding one updates the other.` });
  }
  const mBy = new Map();
  for (const m of s.matches) for (const n of Object.keys(m.alloc)) { if (!mBy.has(n)) mBy.set(n, []); mBy.get(n).push(m.id); }
  const invState = s.invoices.map((inv) => {
    const open = openOf(s, inv);
    return { inv, open, status: open === 0n ? 'closed' : open < inv.amount ? 'partly paid' : 'open', matches: mBy.get(inv.number) || [], suggested: (byInv.get(inv.number) || []).map((p) => p.id) };
  });
  s.view = { suggestions, unmatched, places, invState, counts: counts(s, places, invState), totals: totals(s, places, invState) };
  return s.view;
}
function counts(s, places, invState) {
  const c = { auto: 0, person: 0, review: 0, unmatched: 0, entries: s.entries.length, invoices: s.invoices.length, closed: 0, partly: 0, open: 0, untouched: 0 };
  for (const p of places.values()) c[p.place]++;
  for (const x of invState) { if (x.status === 'closed') c.closed++; else if (x.status === 'partly paid') c.partly++; else c.open++; if (x.status !== 'closed' && !x.suggested.length) c.untouched++; }
  return c;
}
// the totals must add up (P3, AT10)
function totals(s, places, invState) {
  const credits = s.entries.filter((e) => e.cd === 'CRDT' && e.status === 'BOOK');
  const by = (pl) => sum(credits.filter((e) => places.get(e.ref).place === pl).map((e) => e.amt));
  const t = { credits: sum(credits.map((e) => e.amt)), auto: by('auto'), person: by('person'), review: by('review'), unmatched: by('unmatched') };
  t.matched = t.auto + t.person;
  const applied = sum(s.matches.flatMap((m) => Object.values(m.alloc)));
  const smallDiff = sum(s.matches.filter((m) => m.treatment === 'small-diff').map((m) => m.diff));
  const credit = sum(s.matches.filter((m) => m.treatment === 'credit').map((m) => m.diff));
  const invTotal = sum(s.invoices.map((i) => i.amount)), invOpen = sum(invState.map((x) => x.open));
  const matchedPaid = sum(s.matches.map((m) => m.paid));
  Object.assign(t, { applied, smallDiff, credit, invTotal, invOpen, matchedPaid });
  const entryOk = t.auto + t.person + t.review + t.unmatched === t.credits && places.size === s.entries.length;
  const invOk = applied + invOpen === invTotal;
  const payOk = matchedPaid === applied + smallDiff + credit;
  t.checks = [
    { ok: entryOk, text: `Entries: auto-matched ${amt(t.auto)} + decided by you ${amt(t.person)} + to review ${amt(t.review)} + unmatched ${amt(t.unmatched)} = credits ${amt(t.credits)}; every one of the ${s.entries.length} entries is in exactly one place.` },
    { ok: invOk, text: `Invoices: paid into invoices ${amt(applied)} + still open ${amt(invOpen)} = invoice total ${amt(invTotal)}.` },
    { ok: payOk, text: `Matched payments ${amt(matchedPaid)} = paid into invoices ${amt(applied)} + small differences ${amt(smallDiff)} + customer credit ${amt(credit)}.` },
  ];
  t.ok = entryOk && invOk && payOk;
  return t;
}

// ---------- decisions of the person ----------
function needReason(reason) { const r = String(reason || '').trim(); if (r.length < 3) throw new Error('A reason is needed (at least 3 characters).'); return r.slice(0, 500); }
function snapshot(s) { s.undo.push({ matches: s.matches.slice(), rejected: new Map(s.rejected), trailAt: s.trail.length }); }

export function accept(s, id, note = '') {
  const p = s.view.suggestions.find((x) => x.id === id); if (!p) throw new Error('This suggestion is no longer open.');
  snapshot(s);
  const m = addMatch(s, p, 'accepted', String(note || '').trim().slice(0, 500));
  s.undo[s.undo.length - 1].seq = m.seq;
  return recompute(s, m.seq);
}
export function reject(s, id, reason) {
  const r = needReason(reason);
  const m = s.matches.find((x) => x.id === id);
  const p = m || s.view.suggestions.find((x) => x.id === id);
  if (!p) throw new Error('Nothing to reject.');
  snapshot(s);
  if (m) s.matches = s.matches.filter((x) => x !== m);
  s.rejected.set(p.key, r);
  const line = log(s, { actor: 'Reviewer', action: m ? 'reject match' : 'reject', entries: p.entries.join(' '), invoices: p.invoices.join(' '), rule: p.rule, paid: plain(p.paid), due: plain(p.due), difference: plain(p.diff), reason: r, detail: m ? `undoes ${m.kind === 'auto' ? 'automatic match' : 'match'} of line ${m.seq}` : '' });
  s.undo[s.undo.length - 1].seq = line.seq;
  return recompute(s, line.seq);
}
// live balance of a selection, for the manual match
export function manualPreview(s, refs, nums) {
  const es = refs.map((r) => s.byRef.get(r)).filter(Boolean), invs = nums.map((n) => s.byNum.get(n)).filter(Boolean);
  const problems = [];
  if (!es.length) problems.push('Choose at least one statement entry.');
  if (!invs.length) problems.push('Choose at least one open invoice.');
  for (const e of es) {
    if (matchOfEntry(s, e.ref)) problems.push(`Entry ${e.ref} is already matched.`);
    if (e.cd !== 'CRDT' || e.status !== 'BOOK') problems.push(`Entry ${e.ref} is not a booked customer payment.`);
  }
  const ccys = [...new Set(invs.map((i) => i.currency))];
  if (ccys.length > 1) problems.push('The invoices are in different currencies.');
  const ccy = ccys[0] || s.stmt.ccy;
  const paids = es.map((e) => paidIn(e, ccy));
  if (paids.some((p) => p == null)) problems.push(`An entry has no amount in ${ccy}.`);
  for (const i of invs) if (openOf(s, i) <= 0n) problems.push(`${i.number} is already closed.`);
  const paid = sum(paids.filter((p) => p != null)), due = sum(invs.map((i) => openOf(s, i))), diff = paid - due;
  const options = problems.length ? [] : diff === 0n ? ['closed'] : diff < 0n ? ['partial', 'small-diff'] : ['credit', 'small-diff'];
  return { paid, due, diff, ccy, problems, options, entries: es, invoices: invs };
}
export function manual(s, refs, nums, treatment, reason) {
  const r = needReason(reason);
  const pv = manualPreview(s, refs, nums);
  if (pv.problems.length) throw new Error(pv.problems[0]);
  if (!pv.options.includes(treatment)) throw new Error('Choose how to treat the difference.');
  const invs = pv.invoices.slice().sort((a, b) => ((a.due || '') < (b.due || '') ? -1 : (a.due || '') > (b.due || '') ? 1 : a.number < b.number ? -1 : 1));
  const alloc = {};
  if (treatment === 'partial') { let left = pv.paid; for (const i of invs) { const o = openOf(s, i), a = left < o ? left : o; if (a > 0n) alloc[i.number] = a; left -= a; } }
  else for (const i of invs) alloc[i.number] = openOf(s, i);
  const p = { rule: 'MANUAL', entries: pv.entries.map((e) => e.ref), invoices: invs.map((i) => i.number), alloc, paid: pv.paid, due: pv.due, diff: pv.diff, ccy: pv.ccy, treatment, key: 'MANUAL|' + refs.join('+') + '|' + nums.join('+'),
    evidence: [{ m: '✓', k: 'Balance', t: `${amt(pv.paid)} paid, ${amt(pv.due)} due, difference ${amt(pv.diff)}.` }, { m: '✓', k: 'Reason', t: r }],
    effect: TREATMENT[treatment] + '.' };
  snapshot(s);
  const m = addMatch(s, p, 'manual', r);
  s.undo[s.undo.length - 1].seq = m.seq;
  return recompute(s, m.seq);
}
export function undo(s) {
  const u = s.undo.pop(); if (!u) throw new Error('Nothing to undo.');
  const removedAuto = s.matches.filter((m) => m.kind === 'auto' && !u.matches.includes(m) && Number(m.seq) > Number(u.seq));
  s.matches = u.matches; s.rejected = u.rejected;
  log(s, { actor: 'Reviewer', action: 'undo', detail: `undoes line ${u.seq}` + (removedAuto.length ? ` and the ${removedAuto.length} automatic match${removedAuto.length > 1 ? 'es' : ''} it allowed (line ${removedAuto.map((m) => m.seq).join(', ')})` : '') });
  return recompute(s);
}
export function changeSettings(s, settings) {
  const undone = personDecisions(s);
  s.settings = { ...settings }; s.matches = []; s.rejected = new Map(); s.undo = [];
  log(s, { actor: 'Reviewer', action: 'settings changed', detail: `${settingsText(s.settings)}; reconciliation restarted from the files; ${undone} decision${undone === 1 ? '' : 's'} by a person undone` });
  return recompute(s);
}
export const personDecisions = (s) => s.matches.filter(isPerson).length + s.rejected.size;

// ---------- audit trail: each line carries the fingerprint of the one before ----------
export const TRAIL_KEYS = ['seq', 'time', 'actor', 'action', 'entries', 'invoices', 'rule', 'paid', 'due', 'difference', 'treatment', 'reason', 'detail', 'prev'];
export const GENESIS = '0'.repeat(64);
export const fingerprint = (line) => sha256(JSON.stringify(TRAIL_KEYS.map((k) => [k, String(line[k] ?? '')])));
function log(s, ev) {
  const line = {};
  for (const k of TRAIL_KEYS) line[k] = String(ev[k] ?? '');
  line.seq = String(s.trail.length + 1); line.time = s.clock();
  line.prev = s.trail.length ? s.trail[s.trail.length - 1].fingerprint : GENESIS;
  line.fingerprint = fingerprint(line);
  s.trail.push(line);
  return line;
}
// names the first line that no longer fits; a deleted line shows at the next line
export function verifyTrail(lines) {
  if (!lines.length) return { ok: false, count: 0, problem: { line: null, message: 'The file holds no trail lines.' } };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i], n = i + 1;
    const missing = [...TRAIL_KEYS, 'fingerprint'].filter((k) => l[k] == null);
    if (missing.length) return { ok: false, count: lines.length, problem: { line: n, message: `Line ${n} is missing ${missing.join(', ')}.` } };
    if (fingerprint(l) !== l.fingerprint) return { ok: false, count: lines.length, problem: { line: n, seq: l.seq, message: `Line ${n} (sequence ${l.seq}, ${l.action}) was changed: its content no longer gives its fingerprint.` } };
    const prev = i ? lines[i - 1].fingerprint : GENESIS;
    if (l.prev !== prev) return { ok: false, count: lines.length, problem: { line: n, seq: l.seq, message: i ? `The chain breaks at line ${n} (sequence ${l.seq}): it does not follow line ${n - 1}. A line was removed, added or moved just before it.` : 'The first line is not the start of a trail: lines were removed at the top.' } };
    if (Number(l.seq) !== n) return { ok: false, count: lines.length, problem: { line: n, seq: l.seq, message: `Line ${n} has sequence number ${l.seq}: lines are missing or out of order.` } };
  }
  return { ok: true, count: lines.length, last: lines[lines.length - 1].fingerprint };
}

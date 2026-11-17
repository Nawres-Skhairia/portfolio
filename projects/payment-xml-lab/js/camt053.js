// Reconciliation Workbench: reads a camt.053.001.08 bank statement with the Payment Lab engine
// (safety gate, libxml2 schema check, then the tree reader) and runs the control checks before any matching.
// Pure: the schema validator is passed in, so the same code runs in the page and in the automatic tests.
import { safetyGate, detect } from './engine.js';
import { parseTree, kid, kids, path, text, all } from './tree.js';
import { money, euro } from './rules.js';
import { explain } from './messages.js';

export const CAMT = { id: 'camt.053.001.08', ns: 'urn:iso:std:iso:20022:tech:xsd:camt.053.001.08', xsd: 'camt.053.001.08.xsd' };

export const STM_RULES = [
  { id: 'STM-01', name: 'Official ISO 20022 schema', what: 'The statement follows the camt.053.001.08 schema, checked by libxml2 in this tab.' },
  { id: 'STM-02', name: 'Balances add up', what: 'Opening balance + booked credits − booked debits = closing balance, to the cent. Balances carry their own sign (an overdraft is negative).' },
  { id: 'STM-03', name: 'Opening and closing balance present', what: 'The statement has one opening balance (OPBD, or PRCD previous closing booked when there is no OPBD) and one closing (CLBD) booked balance.' },
  { id: 'STM-04', name: 'One currency', what: 'Every entry is in the account currency, so the balance can be checked.' },
  { id: 'STM-05', name: 'Pending entries apart', what: 'Entries that are not booked yet (status other than BOOK) are listed apart and left out of the balance and the matching.' },
  { id: 'STM-06', name: 'Bank references unique', what: 'No two entries share the same bank reference (AcctSvcrRef).' },
  { id: 'STM-07', name: 'Summary agrees', what: 'If the statement has a transaction summary, its number and sum of credits and debits agree with the entries.' },
];

const signed = (amt, cd) => (cd === 'DBIT' ? -amt : amt);
export const fmt = (v) => (v < 0n ? '−' + euro(-v) : euro(v));

function entryOf(n, i) {
  const tx = all(n, 'TxDtls');
  const t0 = tx[0] || null;
  const amtEl = kid(n, 'Amt');
  const btc = path(n, 'BkTxCd', 'Domn');
  const instd = t0 && path(t0, 'AmtDtls', 'InstdAmt', 'Amt');
  const ustrd = [], strdRefs = [];
  for (const t of tx) {
    for (const u of all(t, 'Ustrd')) ustrd.push(text(u));
    for (const r of all(t, 'CdtrRefInf')) { const v = text(kid(r, 'Ref')); if (v) strdRefs.push(v); }
  }
  const addtl = text(kid(n, 'AddtlNtryInf'));
  return {
    idx: i, line: n.line,
    ref: text(kid(n, 'AcctSvcrRef')) || `entry ${i + 1}`,
    amt: money(text(amtEl)), ccy: amtEl ? amtEl.getAttribute('Ccy') : null,
    cd: text(kid(n, 'CdtDbtInd')),
    status: text(path(n, 'Sts', 'Cd')) || text(path(n, 'Sts', 'Prtry')) || '',
    reversal: text(kid(n, 'RvslInd')) === 'true',
    bookDate: text(path(n, 'BookgDt', 'Dt')) || (text(path(n, 'BookgDt', 'DtTm')) || '').slice(0, 10),
    valDate: text(path(n, 'ValDt', 'Dt')) || (text(path(n, 'ValDt', 'DtTm')) || '').slice(0, 10),
    btc: btc ? [text(kid(btc, 'Cd')), text(path(btc, 'Fmly', 'Cd')), text(path(btc, 'Fmly', 'SubFmlyCd'))].join('/') : (text(path(n, 'BkTxCd', 'Prtry', 'Cd')) || ''),
    instd: instd ? { amt: money(text(instd)), ccy: instd.getAttribute('Ccy') } : null,
    e2e: t0 ? text(path(t0, 'Refs', 'EndToEndId')) : null,
    payer: t0 ? text(path(t0, 'RltdPties', 'Dbtr', 'Pty', 'Nm')) || text(path(t0, 'RltdPties', 'Cdtr', 'Pty', 'Nm')) : null,
    payerIban: t0 ? text(path(t0, 'RltdPties', 'DbtrAcct', 'Id', 'IBAN')) : null,
    counterIban: t0 ? text(path(t0, 'RltdPties', 'CdtrAcct', 'Id', 'IBAN')) : null,
    ustrd: ustrd.filter(Boolean), strdRefs, addtl, txCount: tx.length,
  };
}

// validateSchema(xml) -> Promise<{ valid, errors: [{ line, raw, message }] }>
export async function readStatement(src, { bytes = src.length, validateSchema }) {
  const out = { status: 'ok', reason: null, findings: [], stmt: null, schema: null, reconcilable: false };
  const refused = safetyGate(src, bytes);
  if (refused) return { ...out, status: 'refused', reason: refused };
  const det = detect(src);
  if (det.kind === 'supported') return { ...out, status: 'unsupported', reason: 'This is a pain.001 payment file, not a bank statement. Open it in the Payment file check.' };
  if (det.kind === 'not-iso') return { ...out, status: 'unsupported', reason: `Not an ISO 20022 message (${det.label}).` };
  if (det.id !== CAMT.id) return { ...out, status: 'unsupported', reason: `Recognised: ISO 20022 ${det.id}. This workbench reads bank statements in ${CAMT.id} only.` };

  const res = await validateSchema(src);
  const parserErrors = res.errors.filter((e) => /parser error/.test(e.message));
  if (parserErrors.length) {
    const e = parserErrors[0], x = explain(e.message);
    out.findings.push({ id: 'XML', severity: 'error', line: x.openLine || e.line, message: 'The statement is not well-formed XML: ' + x.message, fix: x.fix, raw: e.raw });
    return { ...out, status: 'not-wellformed', schema: { valid: false, errors: res.errors } };
  }
  out.schema = { valid: res.valid, errors: res.errors };
  const seen = new Set();
  for (const e of res.errors) {
    const k = e.line + '|' + e.message; if (seen.has(k)) continue; seen.add(k);
    const x = explain(e.message), ours = (t) => t.replace(/pain\.001\.001\.09/g, CAMT.id).replace(/pain\.001/g, 'camt.053'); const fix = x.fix ? ours(x.fix) : null;
    out.findings.push({ id: 'STM-01', severity: 'error', line: e.line, message: 'Schema: ' + ours(x.message), fix, raw: e.raw });
  }
  if (!res.valid) { out.status = 'schema-errors'; return out; }

  const tree = parseTree(src);
  const doc = tree.documentElement;
  const root = kid(doc, 'BkToCstmrStmt');
  const stmts = kids(root, 'Stmt');
  if (stmts.length !== 1) { out.status = 'unsupported'; out.reason = `The file holds ${stmts.length} statements. This first version reads one statement (one account, one day).`; return out; }
  const s = stmts[0];
  const acct = kid(s, 'Acct');
  const bals = kids(s, 'Bal').map((b) => {
    const a = kid(b, 'Amt');
    return { type: text(path(b, 'Tp', 'CdOrPrtry', 'Cd')), amt: money(text(a)), ccy: a.getAttribute('Ccy'), cd: text(kid(b, 'CdtDbtInd')), dt: text(path(b, 'Dt', 'Dt')) || (text(path(b, 'Dt', 'DtTm')) || '').slice(0, 10), line: b.line };
  });
  const entries = kids(s, 'Ntry').map(entryOf);
  // opening: OPBD, or PRCD (previous closing booked) when the bank sends that instead (Mia, PORT-42)
  const opbd = bals.filter((b) => b.type === 'OPBD'), prcd = bals.filter((b) => b.type === 'PRCD');
  const opening = opbd.length ? opbd : prcd, closing = bals.filter((b) => b.type === 'CLBD');
  const ccy = text(kid(acct, 'Ccy')) || (opening[0] && opening[0].ccy) || (entries[0] && entries[0].ccy) || '';
  const st = out.stmt = {
    msgId: text(path(root, 'GrpHdr', 'MsgId')), created: text(path(root, 'GrpHdr', 'CreDtTm')),
    id: text(kid(s, 'Id')), iban: text(path(acct, 'Id', 'IBAN')) || text(path(acct, 'Id', 'Othr', 'Id')), ccy,
    owner: text(path(acct, 'Ownr', 'Nm')), from: text(path(s, 'FrToDt', 'FrDtTm')), to: text(path(s, 'FrToDt', 'ToDtTm')),
    opening: opening[0] || null, closing: closing[0] || null, entries,
    date: (closing[0] && closing[0].dt) || (entries[0] && entries[0].bookDate) || '',
  };

  // STM-03
  if (opening.length !== 1 || closing.length !== 1) {
    out.findings.push({ id: 'STM-03', severity: 'error', line: s.line, message: `The statement has ${opening.length} opening (OPBD, or PRCD previous closing) and ${closing.length} closing (CLBD) balances. Exactly one of each is needed for the balance check.`, fix: 'Ask for a statement that carries its opening and closing booked balances.' });
  }
  // STM-04
  for (const e of entries) if (e.ccy !== ccy) out.findings.push({ id: 'STM-04', severity: 'error', line: e.line, message: `Entry ${e.ref} is in ${e.ccy}, the account is in ${ccy}. The balance cannot be checked across currencies.`, fix: 'A statement lists every entry in the account currency; the original currency belongs in the amount details.' });
  for (const b of bals) if (b.ccy !== ccy) out.findings.push({ id: 'STM-04', severity: 'error', line: b.line, message: `The ${b.type} balance is in ${b.ccy}, the account is in ${ccy}.`, fix: null });
  // STM-05
  const booked = entries.filter((e) => e.status === 'BOOK'), pending = entries.filter((e) => e.status !== 'BOOK');
  for (const e of pending) out.findings.push({ id: 'STM-05', severity: 'info', line: e.line, message: `Entry ${e.ref} has status ${e.status || 'unknown'}, not booked. It is listed apart and left out of the balance and the matching.`, fix: null });
  // STM-06
  const refs = new Map();
  for (const e of entries) { if (refs.has(e.ref)) out.findings.push({ id: 'STM-06', severity: 'warning', line: e.line, message: `Bank reference ${e.ref} is used twice (also on line ${refs.get(e.ref)}). Check the statement was not exported twice.`, fix: null }); else refs.set(e.ref, e.line); }
  // totals of booked entries
  let credits = 0n, debits = 0n, nCr = 0, nDb = 0;
  for (const e of booked) { if (e.amt == null) continue; if (e.cd === 'CRDT') { credits += e.amt; nCr++; } else { debits += e.amt; nDb++; } }
  st.totals = { credits, debits, nCr, nDb, pending: pending.length };
  // STM-02
  let balanceOk = false;
  if (opening.length === 1 && closing.length === 1) {
    const o = signed(st.opening.amt, st.opening.cd), c = signed(st.closing.amt, st.closing.cd);
    const expected = o + credits - debits;
    balanceOk = expected === c;
    st.balance = { opening: o, closing: c, expected, ok: balanceOk };
    if (!balanceOk) out.findings.push({ id: 'STM-02', severity: 'error', line: st.closing.line, message: `The balances do not add up: opening ${fmt(o)} + credits ${euro(credits)} − debits ${euro(debits)} = ${fmt(expected)}, but the closing balance says ${fmt(c)} (difference ${fmt(c - expected)}).`, fix: 'An entry is missing, counted twice or has the wrong amount or credit/debit sign. The statement is not reconciled until this is solved.' });
  }
  // STM-07
  const sum = kid(s, 'TxsSummry');
  if (sum) {
    const chk = (el, n, total, label) => {
      if (!el) return;
      const nb = text(kid(el, 'NbOfNtries')), sm = text(kid(el, 'Sum'));
      if ((nb != null && Number(nb) !== n) || (sm != null && money(sm) !== total)) out.findings.push({ id: 'STM-07', severity: 'warning', line: el.line, message: `The summary says ${nb ?? '?'} ${label} for ${sm ?? '?'}, the entries give ${n} for ${euro(total)}.`, fix: null });
    };
    chk(kid(sum, 'TtlCdtNtries'), nCr, credits, 'credits'); chk(kid(sum, 'TtlDbtNtries'), nDb, debits, 'debits');
  }
  const blocking = out.findings.some((f) => f.severity === 'error');
  out.status = blocking ? 'control-errors' : 'ok';
  out.reconcilable = !blocking;
  return out;
}

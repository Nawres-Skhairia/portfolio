// Reconciliation Workbench: our own small CSV reader for the list of open invoices.
// Quotes and separators are handled; nothing in a cell is ever run as a formula; amounts are exact (BigInt).
// The decimal mark is chosen once for the whole file, never guessed cell by cell (Daniel, PORT-39).
import { money, ibanIsValid } from './rules.js';

export const MAX_INVOICE_BYTES = 2 * 1024 * 1024;
export const MAX_INVOICES = 5000;
export const INVOICE_FIELDS = [
  { key: 'number', label: 'Invoice number', required: true, names: ['invoice', 'invoicenumber', 'invoiceno', 'invoiceid', 'invoicenr', 'number', 'nr', 'no', 'rechnung', 'rechnungsnummer', 'facture', 'numerofacture', 'factura'] },
  { key: 'customer', label: 'Customer', required: true, names: ['customer', 'customername', 'client', 'clientname', 'debtor', 'debtorname', 'kunde', 'name'] },
  { key: 'account', label: 'Customer account (IBAN)', required: false, names: ['customeraccount', 'customeriban', 'iban', 'account', 'accountiban', 'debtoraccount', 'debtoriban', 'payeriban'] },
  { key: 'amount', label: 'Amount', required: true, names: ['amount', 'openamount', 'amountdue', 'total', 'betrag', 'montant', 'importe'] },
  { key: 'currency', label: 'Currency', required: true, names: ['currency', 'ccy', 'cur', 'waehrung', 'wahrung', 'devise', 'moneda'] },
  { key: 'due', label: 'Due date', required: false, names: ['duedate', 'dueon', 'faelligkeit', 'faellig', 'falligkeit', 'fallig', 'falligam', 'echeance', 'vencimiento'] },
  { key: 'reference', label: 'Payment reference', required: false, names: ['reference', 'paymentreference', 'ref', 'rf', 'rfreference', 'creditorreference', 'structuredreference'] },
];
// decimals each currency allows (ISO 4217 minor units); 2 for any other
export const MINOR = { JPY: 0, KRW: 0, ISK: 0, CLP: 0, VND: 0, XOF: 0, XAF: 0, BHD: 3, KWD: 3, OMR: 3, JOD: 3, TND: 3, LYD: 3, IQD: 3 };
const norm = (h) => h.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

export function splitCsv(text, sep) {
  const rows = []; let row = [], cell = '', q = false, line = 1, rowLine = 1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else { if (c === '\n') line++; cell += c; }
      continue;
    }
    if (c === '"' && cell === '') q = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = ''; rows.push({ cells: row, line: rowLine }); row = []; line++; rowLine = line;
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push({ cells: row, line: rowLine }); }
  return rows.filter((r) => r.cells.some((c) => c.trim() !== ''));
}
function guessSep(text) {
  const first = text.split(/\r?\n/).find((l) => l.trim() && !l.startsWith('#')) || '';
  const count = (ch) => first.split('"').filter((_, i) => i % 2 === 0).join('').split(ch).length - 1;
  const c = { ',': count(','), ';': count(';'), '\t': count('\t') };
  return Object.entries(c).sort((a, b) => b[1] - a[1])[0][0];
}

// what one amount says about the decimal mark: '.', ',', 'ambiguous' or null (no separator)
function markOf(v) {
  const dot = v.split('.').length - 1, com = v.split(',').length - 1;
  if (dot && com) return v.lastIndexOf('.') > v.lastIndexOf(',') ? '.' : ',';
  const sep = dot ? '.' : com ? ',' : null; if (!sep) return null;
  if ((dot || com) > 1) return sep === '.' ? ',' : '.'; // used for thousands
  const after = v.length - v.indexOf(sep) - 1;
  return after === 3 ? 'ambiguous' : sep;
}
export function parseAmount(raw, dec) {
  const v = raw.replace(/[\s  ']/g, '');
  if (!/^\d[\d.,]*$/.test(v)) return null;
  const th = dec === '.' ? ',' : '.';
  let [int, frac, extra] = v.split(dec);
  if (extra != null) return null;
  if (int.includes(th)) { if (!new RegExp('^\\d{1,3}(\\' + th + '\\d{3})+$').test(int)) return null; int = int.split(th).join(''); }
  if (frac != null && !/^\d{1,5}$/.test(frac)) return null;
  return money(frac != null ? int + '.' + frac : int);
}
function isoDate(v) {
  let m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/); if (m) return ok(m[1], m[2], m[3]);
  m = v.match(/^(\d{2})[./](\d{2})[./](\d{4})$/); if (m) return ok(m[3], m[2], m[1]);
  return null;
  function ok(y, mo, d) { const s = `${y}-${mo}-${d}`; const t = Date.parse(s + 'T00:00:00Z'); return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s ? s : null; }
}

// readInvoices(text, { mapping: { key: columnIndex }, decimal: '.' | ',' })
export function readInvoices(src, opts = {}) {
  const out = { ok: false, error: null, problems: [], headers: [], mapping: null, needsMapping: false, decimal: null, decimalSource: null, sep: null, invoices: [] };
  const bytes = new TextEncoder().encode(src).length;
  if (bytes > MAX_INVOICE_BYTES) return { ...out, error: `The invoice list is ${(bytes / 1048576).toFixed(1)} MB. The limit is 2 MB.` };
  const text = src.replace(/^﻿/, '');
  if (!text.trim()) return { ...out, error: 'The invoice list is empty.' };
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(text)) return { ...out, error: 'The invoice list contains control characters. Save it as a plain CSV text file in UTF-8.' };
  const sep = out.sep = guessSep(text);
  const rows = splitCsv(text, sep).filter((r) => !r.cells[0].startsWith('#'));
  if (rows.length < 2) return { ...out, error: 'The invoice list needs a header line and at least one invoice.' };
  if (rows.length - 1 > MAX_INVOICES) return { ...out, error: `The list has ${rows.length - 1} invoices. The limit is ${MAX_INVOICES.toLocaleString('en')}.` };
  const headers = out.headers = rows[0].cells.map((c) => c.trim());
  let mapping = opts.mapping;
  if (!mapping) {
    mapping = {};
    const used = new Set();
    for (const f of INVOICE_FIELDS) {
      const i = headers.findIndex((h, k) => !used.has(k) && f.names.includes(norm(h)));
      if (i >= 0) { mapping[f.key] = i; used.add(i); }
    }
  }
  out.mapping = mapping;
  const missing = INVOICE_FIELDS.filter((f) => f.required && !(mapping[f.key] >= 0));
  if (missing.length) { out.needsMapping = true; out.error = 'Some columns could not be recognised: ' + missing.map((f) => f.label).join(', ') + '. Choose which column holds each one.'; return out; }

  const body = rows.slice(1);
  const cell = (r, k) => (mapping[k] >= 0 ? String(r.cells[mapping[k]] ?? '').trim() : '');
  // the decimal mark, once for the whole file
  let dec = opts.decimal || null;
  if (dec) out.decimalSource = 'chosen';
  else {
    const marks = new Set(body.map((r) => markOf(cell(r, 'amount').replace(/[\s  ']/g, ''))).filter((m) => m && m !== 'ambiguous'));
    const amb = body.some((r) => markOf(cell(r, 'amount').replace(/[\s  ']/g, '')) === 'ambiguous');
    if (marks.size > 1) return { ...out, error: 'The amounts use both a decimal point and a decimal comma. Use one decimal mark for the whole file.' };
    if (marks.size === 1) { dec = [...marks][0]; out.decimalSource = 'detected'; }
    else if (amb) { out.needsMapping = true; out.error = 'Amounts such as "1,200" can be read as 1.2 or as 1200. Choose the decimal mark the file uses.'; return out; }
    else { dec = '.'; out.decimalSource = 'not needed (whole amounts)'; }
  }
  out.decimal = dec;
  const seen = new Map();
  for (const r of body) {
    const p = (m) => out.problems.push({ line: r.line, message: m });
    const number = cell(r, 'number'), customer = cell(r, 'customer');
    const rawAmt = cell(r, 'amount'), amount = parseAmount(rawAmt, dec);
    const currency = cell(r, 'currency').toUpperCase();
    const account = cell(r, 'account').replace(/\s+/g, '').toUpperCase();
    const dueRaw = cell(r, 'due'), due = dueRaw ? isoDate(dueRaw) : null;
    const reference = cell(r, 'reference');
    if (!number) p('The invoice number is empty.');
    else if (seen.has(number)) p(`Invoice number ${number} is also on line ${seen.get(number)}.`);
    else seen.set(number, r.line);
    if (!customer) p(`Invoice ${number || '?'}: the customer is empty.`);
    if (/^\s*(-|\(|\u2212)/.test(rawAmt) || /-\s*$/.test(rawAmt)) p(`Invoice ${number || '?'}: "${rawAmt}" is a negative amount. Credit notes are not in this version: leave them out of the list.`);
    else if (amount == null) p(`Invoice ${number || '?'}: "${rawAmt}" is not an amount with the decimal mark "${dec}".`);
    else if (amount === 0n) p(`Invoice ${number || '?'}: the amount is zero.`);
    if (amount != null && amount > 0n && /^[A-Z]{3}$/.test(currency)) { const mu = MINOR[currency] ?? 2; if (mu === 0 && rawAmt.includes(dec)) p(`Invoice ${number || '?'}: "${rawAmt}" has a decimal mark, but ${currency} has no decimals. Write the whole amount without separators, for example 1000.`); else if (amount % (10n ** BigInt(5 - mu)) !== 0n) p(`Invoice ${number || '?'}: "${rawAmt}" has more decimals than ${currency} allows (${mu}).`); }
    if (!/^[A-Z]{3}$/.test(currency)) p(`Invoice ${number || '?'}: "${cell(r, 'currency')}" is not a 3-letter currency code.`);
    if (account && !(/^[A-Z]{2}\d{2}[A-Z0-9]{1,30}$/.test(account) && ibanIsValid(account))) p(`Invoice ${number || '?'}: the customer account "${cell(r, 'account')}" is not a valid IBAN.`);
    if (dueRaw && !due) p(`Invoice ${number || '?'}: the due date "${dueRaw}" is not a date (use 2026-11-17 or 17.11.2026).`);
    out.invoices.push({ number, customer, account: account || null, amount, currency, due, reference: reference || null, line: r.line });
  }
  if (out.problems.length) { out.error = `${out.problems.length} problem${out.problems.length > 1 ? 's' : ''} in the invoice list. Nothing was reconciled.`; out.invoices = []; return out; }
  out.invoices.sort((a, b) => (a.number < b.number ? -1 : a.number > b.number ? 1 : 0));
  out.ok = true;
  return out;
}

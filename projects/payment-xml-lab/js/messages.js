// Plain-language table for libxml2 messages (layers 1 and 2), plus a business dictionary of field names.

export const FIELDS = {
  Document: 'the message', CstmrCdtTrfInitn: 'credit transfer initiation', GrpHdr: 'group header', MsgId: 'message ID',
  CreDtTm: 'creation date and time', NbOfTxs: 'number of payments', CtrlSum: 'control sum', InitgPty: 'initiating party',
  PmtInf: 'payment batch', PmtInfId: 'payment batch ID', PmtMtd: 'payment method', BtchBookg: 'batch booking',
  PmtTpInf: 'payment type', SvcLvl: 'service level', ReqdExctnDt: 'requested execution date', Dt: 'date', DtTm: 'date and time',
  Dbtr: 'debtor (payer)', DbtrAcct: 'debtor account', DbtrAgt: 'debtor bank', ChrgBr: 'charge bearer',
  CdtTrfTxInf: 'payment', PmtId: 'payment references', InstrId: 'instruction ID', EndToEndId: 'end-to-end reference',
  UETR: 'UETR tracking number', Amt: 'amount', InstdAmt: 'amount', CdtrAgt: 'creditor bank', Cdtr: 'creditor (payee)',
  CdtrAcct: 'creditor account', RmtInf: 'remittance information', Ustrd: 'remittance text', Strd: 'structured remittance',
  IBAN: 'IBAN', BICFI: 'BIC', Nm: 'name', Ccy: 'currency', FinInstnId: 'bank identification', Id: 'identification',
  PstlAdr: 'postal address', Ctry: 'country', AdrLine: 'address line', UltmtDbtr: 'ultimate debtor', UltmtCdtr: 'ultimate creditor',
  Purp: 'purpose', Cd: 'code',
};
export const fieldName = (n) => (FIELDS[n] ? `${FIELDS[n]} (${n})` : n);

const TYPES = {
  ISODateTime: { what: 'a date and time in ISO format', example: '2026-11-16T10:30:00', fix: 'Write the date, a capital T, then the time, for example 2026-11-16T10:30:00.' },
  ISODate: { what: 'a date in ISO format', example: '2026-11-17', fix: 'Write year-month-day with dashes, for example 2026-11-17.' },
  ActiveOrHistoricCurrencyAndAmount_SimpleType: { what: 'an amount with a dot for decimals, no thousands separator', example: '1250.00', fix: 'Use a dot for decimals and no spaces or commas, for example 1250.00.' },
  DecimalNumber: { what: 'a number with a dot for decimals', example: '1150.25', fix: 'Use a dot for decimals and no spaces or commas.' },
  Max15NumericText: { what: 'a whole number of up to 15 digits', example: '3', fix: 'Write digits only.' },
  BICFIDec2014Identifier: { what: 'a BIC: 8 or 11 capital letters and digits', example: 'XMPLDEFFXXX', fix: 'A BIC has 4 characters for the bank, 2 letters for the country, 2 for the location and optionally 3 for the branch.' },
  IBAN2007Identifier: { what: 'an IBAN: 2 letters, 2 digits, then up to 30 letters or digits, no spaces', example: 'DE89370400440532013000', fix: 'Remove spaces and use capital letters for the country.' },
  ActiveOrHistoricCurrencyCode: { what: 'a 3-letter currency code in capitals', example: 'EUR', fix: 'Use capitals, for example EUR.' },
  UUIDv4Identifier: { what: 'a UUID version 4', example: 'eb6305c9-1f7f-49de-aed0-16487c27b42d', fix: 'Use a lower-case version 4 UUID.' },
};
const typeInfo = (t) => TYPES[t] || null;
const local = (q) => (q || '').replace(/^\{[^}]*\}/, '');
const list = (s) => s.split(',').map((x) => '<' + local(x.trim()) + '>').join(', ');

// in: one libxml2 message (without the "payment.xml:N:" part). out: { layer, element, message, expected, found, fix, ref }
export function explain(raw) {
  let m;
  if ((m = raw.match(/parser error : Opening and ending tag mismatch: (\S+) line (\d+) and (\S+)/))) {
    return { layer: 'xml', element: m[1], openLine: Number(m[2]), message: `The tag <${m[1]}> opened on line ${m[2]} is never closed: the next closing tag is </${m[3]}>.`, expected: `</${m[1]}>`, found: `</${m[3]}>`, fix: `Add </${m[1]}> where the ${FIELDS[m[1]] || m[1]} ends.`, ref: 'XML 1.0 well-formedness' };
  }
  if ((m = raw.match(/parser error : (.*)$/))) {
    return { layer: 'xml', element: '', message: 'The file is not well-formed XML: ' + m[1].trim().replace(/\.$/, '') + '.', fix: 'Fix the XML syntax at this line; nothing else can be checked until then.', ref: 'XML 1.0 well-formedness' };
  }
  const el = local((raw.match(/Element '([^']+)'/) || [])[1]);
  const at = el ? fieldName(el) : 'this element';
  if ((m = raw.match(/This element is not expected\. Expected is (?:one of )?\( (.*) \)/))) {
    const exp = list(m[1]);
    const first = local(m[1].split(',')[0].trim());
    return { layer: 'xsd', element: el, message: `<${el}> is not allowed at this place. ISO 20022 fixes the order of elements, and here it expects ${m[1].includes(',') ? 'one of ' + exp : '<' + first + '>'}.`, expected: m[1].includes(',') ? exp : '<' + first + '>', found: '<' + el + '>', fix: m[1].includes(',') ? `Move <${el}> to its correct place, or remove it if it does not belong in a pain.001 file.` : `Add the missing <${first}> (${FIELDS[first] || first}) before <${el}>.`, ref: 'XSD sequence' };
  }
  if ((m = raw.match(/This element is not expected\.$/))) {
    return { layer: 'xsd', element: el, message: `<${el}> is not allowed here.`, found: '<' + el + '>', fix: 'Remove it or move it to its correct place.', ref: 'XSD sequence' };
  }
  if ((m = raw.match(/Missing child element\(s\)\. Expected is (?:one of )?\( (.*) \)/))) {
    const first = local(m[1].split(',')[0].trim());
    return { layer: 'xsd', element: el, message: `The ${at} is incomplete: a required element is missing (${list(m[1])}).`, expected: list(m[1]), fix: `Add <${first}> (${FIELDS[first] || first}) inside <${el}>.`, ref: 'XSD required element' };
  }
  if ((m = raw.match(/\[facet 'pattern'\] The value '(.*)' is not accepted by the pattern '(.*)'/))) {
    const t = el === 'BICFI' ? TYPES.BICFIDec2014Identifier : el === 'IBAN' ? TYPES.IBAN2007Identifier : el === 'Ccy' ? TYPES.ActiveOrHistoricCurrencyCode : null;
    return { layer: 'xsd', element: el, message: `The ${at} "${m[1]}" does not have the required format${t ? ': ' + t.what : ''}.`, expected: t ? 'like ' + t.example : 'pattern ' + m[2], found: m[1], fix: t ? t.fix : 'Correct the value to match the format.', ref: 'XSD pattern' };
  }
  if ((m = raw.match(/\[facet 'maxLength'\] The value has a length of '(\d+)'; this exceeds the allowed maximum length of '(\d+)'/))) {
    return { layer: 'xsd', element: el, message: `The ${at} has ${m[1]} characters; the schema allows at most ${m[2]}.`, expected: `at most ${m[2]} characters`, found: `${m[1]} characters`, fix: 'Shorten the value.', ref: 'XSD maxLength' };
  }
  if ((m = raw.match(/\[facet 'minLength'\] The value has a length of '(\d+)'; this underruns the allowed minimum length of '(\d+)'/))) {
    return { layer: 'xsd', element: el, message: `The ${at} is empty or too short (${m[1]} characters, at least ${m[2]} needed).`, expected: `at least ${m[2]} characters`, found: `${m[1]} characters`, fix: 'Fill in the value, or remove the element if it is optional.', ref: 'XSD minLength' };
  }
  if ((m = raw.match(/\[facet 'enumeration'\] The value '(.*)' is not an element of the set \{(.*)\}/))) {
    const set = m[2].replace(/'/g, '');
    return { layer: 'xsd', element: el, message: `The ${at} "${m[1]}" is not one of the allowed codes.`, expected: set, found: m[1], fix: 'Use one of the allowed codes.', ref: 'XSD enumeration' };
  }
  if ((m = raw.match(/\[facet 'fractionDigits'\] The value '(.*)' has more fractional digits than are allowed \('(\d+)'\)/))) {
    return { layer: 'xsd', element: el, message: `The ${at} ${m[1]} has more than ${m[2]} decimals.`, expected: `at most ${m[2]} decimals`, found: m[1], fix: 'Round the value.', ref: 'XSD fractionDigits' };
  }
  if ((m = raw.match(/\[facet 'totalDigits'\] The value '(.*)' has more digits than are allowed \('(\d+)'\)/))) {
    return { layer: 'xsd', element: el, message: `The ${at} ${m[1]} has more than ${m[2]} digits in total.`, expected: `at most ${m[2]} digits`, found: m[1], fix: 'Check the value; split very large amounts.', ref: 'XSD totalDigits' };
  }
  if ((m = raw.match(/\[facet 'minInclusive'\] The value '(.*)' is less than the minimum value allowed \('(.*)'\)/))) {
    return { layer: 'xsd', element: el, message: `The ${at} ${m[1]} is below the minimum of ${m[2]}.`, expected: `${m[2]} or more`, found: m[1], fix: 'Amounts cannot be negative.', ref: 'XSD minInclusive' };
  }
  if ((m = raw.match(/: '([^']*)' is not a valid value of the atomic type '([^']+)'/))) {
    const t = typeInfo(local(m[2]));
    return { layer: 'xsd', element: el, message: `The ${at} is not ${t ? t.what : 'in the right format'}: found ${m[1]}${t ? ', expected something like ' + t.example : ''}.`, expected: t ? t.example : local(m[2]), found: m[1], fix: t ? t.fix : 'Correct the value.', ref: local(m[2]) };
  }
  if ((m = raw.match(/The attribute '([^']+)' is required but missing/))) {
    return { layer: 'xsd', element: el, message: `The ${at} needs the attribute ${m[1]}${m[1] === 'Ccy' ? ' (the currency, for example Ccy="EUR")' : ''}.`, expected: `${m[1]}="…"`, fix: `Add ${m[1]}="…" to <${el}>.`, ref: 'XSD required attribute' };
  }
  if ((m = raw.match(/The attribute '([^']+)' is not allowed/))) {
    return { layer: 'xsd', element: el, message: `<${el}> has an attribute ${m[1]} that the schema does not allow.`, found: m[1], fix: 'Remove the attribute.', ref: 'XSD attributes' };
  }
  if (/Element 'Document': No matching global declaration|No matching global declaration available for the validation root/.test(raw)) {
    return { layer: 'xsd', element: el, message: 'The root element or its namespace is not the one of pain.001.001.09.', expected: '<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.09">', fix: 'Check the first element and its xmlns.', ref: 'XSD root' };
  }
  if (/Character content other than whitespace is not allowed/.test(raw)) {
    return { layer: 'xsd', element: el, message: `<${el}> holds text directly, but it may only contain other elements.`, fix: 'Move the text into the right child element.', ref: 'XSD content model' };
  }
  return { layer: 'xsd', element: el, message: `The ${at} does not follow the schema.`, fix: 'See the technical detail below.', ref: 'XSD' };
}

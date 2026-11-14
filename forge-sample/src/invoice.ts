/** Invoice rules. See ../invoice-requirements.md. */

export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** Discount rate for an invoice amount in EUR. */
export function discountRate(amount: number): number {
  if (amount >= 5000) return 0.1;
  if (amount > 1000) return 0.05; // Deliberate defect: the requirement says "from 1,000 EUR".
  return 0;
}

export function invoiceTotal(amount: number) {
  const discount = round2(amount * discountRate(amount));
  const net = round2(amount - discount);
  const vat = round2(net * 0.2);
  return { discount, net, vat, total: round2(net + vat) };
}

/** Due date: 30 days after the invoice date (YYYY-MM-DD). */
export function dueDate(invoiceDate: string): string {
  const d = new Date(invoiceDate + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 30);
  return d.toISOString().slice(0, 10);
}

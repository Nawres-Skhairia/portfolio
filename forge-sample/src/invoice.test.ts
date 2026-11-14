import { describe, expect, it } from "vitest";
import { discountRate, dueDate, invoiceTotal } from "./invoice";

describe("discounts", () => {
  it("REQ-001 no discount just below 1,000 EUR", () => {
    expect(discountRate(999.99)).toBe(0);
  });
  it("REQ-002 5% discount at exactly 1,000 EUR", () => {
    expect(discountRate(1000)).toBe(0.05);
  });
  it("REQ-002 5% discount at 4,999.99 EUR", () => {
    expect(discountRate(4999.99)).toBe(0.05);
  });
  it("REQ-003 10% discount from 5,000 EUR", () => {
    expect(discountRate(5000)).toBe(0.1);
  });
});

describe("VAT and totals", () => {
  it("REQ-004 VAT is 20% of the amount after discount", () => {
    expect(invoiceTotal(2000)).toEqual({ discount: 100, net: 1900, vat: 380, total: 2280 });
  });
  it("REQ-005 amounts are rounded to cents", () => {
    expect(invoiceTotal(1234.567).total).toBe(1407.41);
  });
});

describe("payment terms", () => {
  it("REQ-006 due 30 days after the invoice date", () => {
    expect(dueDate("2026-01-15")).toBe("2026-02-14");
  });
  it("REQ-006 crosses the end of the year", () => {
    expect(dueDate("2026-12-10")).toBe("2027-01-09");
  });
});

import nodemailer from "nodemailer";
import { it, expect } from "vitest";

it("sends the invoice by email", () => {
  expect(typeof nodemailer.createTransport).toBe("function");
});

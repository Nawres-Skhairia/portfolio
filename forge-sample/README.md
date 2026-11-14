# FORGE sample: invoice rules

A tiny example project for trying FORGE's codebase and testing features.

- `invoice-requirements.md`: the requirements (upload it to a FORGE project).
- `src/`: the code and its unit tests (Vitest style). Test names mention the requirement they check, such as `REQ-002`.
- One defect is left in on purpose: the 5% discount starts above 1,000 EUR instead of at 1,000 EUR, so one test fails.
- `src/email.test.ts` needs the `nodemailer` package, so FORGE lists it as "not run" instead of pretending.

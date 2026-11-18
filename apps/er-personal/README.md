# My Expense Radar (private, single owner)

A private copy of Expense Radar for the site owner only. It is a separate Vercel project
(`nawres-expense-radar`, Root Directory `apps/er-personal`) and is not linked from the portfolio.

- There is no sign-up. The first and only account is created with the one-time setup code.
- Data is encrypted on the phone before it leaves it. The server only stores ciphertext.
- The passphrase and the recovery code never reach the server.
- No real figures in the repo, tests, previews, logs or error reports.

## Settings (Production only, names only)
- `ER_DATABASE_URL` (and the other `ER_DATABASE_*` from a Neon Free store in Frankfurt, preview branching off)
- `ER_SESSION_SECRET` (32 characters or more)
- `ER_PUBLIC_ORIGIN` (the fixed https address of this site)
- `ER_SETUP_CODE` (20 characters or more, Sensitive; delete it after setup)

## Checks
- `node --test tests/er-personal.test.mjs` (server part needs `ER_TEST_DATABASE_URL` to a throwaway Postgres)
- `node apps/er-personal/build.mjs`

Any change to the crypto, the API or the CSP needs a security re-review before merge.

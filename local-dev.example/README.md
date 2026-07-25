# Local dev test accounts (gitignored)

Scripts and credentials for seeding `a@example.com` … `g@example.com` test users live here — **not** in the repo.

## Setup

```bash
npm run setup:local-dev
```

Edit `local-dev/test-accounts.env` and set `TEST_ACCOUNT_PASSWORD`. That file is gitignored.

## Commands (from repo root)

```bash
node scripts/seed-test-users.mjs
node scripts/delete-test-users.mjs
node scripts/test-sdk-account-c.mjs
node scripts/live-dummy-experiment-c.mjs
npm run seed:showcase
```

Playwright e2e and demo clip recording read the same `local-dev/test-accounts.env` when present.

## Layout

| Account | Lab | Role |
|---------|-----|------|
| a@example.com | Lab Alpha (owner) | Professor |
| b@example.com | Lab Beta (owner) | Professor |
| c@example.com | Lab Beta | PhD |
| d@example.com | Lab Beta | PhD |
| e@example.com | Lab Beta | Masters |
| f@example.com | Lab Beta | Masters |
| g@example.com | — | Standalone |

Emails are in `accounts.mjs` (no secrets). Password only in `test-accounts.env`.

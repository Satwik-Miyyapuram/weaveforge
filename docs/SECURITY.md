# Security Policy

WeaveForge talks directly to your own Supabase project. The web app holds
Supabase credentials (a public anon key + your session), and the Python SDK uses
**personal access tokens** that act on your behalf under Row-Level Security.
Please treat credential handling and access-control (RLS) issues as
security-sensitive.

> **Note:** client-side E2EE has been dropped. Data is now stored server-side
> with encryption at rest, and **Postgres Row-Level Security is the sole access
> boundary**. This is not end-to-end / zero-knowledge — an operator with database
> access can technically read content. See the root [`SECURITY.md`](../SECURITY.md)
> "Data protection model" section.

## Reporting a vulnerability

**Do not open a public issue for security reports.**

- Preferred: use GitHub's **private vulnerability reporting** —
  the repo's **Security → Report a vulnerability** tab.
- Alternatively, email the maintainer at **satwik.miyyapuram+weaveforge@gmail.com** with
  `SECURITY` in the subject.

Please include: a description, steps to reproduce, affected component
(web app / Python SDK / migrations), and impact. We aim to acknowledge within
a few days and will coordinate a fix and disclosure timeline with you.

## Scope

In scope: authentication/session handling, Row-Level Security policies in the
`supabase/migrations/`, secret handling in the web app and Python SDK,
share-link redemption, API token hashing (`0061`), signed-URL / storage-bucket
policies, and share-link rate limits (`0049`, `0056`, `0058`).

Out of scope: issues in your own Supabase project configuration, and anything
requiring a compromised developer machine or leaked credentials that were not
mishandled by this codebase.

## Good practice for users

- The **anon key** is public by design — RLS is the security boundary. Never
  commit the **service_role** key, API tokens, or your account password. `.env*`
  files are git-ignored.
- **Access control:** RLS is the boundary. A row is readable only by its owner
  or someone it is explicitly shared with. External share links grant scoped
  read access to whoever redeems them at `/link` — treat link URLs like passwords.
- **Integration secrets** (Zotero / GitLab / Semantic Scholar keys) are encrypted
  with a server-held key, not exposed to the AI/MCP layer.
- **API tokens** (`tt_…`) are shown once at creation; revoke unused tokens in
  Settings. Tokens grant the same RLS scope as your user account.
- Scope experiments to a project and keep buckets private (the migrations set
  them private by default).
- Hosted Supabase leaked-password protection is available only on plans that
  support it. The project currently used for development is below that tier;
  enable the setting after upgrading, or configure equivalent protection when
  self-hosting Auth.

## Self-host operators

Content is stored server-side with the database's encryption at rest; there is
no client-side encryption to audit. Access is enforced entirely by RLS — when
self-hosting, verify every entity table's policies resolve to owner-or-shared
before exposing the instance, and keep storage buckets private (the migrations
set them private by default).

> History: earlier releases shipped client-side E2EE (migrations `0037`–`0041`,
> key/recovery tables `0089`–`0095`). It was dropped in favour of the at-rest +
> RLS model; the key tables remain until the Phase-5 cleanup
> (`docs/future-work/phase5-drop-e2ee.sql`).

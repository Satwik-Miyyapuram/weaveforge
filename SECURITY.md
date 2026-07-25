# Security Policy

Thesis Tracker talks directly to your own Supabase project. The web app and the
Python SDK hold Supabase credentials (a public anon key + your email/password, or
a project id), and the SDK can upload files and write rows on your behalf. Please
treat credential handling and access-control (RLS) issues as security-sensitive.

## Data protection model

WeaveForge protects your research data with **encryption at rest** (your Supabase
project's managed disk encryption) plus **Postgres Row-Level Security** as the
access-control boundary — a row is readable only by its owner or someone it is
explicitly shared with (`shared_to_me`). Third-party integration secrets (Overleaf
git token, Zotero / Semantic Scholar keys) are additionally encrypted with a
server-held key.

This is **not** end-to-end / zero-knowledge encryption: an operator with database
access can technically read your content. Earlier versions shipped client-side
E2EE; it was dropped because the product already held a server-side recovery
secret (so it was never truly zero-knowledge) and the keyring/unlock/recovery
burden outweighed the guarantee it could honestly make. If you need the operator
to be unable to read your data, this deployment is not the right fit.

## Reporting a vulnerability

**Do not open a public issue for security reports.**

- Preferred: use GitHub's **private vulnerability reporting** —
  the repo's **Security → Report a vulnerability** tab.
- Alternatively, email the maintainer at **pandu.satwik@gmail.com** with
  `SECURITY` in the subject.

Please include: a description, steps to reproduce, affected component
(web app / Python SDK / migrations), and impact. We aim to acknowledge within
a few days and will coordinate a fix and disclosure timeline with you.

## Scope

In scope: authentication/session handling, Row-Level Security policies in the
`supabase/migrations/`, secret handling in the web app and Python SDK, and the
signed-URL / storage-bucket policies.

Out of scope: issues in your own Supabase project configuration, and anything
requiring a compromised developer machine or leaked credentials that were not
mishandled by this codebase.

## Good practice for users

- The **anon key** is public by design — RLS is the security boundary. Never
  commit the **service_role** key or your account password. `.env*` files are
  git-ignored.
- Scope experiments to a project and keep buckets private (the migrations set
  them private by default).

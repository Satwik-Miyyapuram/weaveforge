# Encryption recovery and remembered devices

**This feature no longer exists.** Client-side end-to-end encryption was dropped,
and every mechanism this document used to describe went with it: the browser
device secret, the wrapped user master key, the email recovery link, the optional
recovery passphrase and one-time code, and cross-browser device transfer.

There is nothing to unlock. Signing in gives you your data. A new browser needs
no transfer request, and losing a browser loses nothing.

## Why this page still exists

Because the words "recovery" and "encryption" still appear in the codebase and in
older documents, and a reader who finds them deserves a straight answer rather
than a page describing machinery that was deleted.

## What replaced it

Content is stored server-side with the database's encryption at rest, and
**Postgres Row-Level Security is the sole access boundary**. This is explicitly
not zero-knowledge: an operator with database access can read content. The
reasoning, the residual risks, and the self-hosting guidance are in
[`SECURITY.md`](SECURITY.md).

Encryption that is still live is server-side and credential-scoped — Overleaf
tokens, API tokens, and integration credentials are encrypted at rest, and
collaborative documents are encrypted in transit. None of it involves a key the
user holds, so none of it can be lost, and none of it needs recovery.

## Remnants you may still find

- `/recover` is a redirect to the dashboard. It is kept so that recovery links
  from old emails land somewhere sensible instead of a 404.
- Migrations `0037`–`0041` and `0089`–`0095` created the key, device-wrap,
  transfer, and recovery tables. No migration drops them, so they are still in
  the schema of any deployment that ran them. Nothing reads them.
- `useDecryptedObjectUrls` keeps its name for history; storage is plaintext
  through `PassthroughBlobStore` and the browser does not decrypt anything.

## Account passwords

Unaffected, because they were never the encryption story. Email/password
accounts can change their login password from Settings or through the
password-reset email. Accounts without an `email` provider — Google-only, say —
do not show password controls at all, because the identity provider owns that
credential (`account-info-panel.tsx` gates on `user.providers`). The sign-in screen also offers an email magic link
and a numeric email OTP. All three are authentication only — there is no second
step behind them any more.

# WeaveForge MCP implementation

## Status

The WeaveForge MCP is a browser-paired, encrypted relay for the Codex
plugin. It is model-agnostic at the protocol boundary; Codex is the first
supported client. It is not an in-app chat or server-side model proxy.

## Connection model

1. The user enables AI & MCP access, selects sources, and starts a time-limited
   browser session.
2. The app provides a dedicated revocable MCP token and a per-session pairing
   secret; the latter can optionally be remembered in encrypted settings.
3. The local plugin encrypts every tool call with the pairing secret and sends
   an opaque envelope to the relay.
4. Only the unlocked browser claims, decrypts, permission-checks, executes,
   encrypts, and returns the result.

The server sees only encrypted envelopes plus owner/session IDs, expiry, and
status. It never receives research plaintext, encryption keys, pairing secrets,
or third-party credentials.

## Implemented tools

Read-only tools:

- `search_workspace`
- `get_source_excerpt`
- `get_workspace_outline`

They operate only on granted sources: paper metadata and notes, Zotero
annotations/notes, reading lists, vault notes, logbook entries, experiments,
and milestones. PDFs, report content, settings, credentials, and unselected
sources are excluded.

Draft-only proposal tools:

- Append to a paper note (append-only), including review-gated concept hashtag
  suggestions such as `#VAE`; create a vault note or log entry.
- Change paper metadata, reading lists, or graph relations.
- Import a Zotero item.
- Create milestone or experiment follow-ups.

Each tool saves an encrypted pending proposal. The `/ai-review` screen is the
only approval path. A typed browser-local executor performs the normal app
write after approval, and an encrypted audit entry records the outcome.

## Safety and privacy guarantees

- Opt-in, explicit source selection, and permission re-checking per request.
- Requests are owner-scoped, short-lived, size-limited, and atomically claimed
  with a conditional `pending → claimed` update,
  and stop on expiry, revocation, encryption lock, or sign-out.
- MCP tokens are revocable and grant no direct database, storage, account, or
  credential access.
- Third-party credentials remain client-encrypted and are sent directly to
  their provider when an approved operation needs them.
- No direct AI writes, silent autonomous actions, deletes, PDF access, report
  access, or server-side model proxy exist.

## Verification completed

- Unit tests: policy gates, grants, bounded retrieval, proposals, executors,
  and relay lifecycle.
- Supabase RLS integration: owner isolation and atomic relay claims.
- Browser E2E: opt-in, encrypted browser-approved read, revocation, and
  sign-out stopping a live relay.
- Core/web tests, typechecks, production build, SOLID/DRY checks, and plugin
  tool-list validation have been run during implementation.

## Remaining work

Run GitHub CI and open the pull request. Annotation provenance in an answer UI
is deferred product work; there is no in-app answer UI in this release.

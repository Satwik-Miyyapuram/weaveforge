# Privacy test matrix

This matrix maps privacy guarantees to executable tests. A privacy-sensitive
change must extend the relevant row or add a new one before it ships.

| Guarantee | Test layer | Existing coverage |
| --- | --- | --- |
| Encrypted entities store empty/sentinel plaintext fields and decrypt only with a keyring | Core unit | `entity-encryptor.test.ts`, `field-map.test.ts`, cipher/blob tests |
| Wrong keys and altered encrypted data fail closed | Core unit | cipher suite and envelope tests |
| Encryption keys are wrapped, rotated, and revoked with access | Core unit | resource/blanket/share-link/project-key tests |
| A share recipient only receives an authorised resource key | Core unit + Playwright | resource-key tests, `sharing.spec.ts` |
| Privacy disclaimer must be accepted before encryption unlock, without attempting to persist credentials | Core unit + browser | `privacy-disclaimer.test.ts`, login/browser flow, metadata-only disclaimer repository path |
| Integration credentials are encrypted and user-bound | Web unit | encrypted user-settings and integration-credential tests |
| Provider credentials are encrypted at rest; non-CORS providers use direct browser transport and Zotero collection listing uses a non-persistent authenticated relay | Web unit + Playwright | integration credential transport, direct Zotero exporter tests, and the Zotero collection relay route |
| Storage paths cannot escape the owner prefix | Web unit | blob path ownership and signed URL tests |
| SDK/API tokens are hashed, scoped, and expirable | Web unit | API token crypto tests |
| MCP access is default-off and source-scoped | Core + Playwright | AI access policy/grant tests, `ai-mcp-access.spec.ts` |
| MCP request data remains encrypted between plugin and browser | Core + Playwright | MCP manifest/gateway tests and encrypted relay E2E |
| Pairing secrets are masked in the UI | Playwright | `ai-mcp-access.spec.ts` |
| MCP relay records cannot cross user boundaries | Supabase integration | `mcp-relay.rls.integration.ts` |
| Another user cannot attach an audit record to a foreign proposal | Supabase integration | `mcp-relay.rls.integration.ts` after migration `0074` |
| Revocation, sign-out, and encryption/session cleanup stop a live relay | Playwright + unit | relay manager unit test and `ai-mcp-access.spec.ts` |
| MCP writes are proposals, never direct mutations | Core + web unit | proposal draft, executor, and review facade tests |
| Paper-note AI changes—including suggested concept hashtags such as `#VAE`—are append-only, review-gated, and conflict-aware | Core unit + Playwright | `ai-write-proposal.test.ts`, proposal executor tests, and the MCP review flow; tag suggestions must reuse the `append_paper_note` capability rather than a direct tag write |
| Overleaf-linked report credentials are encrypted at rest, metadata-only in browser responses, and owner/project scoped | Web unit + Supabase RLS + Playwright | `overleaf-token-crypto.test.ts`, `overleaf-error.test.ts`, `overleaf-isolation.spec.ts`, migrations `0075` and `0076` |
| Overleaf source reads are explicit, read-only, bounded, and disclose server fetch (content stays in Overleaf) | Web unit + Playwright | `overleaf-git-reader.ts`, `overleaf-isolation.spec.ts`, linked-report UI disclosure |
| Overleaf export is explicit, browser-local, and never sends report plaintext or credentials to Supabase | Browser + unit + Playwright | Shipped: browser-local plaintext export ZIP (Overleaf Phases 0–4) |

## Required test levels for new privacy work

1. **Core unit test:** policy, cryptographic, or ownership rule.
2. **Repository/RLS integration test:** whenever a new table, policy, RPC, or
   authenticated route is introduced.
3. **Playwright interaction test:** whenever a user can enable, reveal, copy,
   revoke, share, delete, or otherwise change privacy-sensitive state.
4. **Regression test:** for every privacy defect found in review or production.

### Paper-note concept suggestions

An AI may suggest concept hashtags only after the user has granted access to the
paper note. A suggestion such as `#VAE` or `#variational-inference` is an
append-only `append_paper_note` proposal, not a direct paper-tag mutation. The
review surface must show the exact hashtags to be appended, and acceptance must
preserve the current revision/conflict check. Hashtags are indexed only after
the user accepts the proposal and the normal paper-note write succeeds.

## Current operational requirement

Apply migration `0074_ai_audit_proposal_ownership.sql` before running the
Supabase integration suite. It is the database enforcement behind the audit
ownership regression test.

For linked Overleaf reports, also apply migrations `0075` through `0077`. For
database hardening, apply migrations `0078` through `0088`. The server requires the
server-only `OVERLEAF_CREDENTIAL_KEY`; never prefix it with `NEXT_PUBLIC_`.

Hosted Supabase leaked-password protection is a project-plan setting, not a
database migration. The linked project rejected the enable request because it
is below Pro; enable it after upgrading the hosted project, or configure the
equivalent self-hosted Auth setting.

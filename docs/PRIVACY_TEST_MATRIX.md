# Privacy test matrix

This matrix maps privacy guarantees to executable tests. A privacy-sensitive
change must extend the relevant row or add a new one before it ships.

| Guarantee | Test layer | Existing coverage |
| --- | --- | --- |
| Stored objects are owner-scoped and a path cannot escape its owner prefix | Web unit | `blob-access.test.ts`, `blob-view-token.test.ts`, the four `api/blobs/*` route tests |
| A stored object is never forgotten while it is still in the bucket | Web unit | `tiered-blob-store.test.ts`, `purge-user-blobs.test.ts` |
| Reads of a stored object require a signed, expiring view token | Web unit | `blob-view-token.test.ts`, `api/blobs/content` route test |
| The privacy disclaimer must be accepted before use, and accepting it persists no credentials | Core unit | `privacy-disclaimer.test.ts` |
| Integration credentials are encrypted at rest and user-bound | Core + web unit | `user-integration-credentials.test.ts`, `api/settings/credentials` route test |
| Provider credentials are encrypted at rest; non-CORS providers use direct browser transport and Zotero collection listing uses a non-persistent authenticated relay | Web unit | `zotero-list-collections.test.ts`, `api/integrations/zotero/collections` route test |
| SDK/API tokens are hashed, scoped, and expirable | Web unit | `api-token-crypto.test.ts` |
| Share links are single-purpose, revocable, and expire | Core unit | `share-link.test.ts` |
| MCP access is default-off and source-scoped | Core + Playwright | AI access policy/grant tests, `ai-mcp-access.spec.ts` |
| Pairing secrets are masked in the UI | Playwright | `ai-mcp-access.spec.ts` |
| MCP relay records cannot cross user boundaries | Schema + RLS | `mcp-relay.rls.integration.ts` |
| Another user cannot attach an audit record to a foreign proposal | Schema + RLS | `mcp-relay.rls.integration.ts` |
| Revocation, sign-out, and session cleanup stop a live relay | Playwright + unit | relay manager unit test and `ai-mcp-access.spec.ts` |
| MCP writes are proposals, never direct mutations | Core + web unit | proposal draft, executor, and review facade tests |
| A share recipient only reaches resources the share actually covers | Core unit + Playwright | sharing use-case tests, `sharing.spec.ts` |
| Reader annotations cannot cross user boundaries | Schema + RLS | `reader-annotations.rls.integration.ts` |
| Paper-note AI changes—including suggested concept hashtags such as `#VAE`—are append-only, review-gated, and conflict-aware | Core unit + Playwright | `ai-write-proposal.test.ts`, proposal executor tests, and the MCP review flow; tag suggestions must reuse the `append_paper_note` capability rather than a direct tag write |
| Overleaf-linked report credentials are encrypted at rest, metadata-only in browser responses, and owner/project scoped | Web unit + Supabase RLS + Playwright | `overleaf-token-crypto.test.ts`, `overleaf-error.test.ts`, `overleaf-isolation.spec.ts` |
| Overleaf source reads are explicit, read-only, bounded, and disclose server fetch (content stays in Overleaf) | Web unit + Playwright | `overleaf-git-reader.ts`, `overleaf-isolation.spec.ts`, linked-report UI disclosure |
| Overleaf export is explicit, browser-local, and never sends report plaintext or credentials to Supabase | Browser + unit + Playwright | browser-local plaintext export ZIP |

### What this matrix no longer claims

End-to-end encryption of entities and blobs was removed. There is no keyring,
no per-resource or per-project key wrapping, and no client-side decrypt:
`FetchingBlobStore` stores plaintext, and the blob layer's names say so.
Earlier revisions of this table cited
`entity-encryptor.test.ts` and `field-map.test.ts`, which no longer exist —
a privacy document naming tests that were deleted is worse than one that says
less, so the rows went with the tests.

Encryption that *is* live is server-side and credential-scoped: Overleaf tokens,
API tokens, and integration credentials are encrypted at rest, share-link and
SDK tokens are hashed, and collaborative documents are encrypted in transit by
`encrypted-yjs-provider.ts`. Confidentiality of stored user content rests on
owner-scoped paths, signed expiring view tokens, and Postgres RLS — not on
client-held keys.

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

The schema and RLS suite (`npm run test:integration:web`) applies every
migration in `supabase/migrations/` to an in-process Postgres before it runs, so
it needs no project and no credentials, and a migration that cannot apply to a
clean database fails a test rather than a deploy. The RLS policies there are the
database enforcement behind the "Schema + RLS" rows above. What it does not
cover is Supabase's own auth service — JWT issuance and validation are GoTrue's
job, not this schema's.

The server requires the server-only `OVERLEAF_CREDENTIAL_KEY`; never prefix it
with `NEXT_PUBLIC_`.

Hosted Supabase leaked-password protection is a project-plan setting, not a
database migration. The linked project rejected the enable request because it
is below Pro; enable it after upgrading the hosted project, or configure the
equivalent self-hosted Auth setting.

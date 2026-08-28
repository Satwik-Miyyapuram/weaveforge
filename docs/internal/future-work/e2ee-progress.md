# E2EE implementation progress

> **Historical — completed and superseded.** Client-side E2EE was removed from
> WeaveForge; this file records how that went, not work that is pending. The
> source files and tests it names were deleted with the feature, so its paths
> will not resolve. Current state: [`../SECURITY.md`](../../SECURITY.md) and
> [`../CRYPTO_RECOVERY.md`](../reports/crypto-recovery.md).

Branch: `main` (E2EE merged via PR #15)  
Plan reference: the original E2EE plan document, which is no longer in the repository.

## Status summary

| Phase | Status | Notes |
|-------|--------|-------|
| 1 — Crypto foundation | **Done** | Envelope codec, libsodium adapter, core tests |
| 2 — Key mgmt + unlock UX | **Done** | Login-based unlock (password / Google / magic link) |
| 3 — Vault E2EE pilot | **Done** | encryptRepo, migrate-on-unlock |
| 4 — Encrypted blobs | **Done** | EncryptedBlobStore, decrypted asset URLs |
| 5 — Sharing + revocation | **Done** | Member + blanket + **external view links** |
| 6 — Collab CRDT | **Done** | Vault + report + logbook; awareness; compaction; LWW invalidation |
| 7 — Remaining entities | **Done** | All entities encrypted incl. **reading lists**; migration on unlock |
| 8 — Hardening | **Done** | CSP, batch rekey, unit + Playwright E2E (share links green) |

**Share links:** the external link-sharing plan (no longer in the repository) — view-only external links  
**Future (not priority):** [`data-export-plan.md`](data-export-plan.md) — full decrypted ZIP export

## Migrations to apply locally

```bash
supabase db push
node scripts/seed-test-users.mjs
```

| Migration | Purpose |
|-----------|---------|
| `0042_crdt_updates.sql` | CRDT update log + `snapshot_upto` columns |
| `0043_shares_edit_access.sql` | `edit` share access + CRDT insert policy |
| `0044_realtime_authorization.sql` | RLS on `realtime.messages` |
| `0045_post_migration_cleanup.sql` | Placeholder (run after all users migrated) |
| `0046_entities_content_enc.sql` | `content_enc` on all entity tables + paper bidx |
| `0047_share_links.sql` | External link token table |
| `0048_share_link_dek_and_rpcs.sql` | DEK wrap columns + resolve/redeem RPCs |
| `0049_share_link_rate_limit.sql` | Rate limits on resolve/redeem RPCs |
| `0050`–`0055` | Org leave, vault owner keys, graph settings, disclaimer version |
| `0056_share_link_rate_limit_hardening.sql` | Rate-limit index + function grants |
| `0057_reading_lists_e2ee.sql` | `content_enc` on reading lists + items; scrubs legacy titles |
| `0058_share_link_rate_limits_rls_fix.sql` | Fix rate-limit table RLS blocking redeem |
| `0059_scrub_reading_list_plaintext.sql` | Scrub legacy list name/description/note plaintext |

## Phase 5 — sharing

### Done

- Signed DEK wraps on grant / reconcile on unlock / revoke rotates DEK
- ShareDialog: key-wrap for **vault, paper, report_section, experiment, reading_list**
- **Blanket shares** — `GrantBlanketKeyAccessUseCase` (SK_p + batch DEK wraps)
- `ReconcileProjectMemberWrapsUseCase` on unlock
- Fingerprint TOFU on grant **and existing share rows**
- Project space keys + supervision wrap reconcile (`SUP_p`)
- Resumable **batch rekey** (`BatchRekeyResourcesUseCase` + idle scheduler)
- **External view links** — `/link?t=…` with link-wrapped DEK (`CreateShareLinkUseCase` / `RedeemShareLinkUseCase`)
- **7-day default link expiry** + rate limits on resolve/redeem RPCs (`0049`)
- Revoke link → optional DEK rotation (`RevokeShareLinkUseCase`, checkbox in ShareDialog)

## Phase 6 — collaborative editing

### Done

- Generic `CollabBodyHost` + `CollaborativeMarkdownEditor` (vault, report, logbook)
- `EncryptedYjsProvider` + Realtime + `crdt_updates` persistence
- **Yjs awareness** / presence strip in editor
- **Snapshot compaction** via `snapshot_upto` + `CompactCrdtLogUseCase` (on editor close)
- **Revoke → clear CRDT log** under new DEK epoch
- **LWW invalidation** — `proj:{projectId}` Realtime broadcast clears repo cache

## Phase 7 — entity encryption

### Done

- `encryptRepo` wired: papers, log, report, experiments, milestones, comments, **reading lists**
- **Reading list items** — notes encrypted under parent list DEK (`wireEncryptedReadingListItems`)
- `MigrateProjectEntitiesToE2eeUseCase` on unlock (raw list + encrypted save)
- Paper blind-index (`doi_bidx` / `arxiv_bidx`) write + dedupe queries
- Milestone encryption under **SUP_p** (`dekBinding: supervision`)
- Comments under **parent resource DEK** (`dekBinding: parent`)

## Phase 8 — hardening

### Done

- CSP + security headers in `next.config.mjs`
- Core unit tests: blanket share, e2ee-share helpers
- Playwright two-browser E2E (`apps/web/e2e/sharing.spec.ts`)

### Deferred

- `0045` post-migration cleanup (after all users on E2EE)
- Custom link TTL picker (default 7-day expiry is implemented)

## Unlock UX

| Sign-in method | Unlock |
|----------------|--------|
| Email + password | Login password |
| Google OAuth | Sign in with Google again |
| Magic link | Click the link in your email again |

Test accounts: `a@example.com` … `g@example.com` / `testing@123`

| Account | Lab | Role |
|---------|-----|------|
| a@example.com | Lab Alpha (owner) | Professor |
| b@example.com | Lab Beta (owner) | Professor |
| c@example.com | Lab Beta | PhD (supervisor: B) |
| d@example.com | Lab Beta | PhD (supervisor: B) |
| e@example.com | Lab Beta | Masters (supervisor: C) |
| f@example.com | Lab Beta | Masters (supervisor: C) |
| g@example.com | *(none — standalone)* | Standalone |

Reset: `node scripts/delete-test-users.mjs && node scripts/seed-test-users.mjs`

## Manual test checklist

1. `supabase db push` (through 0059)
2. `node scripts/seed-test-users.mjs`
3. Sign in as `a@example.com` / `b@example.com` (two browsers)

### Entity E2EE

- [ ] Create paper → SQL shows `content_enc` + `doi_bidx` when DOI set
- [ ] Legacy rows migrate on unlock (progress pill shows pages + entities)
- [ ] Milestone title encrypted; supervisor with SUP_p can read
- [ ] Comment on shared paper decrypts for recipient with DEK wrap

### Sharing

- [ ] Share report section to B with `edit` + fingerprint → co-edit works
- [ ] Share paper to B → B decrypts encrypted fields
- [ ] Blanket-share all papers in project → B decrypts existing + new papers
- [ ] Trust fingerprint on existing share row
- [ ] Revoke → B loses decrypt access
- [ ] Create view link → 7-day expiry hint; redeem at `/link?t=…` after unlock

### Vault + CRDT

- [ ] Co-type vault/report body → changes converge; presence shows co-editors
- [ ] Revoked B cannot insert CRDT updates
- [ ] Tab switch on A reflects B's write within ~1s (LWW cache invalidation)

## Key files

| Area | Path |
|------|------|
| Bootstrap | `apps/web/src/bootstrap.ts` |
| Entity encryptor | `packages/core/src/features/crypto/application/entity-encryptor.ts` |
| Blanket share | `packages/core/src/features/crypto/application/grant-blanket-key-access.use-case.ts` |
| CRDT provider | `apps/web/src/features/collab/infrastructure/encrypted-yjs-provider.ts` |
| LWW invalidation | `apps/web/src/lib/cache/project-lww-invalidator.ts` |
| Share dialog | `apps/web/src/features/sharing/ui/share-dialog.tsx` |
| Link share plan | removed from the repository |

## Not committed (intentionally)

- `apps/web/src/app/dev-graph/` — temporary dev tooling
- `.claude/launch.json` — local IDE config

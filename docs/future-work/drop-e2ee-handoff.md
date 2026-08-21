# Drop-E2EE — handoff / blocked items

> **Historical — completed and superseded.** Client-side E2EE was removed from
> WeaveForge; this file records how that went, not work that is pending. The
> source files and tests it names were deleted with the feature, so its paths
> will not resolve. Current state: [`../SECURITY.md`](../SECURITY.md) and
> [`../CRYPTO_RECOVERY.md`](../CRYPTO_RECOVERY.md).

Branch: `drop-e2ee`. Phase B (server-side at-rest + RLS, `CRYPTO_ENABLED=false`) is live on the
dummy DB. This file = the items that **need you** (Satwik). Everything else is being worked
autonomously overnight; see "Autonomous scope" at the bottom.

## Needs you — do NOT let the loop touch these

Ordered so prod / other users stay safe. Do them in this order:

1. **Prod plaintext backfill** (if real users exist on a non-dummy Supabase project)
   - Run `apps/web/scripts/hybrid-backfill.ts` then `blob-backfill.ts` against prod, `--write`.
   - Point `SUPABASE_*` env at prod first. Verify every encrypted field has a plaintext value.
   - Already done on the dummy DB (project ref `htrwmhtcvatvmijhjdid`).

2. **Deploy the code cleanup** that stops reading `content_enc`
   - Must ship BEFORE step 4. Repos still reference `content_enc`/`enc_epoch` today.

3. **`/security-review`** — triage + fix needs you
   - RLS (`shared_to_me`) is now the *sole* access boundary — no crypto fallback.
   - The loop is allowed to RUN it read-only and dump findings to
     `docs/future-work/security-review-findings.md`. It will NOT fix anything.
   - You triage severity and apply fixes before merge to `main`.

4. **Apply the irreversible DROP** — `docs/future-work/phase5-drop-e2ee.sql`
   - Preconditions (all must be true): full DB backup exists; steps 1–3 done and verified.
   - Applying before step 2 is deployed **breaks writes for everyone**. Move it into
     `supabase/migrations/` as the next `NNNN_*.sql` and apply deliberately. Not a `db push`.

5. **Bug 1 — Python SDK "no Supabase config, cannot create tokens"** — needs your diagnosis
   - Error hint in `apps/web/src/lib/format-error.ts:38`: *"Run supabase db push (migration 0061)
     if API tokens are not set up yet."*
   - Likely one of: migration `0061` (api_tokens table) not applied to the SDK's target project,
     OR the SDK's local env is missing Supabase creds. Needs you to confirm which project the SDK
     points at + whether `api_tokens` exists there. Only then is it clear if any code change is needed.

## Autonomous scope (what the loop is allowed to do — no user needed)

Branch-local code/docs only. Nothing that hits prod DB or needs a decision:

- Rewrite stale E2EE copy → at-rest+RLS wording (privacy-disclaimer, SECURITY.md, docs). *(done)*
- **Bug 2** — projects-screen top bar right-align regression. *(done, verified in preview)*
- **Bug 3** — `/recover` route now redirects to `/dashboard` when crypto off; stale login copy
  removed. *(done, verified in preview)*
- Settings E2EE panel + Account "Encryption: Unlocked" row hidden when crypto off. *(done, verified)*
- README / docs/SECURITY.md / commercialization plan present-tense E2EE claims corrected. *(done)*
- `/security-review` read-only → `docs/future-work/security-review-findings.md`. *(done)*

### Autonomous work — done. Commits on `drop-e2ee`:
`a1ae9eb` layout · `4e1278d` privacy copy · `9c13d31` recovery UI · `16fa977` security findings ·
`f13a326` doc E2EE cleanup · `f9b1ccd` settings E2EE UI.

### Left for you (not auto-done — needs judgement, NOT bugs to fix blind):
- **e2e test debt:** `apps/web/e2e/email-recovery.spec.ts` and the crypto specs exercise the
  now-disabled E2EE flow — they will fail CI. Skip/remove them (or gate on `CRYPTO_ENABLED`) when
  you next touch tests. Left alone by the loop to avoid deleting tests unattended.
- **Historical docs** left intentionally: `CHANGELOG.md`, `docs/UI-SPEC.md`,
  `docs/backend/postgres-provider.md`, `docs/CRYPTO_RECOVERY.md`, `docs/PRIVACY_TEST_MATRIX.md`,
  `docs/future-work/hybrid-encryption-plan.md` — these describe E2EE as history or dev-spec;
  rewrite only if you want them current.

Hard stops for the loop: no prod DB writes, no `phase5-drop-e2ee.sql`, no deleting `features/crypto`
(breaks `CRYPTO_ENABLED` reversibility), no merge to `main`, no `--write` scripts, nothing in the
"Needs you" list above.

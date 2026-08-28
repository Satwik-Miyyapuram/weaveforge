# WeaveForge — consolidated backlog

Single hand-off list for delegating work. Items marked **[decide]** need a call from
the maintainer before/while doing; **[review]** should come back for review before merge.
Detailed specs live in the linked docs.

Branch state: `drop-e2ee` merged to `main` and pushed. Follow-up work continues on `main`.

---

## 0. Finish the crypto deletion  ✅ done

Crypto deletion is complete (handoff doc removed). Decisions already
made: entity content + AI proposals + collab CRDT all **plaintext**; settings credentials
already reworked to **server-key** (done). Affected tables (`ai_proposals`, `ai_audit_records`,
`crdt`) are **empty → no backfill**.

1. ~~Collab CRDT → plaintext~~ ✅
2. ~~AI proposals/audit → plaintext (migration `0100`)~~ ✅
3. ~~`crypto.isUnlocked()` gates → `true`~~ ✅
4. ~~Bootstrap/facades: collapse CRYPTO_ENABLED, remove facade/keystores/encryptor/keyring~~ ✅ **[review]**
5. ~~`rm -rf features/crypto` + core export + `crypto-flag`~~ ✅
6. ~~Verify: tsc + tests; update `SECURITY.md`~~ ✅ (SECURITY.md already accurate)

---

## 1. Features / nice-to-haves

| # | Item | Spec | Notes |
|---|------|------|-------|
| 1 | **Obsidian parity** | plan doc removed | ✅ Tier 1–3+6 done earlier; block refs + zip/folder import shipped |
| 2 | **Data export = ZIP** | plan doc removed | ✅ ZIP with domain JSON + vault/paper blobs (v1 layout) |
| 3 | **Equation support** | plan doc removed | ✅ Phases 1–2 complete; e2e `equations.spec.ts` present |
| 4 | **Overleaf** | plan doc removed | ✅ linked read-only + local plaintext export ZIP (Phases 0–4); Git bridge / import / MCP later |
| 5 | **Plugin / MCP** | [`AI_MCP_PLAN.md`](../plans/completed/AI_MCP_PLAN.md) | ✅ auth decided: `aiAccess` ruleset + MCP relay token + browser session grant (OAuth not needed; direct `/api/mcp` stays 503 by design) |
| 6 | **Cite / excerpts / discovery** | [`competitive-scan-implementation-plan.md`](../plans/completed/competitive-scan-implementation-plan.md) · [`../competitive-scan.md`](../strategy/competitive-scan.md) · [`../usage-cite-and-excerpts.md`](../../using/citations-and-overleaf.md) | ✅ merged (PR #29): excerpts, cite AC, LaTeX `\cite`, pin-to-section, related papers, board, jump-to, docs |
| 7 | **Citation alerts** | [`../competitive-scan.md`](../strategy/competitive-scan.md) (steal #9) | ✅ merged (PR #33): `citation_alert_tracks` + Semantic Scholar polling → Log + Mattermost |
| 8 | **Library knowledge loop** | [`library-knowledge-loop-plan.md`](../plans/completed/library-knowledge-loop-plan.md) · [`../usage-cite-and-excerpts.md`](../../using/citations-and-overleaf.md) | ✅ on `feat/library-knowledge-loop`: annotation cards + `annotation_pins`, jump recents, custom fields, extraction table, relations/rollups, source-note layout. AI column fill still deferred. Apply migrations `0103`–`0105` |

---

## 2. Cleanup / debt

| # | Item | Where | Notes |
|---|------|-------|-------|
| 0 | **`experiment_metrics` storage — fixes A + B + C** | [`metrics-storage-plan.md`](metrics-storage-plan.md) | ✅ all three shipped. A: `0114` narrow rows + `metric_id` lookup. C: downsampling at the ingest route, which caps a series at ~40k points however long the run is. B: `0115` chunked arrays. Measured 448.7 B/point before, 130.9 after A, 22.5 after B — 9.7× on a 200k-point workload against the live server |
| 6 | **Merge `drop-e2ee` → `main`** | — | ✅ merged (ff) + pushed |
| 7 | **Perf roadmap** | plan doc removed | ✅ rewritten for post-E2EE (plaintext + RLS; no decrypt workers) |
| 8 | **Restore server-side title search** | paper repos | ✅ `ilike` re-enabled (postgres + supabase) |
| 9 | **Stale E2EE docs** | `docs/building/ui-spec.md`, delete `hybrid-encryption-plan.md` | ✅ done (CHANGELOG kept as history) |
| 10 | **Tests** | API + e2e | ✅ every Next `/api/*/route.ts` has colocated `test/route.test.ts` (`check:api-route-tests`); e2e covers papers/vault/logbook CRUD + sharing + equations + MCP + Overleaf + settings credential/MCP APIs. Domain CRUD is covered by core use-case tests + e2e PostgREST assertions (see API surfaces below). |
| 11 | **Ops — Bug 1** | env | ✅ GH Actions secrets synced; Supabase smoke 200. CI `startup_failure` was **account billing lock** (not minutes — 668/3000 left); unlocked and CI green on [PR #23](https://github.com/Satwik-Miyyapuram/weaveforge/pull/23). Vercel linked: `satwik-miyyapurams-projects/weaveforge-web` — confirm host env vars (`SUPABASE_*`, service role, JWT, Overleaf key) in the Vercel dashboard. |

### API surfaces (intentional — not a bug)

| Surface | Used for |
|---------|----------|
| **Next `/api/*`** | Server-key credentials, MCP/API tokens, blobs, org admin ops, Overleaf, MCP relay, SDK |
| **Supabase PostgREST + RLS** | Papers, vault, logbook, projects, sharing, comments, non-secret settings |

UI does **not** call `supabase.from()` directly — only via repositories through `getContainer()`. Do not force all domain CRUD through Next routes unless we deliberately redesign.

---

## 3. Security-adjacent / needs the maintainer

| Item | Status |
|------|--------|
| Integration-credential encryption → **server-key** | ✅ done (`settings-credential-crypto.ts` + `/api/settings/credentials`) |
| RLS is the sole access boundary | ✅ reviewed, no gap (findings doc removed) |
| Phase-5 DROP applied (migration `0099`) | ✅ done; backup at `backups/phase5-e2ee-backup-*.json` (gitignored) |
| `SECURITY.md` accuracy | ✅ accurate (creds server-key; all else plaintext) — confirmed by drop-e2ee security review (no HIGH/MEDIUM) |

---

## Come to me (Claude) for
- Anything an agent flags as ambiguous or feature-affecting — those are the ones
  worth a decision before they guess.

**Decided:** MCP auth = existing AI access policy + Settings MCP token + browser
relay (not OAuth). Direct `/api/mcp` remains fail-closed; clients use the relay.

**Reviewed:** drop-e2ee attack surface (credentials route, server-key cipher,
migrations 0099/0100, RLS on plaintext AI/CRDT, markdown XSS) — no HIGH/MEDIUM.

# audit_2.md — verification ledger

`audit_2.md` is a dump of **two different models' output concatenated into one file**, so it
contains duplicate findings and an internal contradiction. This ledger is an independent
re-check of every finding against the tree at `cb7624a`, done by reading the real files rather
than the audit's own assertions.

## Method

Every finding was re-read from `audit_2.md` and then checked against the source it names. The
audit's file paths are frequently abbreviated or simply wrong, so the real file was located
first and quoted. Verdict vocabulary:

| Verdict | Meaning |
| --- | --- |
| **real** | The claim matches the current source as stated. |
| **partial** | The code is as described, but a stated consequence, magnitude, location or severity is wrong. |
| **refuted** | The code does not say what the audit claims. |
| **stale** | Already fixed / no longer present in the tree. |
| **unverifiable** | Needs a device, a live database or a benchmark to settle. |

### Deployment context (checked first, because it changes two verdicts)

This repository is **hosted on OCI**: PostgreSQL 16 + PostgREST + Caddy, with Supabase used
**only for Auth**. There is no Supabase-hosted database. `apps/web/src/backend/config.ts:2`
records the two data providers (`"supabase" | "postgres"`), `:22` says `dataUrl` is "Where the
data API lives, when it is not Supabase's", and `:14-18` says the self-hosted PostgREST speaks
the same protocol as Supabase's REST endpoint and validates the same JWT secret.

Two consequences:

* Everything in `supabase/migrations/*.sql` runs against the OCI Postgres. The
  `compact_crdt_log`, `metric_history` and `latest_metric_activity` functions the audit
  discusses are all live on the OCI box, not on a Supabase database.
* The file *names* say `supabase-*`. That is the historical provider id, not the host. The
  adapter module is named after the protocol it speaks (PostgREST), not the vendor.

## Two findings that are already implemented as the audit prescribes

These two are the top of the audit by score, and both are wrong in the same direction: the
audit describes a fix that is already in the tree and reports it as missing.

### WF-N01 — refuted (was scored 8.6, "Critical")

Migration `supabase/migrations/0132_compact_crdt_log_rpc.sql` already does exactly what the
finding's fix block asks for, in one function body:

```sql
update %I set snapshot_upto = greatest(coalesce(snapshot_upto, 0), $1)
 where id = $2 returning snapshot_upto     -- :96-97  forwards-only, in-statement
...
delete from public.crdt_updates
 where resource_type = p_resource_type
   and resource_id = p_resource_id
   and id <= v_upto                        -- :112  the watermark just written
```

* The forwards-only guard is **inside** the statement (`greatest`), so a stale caller cannot
  rewind the watermark.
* The sweep is bounded by `v_upto` — the watermark the function just read back — **not** by
  `p_upto_id`, which is precisely the "never by the client's `uptoId`" requirement.
* The caller-side comparison at `compact-crdt-log.use-case.ts:43` is documented as a courtesy
  early-out, not the guard: `crdt-update-store.ts:66-69` says "Lets a stale caller be a local
  no-op rather than a round trip; the database decides anyway."

The finding's own SQL block is structurally the same as the migration. There is no
delete-before-watermark race and no data loss. **Nothing to change.**

### WF-N04 — partial (was scored 7.0, "High")

`supabase-metric-repository.ts:9` does use one constant `TABLE = "experiment_metrics"` for both
the read and the `append` insert, and `:48` does `this.db.from(TABLE).insert(payload)`. The
description of the code is accurate. The stated consequence is not:

Migrations `0114:321-322` and `0115:136-139` install **INSTEAD OF INSERT/UPDATE/DELETE
triggers** on the view:

```sql
create trigger experiment_metrics_insert_trg
instead of insert on experiment_metrics
```

`0114:305-307` shows the trigger routing into `experiment_metric_points` and coalescing the
owner — `coalesce(new.user_id, auth.uid())`, commented as "the table default the view cannot
carry". So `append` cannot fail with "cannot insert into a view": it has a working, documented
write path.

The finding's prescribed fix — insert straight into `experiment_metric_points` — would
**fail**, because the payload the port takes carries the `metric` *text*, while the row table
requires `metric_id`, and `user_id` has no column default (`0114:161`). The view exists to do
that name lookup.

The residual true half: `append` has no production caller (the Python SDK is the writer over
the ingest API), so it is unexercised against the real database. That is a test gap, not a
broken write path — and it is the same code state that `MEM-04` describes from the other side.

## The real, actionable findings

Grouped by area; each keeps the audit's id so the two documents cross-reference. "Effort" is a
re-estimate after reading the code, not the audit's.

### Data layer

| id | verdict | What was wrong with the audit's version | Effort |
| --- | --- | --- | --- |
| **WF-N11 / WF-N16** (dup) | real | None. Two findings, one root cause: the budget is optional in the port signature. Fixes are identical, so they land as one change. | S |
| **WF-N12** | real | None, except that the recorded `malformed array literal` was the local PGlite client (`pglite-client.ts:135`) and that defect is already fixed. Root cause is distinct from N11/N16: unbounded *writes*, not unbounded reads. | XS |
| **WF-N04 / MEM-04** (dup) | partial | See above. The real work is a round-trip integration test, not a repoint. | S |
| **MEM-04** | partial | "nothing implements or calls it" is false: two adapters implement `append` and the shared contract suite exercises it. Also `append` sits on a separate `IMetricWriter` port (`metric-point.ts:27-29`), so deleting it from `IMetricRepository` would delete nothing — it is already segregated. | — |

### Lexical extractor (`packages/core`)

| id | verdict | Correction | Effort |
| --- | --- | --- | --- |
| **WF-N06** | real | The worked example is off: in `"MAGAN GAN Models"`, `phrase.indexOf("GAN")` is 2, not 5. Defect and direction unchanged. | XS |
| **WF-N07** | real | None. | XS |
| **WF-N13** | real | None — the shared `CANDIDATE.lastIndex` is a genuine latent hazard, not an active bug (no `await` sits between the reset and the scan today). | XS |
| **WF-N15 / WF-N20** (dup) | real | None; N20 is the residual slice of N15 after N15's lifetime fix. | XS |
| **WF-N17** | partial | The *magnitude* is wrong. `indexOf` returns at the first hit, so a hashtag present in `plain` is not "a full scan of the document"; "80 tags costs 160 document scans" is overstated. Only wikilink targets — blanked out of `plain` by `stripMarkdown` — cost two near-full scans. It is still worth deleting `evidenceFor` by threading the index through. | S |
| **WF-N18** | real | Understated, if anything: `extractWikilinks` → `vault-page.ts:148-152` `maskCode` adds two more full-body replaces. | M |

### Android shell (`apps/android`)

| id | verdict | Correction | Effort |
| --- | --- | --- | --- |
| **WF-N02** | real | None. Highest-value Android fix in the document: left-handed writers put the palm down first nearly every stroke. | M |
| **WF-N03** | real | None. The finding's own analysis is correct, including why option (b) is unavailable while the overlay is a `SurfaceView` sibling. | S |
| **WF-N08 / WF-X08** (overlap) | real / partial | X08's "discovered" claim is refuted by the block it quotes: `javaScriptEnabled` and `domStorageEnabled` *are* about what the WebView may reach. Also `setAllowFileAccessFromFileURLs` is a deprecated no-op at minSdk 29. | S |
| **WF-N09** | real | None. Network security config is strictly less code than the global flag. | S |
| **WF-N10** | real | None. | S |
| **WF-N14** | partial | Two sub-claims are false: the list is `ArrayList<Float>`, not nullable (`:67`), and the buffer *is* cleared per stroke (`:208-209`, `:141`). The real defect is the unbounded per-stroke buffer plus `JSONArray(strokePoints).toString()` on the UI thread at pen lift. | S |
| **WF-N19** | real | The fix says "keep `proguard-rules.pro`" — the file does not exist, so it must be created. | S |

### Permission posture (`WF-X01`…`WF-X08`)

| id | verdict | Note |
| --- | --- | --- |
| **WF-X01** | real | The posture is accurate and the recommendation is the single best-value item in the audit. Two secondary errors: `check-dry.mjs`'s `select("*")` rule is a plain ban with **no** allow-list (the allow-list pattern the fix cites belongs to a different rule, `check-dry.mjs:35-64`), and the code block's `FORBIDDEN_PERMS` omits `MEDIA_PROJECTION` while the prose requires it. |
| **WF-X02** | real | Forward-looking constraint; no overlay exists today. |
| **WF-X03**, **WF-X04**, **WF-X05** | real | All three are contracts for capabilities that do not exist. Their file paths are explicitly marked "(proposed)". |
| **WF-X06** | partial | Presented as "Verified in source" but its second half describes a service that does not exist, and its first premise ("Read the brief's framing") cites a brief that is not in this tree. Should be labelled *proposed*. |
| **WF-X07** | real | The diagnostic screen does not exist and needs no new permission. |
| **WF-X08** | partial | See the Android table. |

## Audit-internal contradictions (the "two models" problem)

These are the places where the file argues with itself. None needs a user decision; they need
the wrong half deleted.

1. **`ACC-01` vs `WF-X01`** — the sharpest one.
   `ACC-01` (`audit_2.md:1536-1547`) claims "When users grant accessibility or device admin
   permissions **to the app**, they cannot use payment apps anymore", marks itself
   `status: "confirmed"`, and prescribes *keeping* the capability and warning the user, plus
   "event filtering to ignore TYPE_WINDOW_STATE_CHANGE for payment apps".
   `WF-X01` (`:504-510`) states the opposite and is right: the repo contains exactly two Kotlin
   classes, neither a `Service`, and "There is no code path in this repository that could
   disable, delay or obstruct a payment app". `WF-X03` further shows that event-type filtering
   does not help and must not be the mechanism.

   Verified against the tree: `AndroidManifest.xml:4` declares `INTERNET` and nothing else,
   there is no `<service>` element at all, and a repo-wide search for accessibility-service
   symbols matches only `audit_2.md`. **`ACC-01` is refuted; `WF-X01`/`WF-X03` stand.**

2. **`ARCH-02` and `ARCH-04` are each stated twice, once as broken and once as fixed**
   (`:1026` vs `:1738`; `:1418` vs `:1765`). The current source agrees with the later entries.
   The earlier ones are pre-fix snapshots left in place.

3. **`MEM-04` contradicts `WF-N04`** on whether `append` exists, and contradicts its own fix
   text. Both are wrong in different ways; see the table above.

4. **`ARCH-08` and `ARCH-09` both claim `proposalApplies` as their fix.** It is
   `ARCH-09`'s — the append-note revision predicate. `ARCH-08`'s actual deliverable is
   `ZoteroPushOutcome`. The file assigns the same symbol to two findings (`:1820` vs `:1833`).

5. **`PERF-03`'s mechanism and location are wrong** even though the fix landed. The old cost was
   a linear `find` per lookup — `O(N×M)` per column, per
   `packages/core/src/features/papers/application/compute-rollup.ts:28-29` — not "every row
   compared against every other row", and the code lives in
   `features/reading-lists/application/extraction-table.ts`, not `features/experiments`.

6. **`PERF-04`'s "27 sites remain as a counted ratchet" is wrong.** `check-dry.mjs:202-208`
   says it found **45** sites, all 45 are now named, and "this is a plain ban with no baseline
   to keep in step". The gate reports 0 today.

7. **`PERF-13`'s counts are wrong** (86/34 files, max 10, vs the file's own 95/40, max 14) and
   0 remain today, not 95.

8. **`ACC-05` overstates the keyboard gap**: modals *do* trap and restore focus correctly
   (`components/modal.tsx:63-92`). The residue is drag-and-drop and arrow-key menus.

9. **`ACC-06`'s consequence is wrong**: no image in the app lacks an `alt` attribute. The
   defect is *non-descriptive* alt text ("Paper figure" for every figure) plus no data-table
   alternative for charts.

## Duplicate clusters (one fix each, not two)

| Cluster | Relates to | Distinct deliverable |
| --- | --- | --- |
| WF-N11 + WF-N16 | the same optional `maxPoints` budget | make the budget required |
| WF-N04 + MEM-04 | the same `append` | one round-trip integration test |
| WF-N15 + WF-N20 | eager strings in `prepare()` | prepare/harvest/drop, then lazy `rawLower` |
| MEM-05 + ARCH-16 | `describeRejection` prose moved out of core | already done — both are stale |
| MEM-06 + ARCH-15 | the two freshness constants | already done — both are stale |
| ARCH-08 + ARCH-09 | both cite `proposalApplies` | ARCH-09 owns it |

## Findings already fixed in the tree (`stale`, delete from any plan)

`WF-N01`, `BUG-02`, `BUG-16`, `PERF-01`, `PERF-02`, `PERF-04` (the gate), `PERF-14`,
`SEC-04`, `MEM-01`, `MEM-02`, `MEM-03`, `MEM-06`, `ARCH-06`, `ARCH-14`, `ARCH-15`, `ARCH-16`.

`BUG-19` is **refuted**: `postgrest-transport.ts:101` persists
`serverVersion: typeof version === 'number' ? version : null`, and `:86-90` says so explicitly
("`serverVersion: null` — not `0` … a fabricated 0 becomes a guard that matches nothing"). The
finding's fix text has both halves backwards.

`ARCH-07` is **refuted**: `this.scoped(...)` exists and is used at eight call sites
(`project-scoped-repository.ts:34`). Only the exact identifier `PAPER_ID_COLUMNS` is absent —
it is spelled `PAPER_IDENTITY_COLUMNS`.

## Unverifiable without a device or a benchmark

* `LEDGER-Phase 3`'s "5624 ms → 5 ms" rollup measurement. The code and the 1500 ms budget
  guard exist; the two numbers are prose. Re-run the extraction-table benchmark at a 400-row /
  20 000-value table to settle it.
* `PERF-05`'s "doubling latency" between the scope read and the token mint. The two RPCs are
  real; the magnitude is not measured anywhere in-tree.
* Every simulator-only Android claim (`WF-N02`, `WF-N03`, `WF-N14`): the code reading is
  conclusive, but the user-visible behaviour needs a stylus and a palm.

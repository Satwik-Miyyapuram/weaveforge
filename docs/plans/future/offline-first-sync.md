# Offline-first and sync

**Status:** proposal, nothing built.
**Question it answers:** can WeaveForge keep working with no network — on the
desktop app especially — and reconcile cleanly when the network comes back,
including when the same thing was edited in two places at once?

**Answer:** yes, but not by one mechanism. The data splits into four kinds and
each needs a different merge rule. The dangerous version of this feature is the
one that picks a single rule (usually "last write wins on the whole row") and
applies it everywhere; that silently eats edits, and it eats them at exactly
the moment the user trusted the app most — after a flight, after a conference,
after a week on a bad connection.

---

## 1. Where we actually stand

Facts, not plans. Each is load-bearing for what follows.

| Fact | Where | Consequence |
|------|-------|-------------|
| The desktop app is a shell that loads a remote URL | [`apps/desktop/src/main.ts:84`](../../../apps/desktop/src/main.ts) — `window.loadURL(APP_URL)` | **There is no offline desktop app today, at any level.** No network, no window contents. Data sync is moot until this is fixed. |
| The service worker deliberately never caches HTML or navigations | [`apps/web/src/sw.ts:7`](../../../apps/web/src/sw.ts) | The PWA does not boot offline either. The reason is sound (Next embeds build-id-specific chunk and RSC URLs, so a cached shell breaks after a deploy), so the fix is not "cache the HTML too". |
| Repositories are ports in `@weaveforge/core`, wired per provider | `apps/web/src/backend/providers/{supabase,postgres}` | A third provider can be added without touching a single feature. This is the main reason the work is tractable. |
| `@electric-sql/pglite` is already a dependency | `apps/web/package.json`, used by `apps/web/src/backend/test/pg-test-db.ts` | Real Postgres in-process, running **the shipped migrations**. One schema, one set of RLS policies, local and remote. |
| The postgres provider already switches role for RLS | [`apps/web/src/backend/providers/postgres/pg-runner.ts`](../../../apps/web/src/backend/providers/postgres/pg-runner.ts) | Local reads enforce the same policies as the server. Without this a local mirror of a shared project would leak other members' rows. |
| Document bodies are already CRDTs | `crdt_updates` table (migration `0042`), `features/collab/infrastructure/encrypted-yjs-provider.ts` | The hardest merge problem — concurrent prose editing — is already solved for vault pages and log entries. Sync must extend it offline, not replace it. |
| Row content is plaintext at rest; only credentials are encrypted | `encrypted-yjs-provider.ts` header comment; `settings-credential-crypto.ts`, `overleaf-token-crypto.ts` | The server can compute a change feed over rows. If bodies were end-to-end encrypted this whole design would need a different server contract. |
| Caching is in-memory and LWW-flavoured already | `lib/cache/cache-repo.ts`, `lib/cache/project-lww-invalidator.ts` | Precedent for the invalidation vocabulary, but it is a *cache*: dropped on reload, never authoritative, no writes. |
| Blobs already have a tiered store | `storage/providers/tiered` | Local-over-remote for binaries is a solved shape. |

The honest summary: the pieces for offline exist, but nothing is wired to
survive a reload, and the desktop shell has no local copy of the app at all.

---

## 2. What "offline" has to mean

Three tiers, and we should be explicit about which one we are shipping, because
users hear "offline" and assume tier 3.

**Tier 1 — the app opens.** Window renders, shell and routes load, you see a
clear "offline" state instead of a blank page or a network error. Today: fails.

**Tier 2 — you can read.** Everything previously synced is browsable: papers,
notes, experiments, PDFs you have opened. Today: fails on reload (caches are
in-memory).

**Tier 3 — you can write.** Create, edit, delete; it lands locally and syncs
later. This is the one that needs a real conflict story.

The tiers are strictly ordered. Tier 3 without tier 1 is meaningless.

**Target: tier 3 on desktop, for personal projects, with no account required**
(§9, D1–D3). The web app stays online-first and gets tier 2 as a side effect of
phase 1. Shared projects stay online-only on every platform.

---

## 3. Prior art, and what to take from each

### Obsidian

Obsidian's model is worth studying because it is the one our users compare us to,
and because its guarantees come from a constraint we do not share.

- **The local files are the source of truth.** Sync is an accessory; the vault
  works fully with sync turned off, forever. Nothing is "not yet downloaded".
- **The unit of sync is a file**, and the vault keeps a revision history per
  file. A device uploads a new version tagged with its own device id.
- **Conflicts are not merged automatically in the general case.** When two
  devices changed the same file since their last common version, Obsidian keeps
  both — you get a conflict copy, and a human decides. For markdown edits it can
  do a line-level three-way merge, but the fallback is always "keep both, tell
  the user".
- **Deletes are tombstones with a retention window**, not disappearances, so a
  delete on one device does not race an edit on another into data loss.

What to take: local-first is a *stance*, not a cache tier; and **"keep both and
tell the user" beats any clever automatic resolution you are not certain of.**

What we cannot copy: Obsidian's unit is a file with one obvious owner. Ours is a
relational graph — a paper row, its tags, its field values, its relations to
other papers, its annotations. "Keep both copies of the paper" is not a
coherent user-facing outcome when six tables reference it.

### Git

The user's instinct here is right and worth taking seriously, but it lands on a
specific part of the problem.

Git's genuinely valuable idea for us is **the three-way merge**: to merge safely
you need the common ancestor, not just the two current versions. Two-way LWW
cannot tell "A changed this field" from "B changed it and A didn't", so it
overwrites. With a base version you can distinguish them, and only escalate the
fields where both sides actually moved. **We should keep a base version per
synced row.** That is the git idea, and it is cheap.

What we should not copy:

- **Manual conflict resolution as the default path.** Git's merge conflicts are
  tolerable because its users are programmers who opted into a version control
  tool. A researcher who edited a paper's notes on a phone will not resolve a
  three-way diff, and an app that asks them to has failed.
- **Branches and an explicit sync command.** Sync must be invisible when it
  works. Anything requiring a deliberate "push" will be forgotten precisely on
  the device that had the important edit.
- **Whole-repo commits.** Git's atom is a tree snapshot. Ours needs to be a row,
  or two devices editing unrelated papers will conflict for no reason.

So: **three-way merge, per row, automatic, with escalation to the user only when
two sides genuinely changed the same field.**

### CRDTs (Yjs) — already in the codebase

For prose, a CRDT beats a three-way merge outright: two people typing in
different paragraphs merge with no conflict and no prompt, which is the correct
outcome and the one a line-based merge only approximates. We already run Yjs for
vault pages and log entries.

Its cost is that it only works where a CRDT is defined. It solves text bodies. It
does not solve "device A set status to `done` while device B set it to
`blocked`" — that is a genuine semantic conflict and no CRDT invents the right
answer.

---

## 4. The model: four data kinds, four rules

This classification is the core of the design. Every synced table gets exactly
one label.

### (a) Document bodies → CRDT (Yjs)

`vault_pages.body`, `log_entries.body`, `report_sections.body`.

Already CRDTs online. Offline changes accumulate as Yjs updates in a local
`crdt_updates` mirror and are pushed as ordinary updates on reconnect. Yjs
merges by construction — concurrent edits from three offline devices converge
with no prompt.

Two things must be handled that today's online-only path does not:

- **The log grows unboundedly while offline.** Compaction (`COMPACT_THRESHOLD`
  in `encrypted-yjs-provider.ts`) currently runs against the server. It needs a
  local equivalent, or a month offline produces a very slow first open.
- **Seeding must not double text.** The existing seed-after-replay ordering bug
  (documented in that file's header) gets a new way to happen when the replay
  source is local. The existing `shouldPersistBody` guard and its regression
  test must be extended to the offline path rather than reimplemented.

### (b) Records → three-way merge, per field

`papers`, `experiments`, `milestones`, `reading_lists`, `projects`,
`paper_field_values`, and most other row-shaped data.

Each synced row carries the version it was based on. On sync:

- Only one side changed a field → take it. No conflict.
- Both sides changed a field to the **same** value → take it. No conflict.
- Both sides changed a field to different values → **conflict**. See §6.

Per-field, not per-row: device A renaming a paper while device B tags it as read
is not a conflict, and any design that reports it as one will be ignored by users
within a week — which is how a conflict UI becomes worse than none.

### (c) Sets and junctions → add/remove log (OR-Set)

`paper_tags`, `reading_list_items`, `library_pins`, `shares`, `org_memberships`.

Never LWW the set. Model membership as add and remove operations with ids and
merge the operations. Concurrent "A adds tag X" and "B adds tag Y" yields both,
which is obviously right and which row-level LWW gets wrong half the time.

Standard rule for a concurrent add and remove of the *same* element: **add wins**
(remove only cancels adds it has observed). Recovering from a spurious tag is one
click; recovering from a silently dropped one requires noticing it is gone.

### (d) Append-only logs and immutables → append, never merge

`ai_audit_records`, `lab_snapshots` (already immutable per migration `0112`),
`experiment_metric_points`, `crdt_updates` itself.

Insert-only, idempotent by primary key. No conflict is possible. Cheapest tier —
classify aggressively into it.

---

## 5. Architecture

```
Electron main process
├── PGlite (userData/weaveforge.db)   ← local Postgres, shipped migrations
├── sync engine
│   ├── outbox pump   local ops → PostgREST
│   └── puller        server change feed → local, by watermark
└── IPC ── renderer (existing `postgres` provider, unchanged)
```

**Writes go local first, always.** The local database is authoritative for the UI
— reads never wait on the network, so there is no "is it online?" branch in any
feature. Every write also appends to a local `outbox`.

**The outbox is ordered and idempotent.** Each entry carries a client-generated
op id. Replaying it is safe, which matters because "did that request land before
the connection dropped?" is unanswerable in general.

**The puller is the only thing that trusts the server**, and it pulls by
watermark, not by timestamp (see §6, clock skew).

**Realtime is an optimization, never the source of truth.** It shortens the
window between a change and its arrival. The puller must be independently
correct, because a socket that silently stopped delivering is indistinguishable
from a quiet system — and that failure mode is common enough that any design
depending on the socket for correctness will lose data occasionally and
unreproducibly.

### Server-side prerequisites

These are schema changes and they are not optional:

1. **A monotonic `server_seq`** per synced row, from a database sequence, set by
   trigger on insert and update. This is the watermark. Not `updated_at`.
2. **Tombstones.** `deleted_at` on every synced table plus a purge policy. Hard
   deletes are invisible to a pull-based sync — the row simply is not in the
   response, which is indistinguishable from "you have not synced it yet". This
   is the single most common way sync implementations resurrect deleted data.
3. **A base-version column** so a client can send "I am changing field X, based
   on version N" and the server can detect the concurrent case rather than
   blindly accepting.
4. **RLS policies extended to the change feed.** The feed must return exactly
   what the caller may read, including *removals* when access is revoked. See
   §6.

---

## 6. Edge cases

The section that decides whether this ships without regret. Each entry: the
situation, what breaks naively, what we do.

**Same field edited on two devices, both offline.** Naive LWW picks by clock and
discards the other silently. → Three-way merge detects it (both differ from
base). Resolution: keep both, apply the more recent by `server_seq`, and record
the loser in a `conflicts` table surfaced as a dismissible banner on the affected
record — "Two versions of this. [Keep this] [Keep other] [View both]". Never a
modal, never blocking, never auto-dismissed. Obsidian's "keep both" instinct,
scoped to a field instead of a file.

**Clock skew.** A device with a wrong clock wins or loses everything. Phones and
VMs after suspend are routinely minutes out. → **No wall-clock ordering, ever.**
Ordering is by server-assigned `server_seq`. Client timestamps are display
metadata only. This must be enforced in review; it is the easiest rule to
violate by accident because `updated_at` is right there.

**Delete on A, edit on B.** Naive: either the edit resurrects the row or the
delete destroys unseen work. → Tombstone wins over edit (deletion is usually
deliberate and explicit), **but** the edit is preserved in the conflicts table
with an undelete affordance for the retention window. Never silent.

**Access revoked while offline.** A device holds a full local copy of a project
it may no longer read. → **Resolved by D3**: shared projects are never stored
offline, so there is nothing to revoke. Personal projects have exactly one
member, who cannot be revoked from their own data. This is the single largest
simplification the decisions buy — it removes revocation events from the change
feed and a whole row from the privacy matrix.

**Offline authentication.** The session JWT expires; the app cannot refresh it
offline; the user is logged out mid-flight with their data locally present but
unreadable. → **D1 and D2 make this structural rather than a mitigation**: the
app does not require an account at all, so an expired token can never gate access
to local data. It gates *sync* and nothing else. An expired token shows "sync
paused, sign in again", never a locked app. This is the worst bug in this whole
design — "my work disappeared on the plane" — and the decision removes it by
construction rather than by care.

**Outbox poisoning.** One op the server permanently rejects (validation change,
deleted parent, revoked access) blocks the queue behind it forever, and every
later edit silently stops syncing. → Ops fail independently. After N attempts an
op moves to a dead-letter list surfaced in settings. The queue never blocks on a
single entry. Retries use exponential backoff with jitter.

**Schema skew.** An old desktop build holds a local database at migration 0117
while the server has moved to 0125, and its writes no longer fit. → The sync
protocol carries a schema version; the server refuses ops from a client below a
declared floor with a distinguishable error, and the app shows "update required"
instead of failing writes one at a time. Local migrations run on boot, same
files as the server.

**Partial sync.** A user in a large lab cannot hold every project locally. →
Sync scope is per project, opt-in, with an explicit "available offline" toggle.
Prevents the first-run download from being unbounded, and matches how people
actually work — one active project at a time.

**Blobs.** PDFs are the bulk of the bytes and cannot all be local. →
`storage/providers/tiered` already layers local over remote. Rule: PDFs you have
opened are kept, with an LRU cap and a visible quota setting. Content-addressed,
so blobs never conflict.

**Two Electron windows on one machine.** Two processes, one PGlite file, mutual
corruption. → PGlite lives in the main process only; renderers reach it over
IPC. Single writer by construction. Cross-window invalidation reuses the existing
`project-lww-invalidator` vocabulary.

**Concurrent identical inserts.** Same paper added on two devices while offline
becomes two rows. → Client-generated UUIDs for primary keys (so the row has an
identity before it reaches the server) plus a natural-key dedupe on DOI/arXiv id
that offers a merge rather than silently deduping.

**First sync of an existing account.** A user enabling offline on a project with
years of history downloads everything at once on a hotel connection. → Paged
backfill by `server_seq` ascending, resumable, progress-reported, cancellable.
Newest first so the app is useful before the backfill finishes.

**Time in the CRDT log.** Yjs updates that arrive weeks late must still apply. →
They do, by construction. But compaction must not discard updates a known-offline
device has not seen; compaction watermarks track the oldest active device rather
than the newest.

---

## 7. Phasing

Each phase is independently shippable and independently useful. Nothing here
requires the next phase to be worth having.

| Phase | Scope | Est. |
|-------|-------|------|
| **0. The app opens offline** | Bundle the built app inside Electron instead of `loadURL` to a remote origin (**D1**); an offline route state for the PWA. Tier 1. No data sync. | ~250 |
| **1. Reads survive a reload** | Persist the existing screen caches to IndexedDB with an explicit staleness contract. Tier 2, web and desktop, no schema change. | ~300 |
| **2. Local database** | PGlite in Electron main, migrations on boot, IPC adapter matching `pg.Pool`'s surface, provider `local`, synthetic local user for the RLS role switch (**D2**). The app is fully usable with no account. | ~450 |
| **3. Schema for sync** | `server_seq`, tombstones, base version, change-feed RPC, RLS over the feed. Server-side only, no client change. | ~350 SQL |
| **4. Outbox and puller** | Sign-in, opt-in sync toggle, adoption of local-only rows into the account, op log, backfill, watermark pull. Kinds (a), (c), (d) merge automatically. Personal projects only (**D3**). | ~700 |
| **5. Conflicts** | Three-way merge for kind (b), conflicts table, the banner UI, dead-letter list. | ~450 |
| **6. Blobs and scope** | Per-project offline toggle, PDF LRU with quota UI. | ~250 |

Roughly 2,700 lines across six phases. Against a ~100k-line codebase that is
about 2.5% — but it is 2,600 lines of the hardest-to-test kind, so the ratio
understates it. Phases 3–5 need a test harness that simulates two clients with
independent clocks and a partitioned network; budget that as part of phase 3, not
as an afterthought. **D3** takes multi-user offline conflict out of that harness
entirely — it only ever has to model one user's two devices, which is why the
estimate did not grow more than it did.

## 8. Explicitly not doing

- **A user-facing merge UI in the git sense.** Diff-and-resolve for a
  non-programmer audience. Conflicts get "keep this / keep other / view both".
- **Sync as a filesystem of markdown files.** It would make us Obsidian-shaped
  and lose the relational graph that is the actual product.
- **End-to-end encrypting row bodies as part of this work.** It would remove the
  server's ability to compute a change feed and force a redesign. Separate
  decision, separate plan.
- **Blanket "AI is unavailable offline".** Wrong, and worth stating precisely:
  the *app's* AI surface is local — the proposal flow, the approval gate at
  `/ai-review`, the audit records, the MCP tool dispatch — and only the model
  call itself leaves the machine. So the rule is per-provider, not global:

  | Provider | Offline |
  |----------|---------|
  | Local model (Ollama, LM Studio, llama.cpp) over `localhost` | **Fully works.** Nothing leaves the device. |
  | MCP servers running locally | **Fully works** — and desktop is the only platform that can host them directly. |
  | Hosted models (Anthropic, OpenAI, …) | Works whenever the machine has internet. Unreachable only with no internet at all — and the honest state then is "provider unreachable", not a degraded imitation. |

  **No account, and no WeaveForge server, is involved in any of this.** Pasting
  a key into settings is the whole setup, and it stays that way offline-first:

  - The key lives in memory for the life of the tab and is never persisted
    (`ai-provider-session.ts`) — deliberately, so we never become a party that
    stores it. It is not sealed through `/api/settings/credentials`; that route
    handles *integration* credentials (Zotero, GitLab, Semantic Scholar) only.
  - The call goes straight from the app to the provider's `baseUrl`
    (`byok-model-conversation.ts`). Our backend is not in the request path, so a
    hosted model works while signed out, while sync is off, and on a build that
    has never talked to our servers. The key is authentication to the
    *provider*, not to us.
  - The one thing D1 changes: with no persistence, a desktop user re-enters the
    key on every launch. On a machine that is the user's own and already the
    source of truth for their data, that trade is worth revisiting — an
    OS-keychain store (`safeStorage` in Electron) keeps the "we never hold it"
    property while removing the retyping. Phase 2 decision.

  What this needs: the provider list must render reachability per provider
  rather than one global online flag, proposals must queue locally when the
  model is unreachable, and the relay's retention policy (migration `0116`)
  must tolerate a request that sits pending for days. The desktop app being
  independent (**D1**) is what makes a genuinely offline AI workflow possible
  at all — a local model plus local MCP servers is a complete loop with no
  network.
- **Automatic resolution of semantic conflicts** (`status: done` vs
  `status: blocked`). No rule is right; ask.

## 9. Decisions

Pricing follows from these — sync and hosted storage are what the hosted service
sells once the app itself is free and complete offline. See
[`../../pricing-strategy.md`](../../pricing-strategy.md) §3.1.

Settled. These are product calls and they simplify the engineering
substantially — each one removes a whole class of edge case rather than
deferring it.

**D1 — The desktop app is independent.** It ships its own copy of the web build
and runs with no network and no account. Not a shell over a remote origin, not
a cache that degrades. The local database is the source of truth, the same
stance Obsidian takes. Cost: a larger installer, and version skew between a
client and the server becomes real (handled by the schema floor in §6).

**D2 — Sync is opt-in, and opting in requires sign-in.** No account is needed to
use the app; turning sync on is what asks for one. Sign-in is not mandatory at
first run. This keeps the "just let me write" path free of an account wall while
making the security model of sync unambiguous: everything that leaves the device
belongs to an authenticated user.

**D3 — Shared projects require sign-in and a live connection.** They are not
available offline, at all. Revocation-while-offline, RLS over the change feed,
and offline multi-writer conflict all disappear as problems. A shared project
shown offline is a read-through cache at most, and phase 1 already covers that.

**D4 — Retention is 30 days**, matching Obsidian Sync's standard version
history. Tombstones, conflict records, and superseded versions are kept 30 days
and then purged. Consequence to state plainly in the UI: **a device that has
been offline longer than 30 days cannot be reconciled incrementally** — it
re-syncs from scratch, and local-only changes made in that window are surfaced
as conflicts rather than merged. (If a longer window is ever wanted, it is a
storage-cost decision, not a redesign.)

### What D1–D3 change

- The local database has a **local-only user identity** when nobody is signed
  in — a synthetic uuid the RLS role switch (`pg-runner.ts`) binds to, so
  policies behave identically whether or not an account exists.
- **Adoption on first sign-in.** A user who worked locally for a month and then
  enables sync has rows owned by the synthetic local user. Those rows must be
  re-owned to the real account in one transaction, and it must be resumable —
  it is a bulk update over every synced table and it will be interrupted at
  least once in the field. Adoption is a phase 4 deliverable, not an afterthought.
- **Sign-out must offer a choice**, and must not assume: keep the local data
  (device stays usable offline) or wipe it. Silently doing either is wrong —
  wiping destroys work, keeping it leaves data on a shared machine. Ties into
  `docs/PRIVACY_TEST_MATRIX.md`.
- Sync is **single-user multi-device** only, which is a materially easier
  problem than multi-user: conflicts are one person's own edits from two of
  their own devices, so "keep both and tell me" is an answer they can act on.

### Still open

1. Does an offline-only user get a **local project** with no server counterpart,
   or does the app create a project id that would be valid server-side if they
   later sign in? The second is slightly more work now and avoids an id
   remapping pass during adoption. Leaning toward the second.
2. What happens to a **local-only install on a second machine**? Two independent
   local vaults, both later adopted into one account, will duplicate every
   project. Either adoption is limited to the first device, or the second device
   is offered "merge into account" versus "replace local" at sign-in.

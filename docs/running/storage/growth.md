# What actually grows

A survey of where the database's bytes are, and which tables will decide when
the volume fills. Measured rather than guessed — `node scripts/measure-database-storage.mjs`
reproduces all of it (through the SSH tunnel; see
[`oracle-shift-guide.md`](../oracle-shift.md)).

## The headline

**The whole database is 3.5 MB across 42 tables.** There is no storage problem
today, and per-table "bytes per row" figures at this size are mostly page slack:
`papers` reports ~4 kB/row for 78 rows because a table with three indexes cannot
occupy less than a handful of 8 kB pages, whatever is in it.

So the useful question is not *what is big* — nothing is — but **what grows
without bound**, because that is what decides when the 50 GB `pgdata` volume
runs out. OCI Always Free caps every volume at 200 GB combined, so there is
nowhere to grow into.

## The three shapes of table

| Shape | Grows with | Examples |
|---|---|---|
| **Fixed** | the size of the workspace | `papers`, `vault_pages`, `profiles`, `projects` |
| **User effort** | how much work someone does | `reader_annotations`, `report_sections`, `milestones` |
| **Usage** | how often the product is *used* | `experiment_metrics`, `crdt_updates`, `ai_mcp_relay_requests`, `ai_audit_records` |

Only the third shape matters. A workspace has as many papers as the researcher
has papers; it has as many metric points as their training loop chose to log,
which is unbounded and unrelated to anything a person typed.

## Usage-shaped tables, and what bounds each

| Table | Bounded by | Status |
|---|---|---|
| `experiment_metrics` | downsampling on write, then chunked storage | **Done** — see [the plan](../../internal/future-work/metrics-storage-plan.md). 448.7 → 22.5 B/point, and a run's footprint is now logarithmic in its length |
| `ai_mcp_relay_requests` | `purge_ai_mcp_relay_requests()`, swept from the claim RPC | **Done** — migration `0116` |
| `share_link_rate_limits` | rows older than 2 hours deleted inside `check_share_link_rate` | Bounded since `0049` |
| `crdt_updates` | compaction to a snapshot once a document's tail passes `COMPACT_THRESHOLD` | Bounded — tracks document *size*, not edit count |
| `ai_audit_records` | nothing | **Unbounded.** One row per accepted/rejected AI proposal. Deliberate: it is an audit trail, and deleting it defeats the point. Small per row and gated on a human decision, so it grows at human speed |
| `blob_objects` | the blobs it describes | Bounded by storage, which has its own [tiering](tiering.md) |

### `ai_mcp_relay_requests` — the one that was missed

Worth recording because of how it hid. Its own schema comment called it
"Short-lived opaque MCP relay envelopes", and `expires_at` was honoured — but
only as a *read-time verdict*: the API reported `status: 'expired'` for a stale
row and left it in place. Nothing ever deleted anything.

Measured before the fix: 71 rows, 232 kB, of which 136 kB TOAST — about 3.3 kB
per row, one row per MCP tool call, retained since the feature shipped three
weeks earlier. After `0116` swept it: **248 kB → 32 kB**.

The lesson generalises: *a table can be documented as ephemeral, honour its own
expiry, and still never delete a row.* An expiry column is not retention.

### `reader_annotations` — effort-shaped, until ink arrived

Annotations are effort-shaped: one row per thing a person deliberately marked.
Ink breaks that assumption, because the row's *size* is set by the input device
rather than by the person. A stylus samples at 120–240 Hz, so a two-second
stroke captured raw is ~360 points — **13.3 kB of JSON for one pen stroke** —
and a page of handwriting is megabytes. Nothing deletes it, and nothing should:
these are the user's notes.

So the bound is applied at the point of capture instead, in
`packages/core/src/reader/ink-stroke.ts`:

| Budget | Mechanism | Effect |
|---|---|---|
| Sampling | points closer than 0.75 pt to the previous one are never recorded | drops the samples that land inside the nib |
| Shape | Ramer–Douglas–Peucker at 0.35 pt before the write | a typical stroke loses 80–90% of its points and no visible detail |
| Precision | coordinates rounded to 2 dp | a PDF point is ~0.35 mm; the digits below this were float noise |
| Per stroke | hard cap of 400 points, reached by simplifying harder | no single stroke is unbounded, whatever the device does |
| Per mark | strokes drawn together join one annotation, up to 64 | a handwritten sentence is one row, not twenty — and one row's per-row overhead, not twenty |

Measured on that same two-second stroke: 360 captured samples → 188 after the
sampling filter → **33 stored points, 446 B — a 30× reduction**, with the same
mark on screen. Pressure is the one thing deliberately *not* stored per point — it
would add a third number to every sample, and Zotero's ink annotation has
nowhere to put it; one width per stroke gets the same visual result for a
constant 8 bytes.

## Indexes

Indexes are **59% of the database**, and 57 of them have never been scanned
(840 kB). That number is a hint, not a verdict: on a young deployment "never
scanned" usually means "no query has taken that path yet", and several of them
exist for RLS policies or foreign keys where the cost of *not* having one is a
sequential scan on every delete. They are left alone deliberately. Revisit when
the database is large enough for `idx_scan = 0` to mean something.

## When to look again

The measurement script prints bytes per row and flags never-scanned indexes.
Worth re-running when any usage-shaped table passes ~100 MB, or when adding a
table that grows per *event* rather than per *object* — at which point the
question to ask is the one this page exists to answer: **what deletes these?**

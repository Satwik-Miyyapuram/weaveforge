# Building the six, in order

The build plan for the six candidates in
[research-2026-08-competitive.md](research-2026-08-competitive.md), rewritten
after reading what the repository already contains. Two of the six turned out to
be half-built, and item 6 turned out to be small rather than large once the
dependency was refused. That changes the order.

Every item answers the same three questions before it earns a place: does it
work with the network unplugged, what does it cost in lines, and what can it
delete.

## What the survey changed

Three findings, because they move items around:

- **Local semantic search is largely shipped.** `apps/web/src/features/search`
  already holds `semantic-index.ts`, `semantic-search.ts`, a
  `WorkerEmbedder` running `Xenova/all-MiniLM-L6-v2` in a worker, and
  `vector-store-idb.ts`. It is opt-in and it embeds on this machine. Item 3 is
  therefore not "build embeddings" — it is "make the thing we have reachable
  from the desktop with no account, and from MCP".
- **Zotero annotations already import** — but through `zotero-web-api.ts`,
  which is an account and a network. The desktop already proxies the local
  Zotero over `weaveforge:zotero-local`. Item 4 is a second reader behind the
  same domain types, not a new feature.
- **Cite-key resolution already exists**, in
  `apps/web/src/features/overleaf/application/build-overleaf-export.ts`
  (`resolveCiteKey`, `bibKey`). Item 1 needs those rules in `core`, which means
  item 1 *moves* code before it adds any.

## Order

| Wave | Items | Why together |
| --- | --- | --- |
| 1 | 1 — bibliography validation<br>6 — local compile | Both are about the LaTeX a report already has. Both are pure-ish, small, and fully offline. Wave 1 is the cheapest thing that a user notices. |
| 2 | 4 — local Zotero annotations<br>3 — semantic search everywhere | Both are "the code exists, the offline path does not". Neither needs a migration. |
| 3 | 5 — wider MCP surface<br>2 — screening and PRISMA | Both need decisions the earlier waves inform: 5 wants the semantic ranking from 3, and 2 is the only item with a schema change and a second person in it. |

---

## Wave 1

### 1. Bibliography validation

**What exists.** `latex-section-tree.ts` in `core` already parses `.tex` sources
into a tree and follows `\input`/`\include`. `overleaf-git-reader.ts` and the
desktop's `overleafRead` channel already deliver those sources. `paper.bibtex`
holds the entry text. `build-overleaf-export.ts` already knows how a cite key is
chosen.

**What to build.**

1. `packages/core/src/features/report/domain/cite-key.ts` — move
   `resolveCiteKey` and the dedupe wrapper out of `apps/web`. Pure, and `apps/web`
   imports it back. Net lines: roughly zero, and one duplication fewer for
   `check:dry` to worry about.
2. `packages/core/src/features/report/domain/bib-entries.ts` — a small BibTeX
   reader: entry type, key, fields, brace balance. Not a full parser; the job is
   to answer questions about entries, not to re-render them.
3. `packages/core/src/features/report/domain/bibliography-report.ts` — the
   actual check, a pure function from `{ sources, entries }` to findings:
   - `\cite` keys with no entry (**the one Overleaf cannot answer**)
   - entries the draft never cites (**the other one**)
   - duplicate keys
   - missing required fields per entry type
   - malformed DOI or URL
   - author-format inconsistency within the file
4. A panel on the report screen listing findings grouped by file and line, each
   one a jump into the section tree.

**Offline.** Entirely. No network, no model, no server. The sources are already
on the machine by the time the panel opens.

**Size.** ~450 lines of `core` plus tests, ~200 of UI. Deletes ~40 from
`build-overleaf-export.ts`.

**Done when** a report with a deliberately broken `.bib` lists every finding,
and a clean one says so in one line rather than an empty panel.

### 6. Compile locally — detect, never bundle

**What exists.** Nothing. The report screen links out to Overleaf.

**What to build.**

1. `apps/desktop/src/tex.ts` — look for `latexmk`, then `tectonic`, then
   `pdflatex` on the path. Answer `{ tool, version } | null`. Nothing is
   downloaded and nothing is installed; a missing TeX is a `null`, not an error.
2. Two channels in `channels.ts`: `texProbe` and `texCompile`. Compile spawns in
   the report's working copy, streams the log, and answers a path to the PDF or
   the first error line with its file and line number.
3. The Compile button appears only when the probe answered. When it did not, the
   feature is invisible and Overleaf is exactly as it was.

**Why not bundle.** A full TeX Live is 7–8 GB; a small scheme is still a few
hundred megabytes, against a desktop app of a couple of hundred in total. That
is an order of magnitude on the download for the minority who would use it. If
people ask later, the honest middle is an opt-in download they trigger
themselves — Tectonic is a ~25 MB binary that fetches packages on first use —
and it must be their choice, because it is a network dependency inside the
feature we advertise as offline.

**Offline.** Yes, when a TeX is present. That is the whole point: no queue, no
compile ceiling, no upload.

**Size.** ~250 lines in `apps/desktop`, ~120 of UI. Two channels, so the
generated IPC table in `architecture-map.md` moves by itself.

**Done when** a machine with `latexmk` compiles a linked report to a PDF with
the network down, and a machine without one shows no button at all.

---

## Wave 2

### 4. Annotations from the Zotero already running here

**What exists.** `zotero-annotations.ts` reads highlights, notes and their
colours — over the web API. `apps/desktop/src/zotero-local.ts` already proxies
the local Zotero and refuses every URL that is not its API.

**What to build.**

1. Split `zotero-annotations.ts` at the seam it already has: the mapping from
   Zotero's JSON to our `ZoteroAnnotation` stays, the transport becomes an
   argument. One reader for the web API, one for the local proxy.
2. A "read annotations from this machine" path on the paper screen, offered when
   the desktop reports a local Zotero.
3. Annotations land as a literature note on the paper row, colours preserved,
   because the colour is how the documented workflows encode meaning.

**Offline.** Yes — both processes are on this machine.

**Size.** ~180 new lines, and it should delete ~60 by removing the second
mapping that would otherwise appear.

**Done when** the same PDF's highlights arrive identically over both transports,
proven by one test with two fake transports and one expectation.

### 3. Semantic search everywhere it should already be

**What exists.** The whole embedding path, opt-in, in the browser. What it is
missing is three things.

**What to build.**

1. **Weights with no network.** `WorkerEmbedder` takes a `host`; the desktop can
   serve the model from the app's folder once it has been fetched, so a copy
   with no account can turn the feature on and keep it across restarts.
2. **Vectors in the local database.** `vector-store-idb.ts` is IndexedDB, which
   is the browser's answer. In the desktop the workspace folder is the durable
   one; the index should survive a cache clear.
3. **Ranking behind `search_workspace`.** The MCP tool ranks by word today. When
   semantic is on, it should rank by meaning — which is the sentence in the
   research doc that no cloud competitor can say.

**Offline.** Yes, after the weights are on disk once. State that plainly in the
UI rather than implying the model appears from nowhere.

**Size.** ~300 lines, mostly a second `VectorStore` implementation behind the
interface that already exists.

**Done when** a desktop copy with no account, with the network unplugged,
answers a semantic query correctly after a restart.

---

## Wave 3

### 5. A wider MCP surface

**What exists.** Three read tools and ten proposal tools, dispatched in
`mcp-browser-relay.ts`; the desktop's own server in `apps/desktop/src/local-mcp.ts`
answers three. The proposal gate is already the rule: nothing is written without
review.

**What to build.** The tools that make the one question we can answer and nobody
else can — *what did I claim in chapter 3, which run supports it, and where did
I get it from* — actually answerable:

- `get_report_section` — a section by title, with its cite keys
- `list_experiments` / `get_experiment` — runs and their metrics
- `get_paper` — one paper with its notes and annotations
- `propose_report_edit` — behind the same gate as every other write

**Offline.** Yes; same database, same rows. The model is the caller's problem,
not ours.

**Size.** ~350 lines, and the dispatch is a `switch` that is already there.
Watch for the third copy of tool metadata appearing — the generated
`mcp-tools` block in `MCP_IMPLEMENTATION.md` should keep reading from one list.

**Done when** the generated tool table grows without anybody editing a doc, and
each new tool has a dispatch test.

### 2. Screening states and a PRISMA count

The largest item, and the only one with a migration. It is last because it is
the only one that would be painful to get wrong.

**What exists.** `ReadingList` and `ReadingListItem` in `core`, with a `note` on
the join row. Sharing and supervision already give us a second person.

**What to build.**

1. A migration adding a screening decision per reviewer per item: state
   (`included` / `excluded` / `unsure`), a reason, who, when. On the join row's
   own table, not on the paper — the same paper can be screened differently in
   two reviews.
2. Domain rules in `core`: the state machine, and inter-rater agreement, which
   is nearly free once two people's decisions are rows.
3. PRISMA counts — identified, screened, eligible, included — derived, never
   stored. A stored count is a count that drifts.
4. Export as a LaTeX figure into the linked report, reusing the export path
   wave 1 will have tidied.

**Offline.** The screening is. The second reviewer is not, and should say so.

**Size.** The big one: ~700 lines plus a migration plus UI. Rayyan charges for
the diagram; ours falls out of data we already keep.

**Done when** two reviewers disagreeing on one paper produce a correct
agreement figure and a PRISMA diagram whose numbers add up.

---

## The line budget

The standing goal is to shrink, not grow, and this plan adds roughly 2,400
lines against a repository already past 137,000. That is only defensible if it
is paid for. Three places to take it from, to be done alongside the waves rather
than promised afterwards:

- The cite-key move in wave 1 removes one duplication; look for the others
  `check:dry` is not yet strict enough to see.
- The annotation split in wave 2 should end with one mapping, not two.
- `apps/web` is 94,000 of the 137,000. The feature folders with no `domain/`
  directory are where logic sits in components, and moving that into `core`
  usually deletes more than it moves.

## Related

- [The market read this plan answers](research-2026-08-competitive.md)
- [How WeaveForge is put together](../architecture-map.md)

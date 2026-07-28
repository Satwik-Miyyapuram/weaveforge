# Overnight work queue

Four tasks, in order. Each is independently committable. Work them **one at a time, in sequence**.

## Prerequisites — verify these BEFORE starting Task 1

A freshly copied working tree is not a working environment. If either of these is
wrong, every task fails its done-check for reasons unrelated to the code, and the
revert-and-skip rule below will discard good work across the whole queue.

**1. Dependencies installed.** `node_modules/` must exist at the repo root. If not:

```bash
npm install
```

**2. `ripgrep` must be visible to npm, not just to your shell.** `scripts/check-solid.mjs`
and `scripts/check-dry.mjs` shell out to `rg` via `execSync`. When `rg` is missing the
wrapper swallows the error, returns no matches, and **the checks exit 0 having verified
nothing** — a silent false pass on the exact boundaries this queue exists to protect.

On Windows, npm spawns `cmd.exe`, so `rg` must be on the *system* PATH — a shell that
merely aliases it is not enough, and a process started before `rg` was installed holds a
stale PATH until it is restarted.

Verify with:

```bash
npm run check:solid
```

If the output contains `'rg' is not recognized`, the gate is **not** running, even though
it reports "SOLID boundary checks passed". Install ripgrep, restart the shell **and the
agent process**, and re-check. Do not begin work until this command runs clean.

---

## Rules for the whole run

**Read before starting anything:**

- `docs/DESIGN.md` — section 4, the SOLID rules for this codebase
- `docs/dev.md` — "SOLID boundaries (enforced in CI)"
- `CONTRIBUTING.md` — commit rules and licence rules

**Definition of done, per task.** One command, and it must exit 0:

```bash
npm run check:all
```

That runs `typecheck` → `lint` → `check:boundaries` → `test:core` → `test:web` → `build`.

**Superseded 2026-07-27.** This used to be `typecheck` + `test:core` + `check:boundaries` + `build:core`. That set was not enough, and a Phase C/D review found two failures that had survived eleven review loops because of it:

- `tsc --noEmit` passed while `next build` failed — a Next.js `route.ts` may export only route handlers and route config, and the generated route types are checked only during the real build. **`typecheck` is not a proxy for `build`.**
- `next lint` failed with an *error* and was in no gate at all.

Also: nothing ran the ~284 web unit tests (`test:core` covers `packages/core` only), and the web test glob required a directory literally named `test`, so files like `src/lib/recent-targets.test.ts` had never run once. Both fixed.

If a task touches anything under `apps/web`, `check:all` is the only signal that means anything. Do not report a task green on `typecheck` alone.

**Commits.** Conventional commits, signed off (`git commit -s`), smallest coherent units. **Do not push. Do not open a pull request.** Leave everything local.

**If a task cannot reach green:** do not thrash and do not carry a broken tree into the next task. Revert that task's changes (`git checkout -- .` for uncommitted work), append what you found and why you stopped to `docs/future-work/overnight-notes.md`, commit *only* that notes file, then **move on to the next task**. A skipped task with good notes is a success; a broken tree that blocks the remaining three is not.

**Never touch:**

- Any RLS policy
- **Migrations — amended policy (decision D4, 2026-07-25):** you **may author** a new migration file under `supabase/migrations/` when a task explicitly requires schema. You must **never apply, run, or execute** a migration against any database, and never edit an existing migration file. Commit new migrations as files for human review. No task in this queue currently requires one.
- any `.env` file, `local-dev/**`, `apps/web/e2e/.auth/**`
- `package.json` dependencies — no new packages, for any task
- `python/**` or `plugins/**`

**Licence.** This repository is AGPL-3.0-only. Do not paste code from other projects unless its licence is AGPL-compatible. Work from documentation and observed behaviour, not from other projects' source.

---

## Task 1 — Capture Zotero annotation position fields

**Spec:** `docs/plans/completed/pdf-viewer-plan.md` §5.1, §5.2, Phase 0.

`apps/web/src/features/papers/infrastructure/zotero-annotations.ts` currently reads only `annotationText`, `annotationComment`, `annotationColor`, `annotationPageLabel` and `tags`. It discards three fields the reader will need:

| Field | Shape |
|-------|-------|
| `annotationType` | `highlight` \| `underline` \| `note` \| `image` \| `ink` |
| `annotationPosition` | **JSON string**, e.g. `{"pageIndex":24,"rects":[[203.6,431.05,546.86,441.6]]}` |
| `annotationSortIndex` | pipe-delimited ordering key, e.g. `"00008\|000412\|00574"` |

Add them to the `ZoteroItem` data interface in `zotero-annotations.ts` and to `ZoteroAnnotation` in `apps/web/src/features/papers/domain/zotero.ts`.

**Requirements**

- `annotationPosition` arrives as a JSON **string**. Parse defensively — it may be absent, empty, or malformed. Never throw; degrade to `undefined`.
- `pageIndex` is **zero-based**. Do not conflate it with `annotationPageLabel`, which is a display string and may be roman numerals or arbitrary text.
- All new fields are **optional**. Every existing consumer of `ZoteroAnnotation` must compile and behave unchanged.
- **One** parse helper, used once. Do not inline the same parsing twice — `check:dry` will catch it.
- `ZoteroAnnotation` is a feature-local domain type. Keep this task inside `features/papers`. Do not add to `packages/core`.

**Tests** — extend `apps/web/src/features/papers/test/zotero-annotations.test.ts`. Cover: well-formed position; absent position; malformed JSON; missing `rects`; and that an annotation with none of the new fields maps exactly as before.

---

## Task 2 — Anchor resolution (pure functions)

**Spec:** `docs/plans/completed/pdf-viewer-plan.md` §5.1 and §4.1 of `docs/competitive-research-verified-2026-07.md`.

Create `packages/core/src/reader/` with pure anchor-resolution logic. No I/O, no React, no Supabase — the `packages/core` dependency rule applies strictly.

Implement, per the W3C Web Annotation Data Model:

- A `TextQuoteSelector` type carrying `exact`, `prefix`, `suffix`
- A `TextPositionSelector` type carrying `start`, `end`
- `resolveQuote(text, selector)` — find the offset of `exact` in `text`, using `prefix`/`suffix` to disambiguate
- **Multiple-match rule:** the spec says a quote selector *SHOULD* match all occurrences. That is wrong for jump-to-locus. When several matches survive prefix/suffix disambiguation, resolve to the one **nearest the stored `TextPositionSelector` offset**; if no position fallback exists, take the first match on the lowest page.
- Return a confidence signal (e.g. `exact` / `fuzzy` / `none`) rather than silently guessing. The caller needs to be able to warn "source may have changed" instead of jumping to the wrong place.

**Requirements**

- Pure functions only. Deterministic, no clock, no randomness, no network.
- Export through the existing barrel pattern used by sibling folders in `packages/core/src`.
- Normalise whitespace consistently between stored selector and searched text, and make that normalisation a single shared helper.

**Tests** — new file under `packages/core/test/`. Cover: unique match; multiple matches disambiguated by prefix; multiple matches disambiguated by position fallback; no match; whitespace-normalisation differences; empty `exact`.

---

## Task 2b — Whitespace normalisation for anchor matching (REQUIRED FIX)

Task 2 shipped without the normalisation the spec required. `findQuoteMatches` uses raw `text.indexOf(exact)`, so a quote captured from one PDF text extraction will not match text from another — different pdf.js version, different line-breaking, collapsed or expanded spaces. The **primary** anchor then silently degrades to the position fallback, which the W3C spec itself calls "very brittle". This defeats the reason quote selectors are primary at all, and is the anchor-rot risk named in `docs/plans/completed/pdf-viewer-plan.md` §9.

**Add to `packages/core/src/reader/`:**

- A **single shared** normalisation helper. Collapse all runs of whitespace (including newlines, tabs, non-breaking spaces, and soft hyphens at line ends) to a single space, and trim. One definition, used by every code path that compares text.
- Matching must run over normalised text on **both** sides — the stored `exact`/`prefix`/`suffix` and the searched text.
- **Offsets must map back to the original string.** Callers need spans into the real text to highlight or scroll. Build an index map during normalisation and translate the match span back before returning. A span that only makes sense in normalised space is not useful.
- Keep the existing exported function signatures working.

**Tests** — extend `packages/core/test/anchor-resolution.test.ts`. Cover: quote stored with single spaces matching text containing a newline mid-phrase; text with doubled spaces; leading/trailing whitespace differences; a returned span that indexes correctly into the **original** (non-normalised) text; and confirmation that all existing tests still pass unchanged.

---

## Task 3 — Richer citation-alert signals

**Spec:** `docs/competitive-research-verified-2026-07.md` §4.2.

The Semantic Scholar API exposes three fields on citation edges that we do not currently capture:

| Field | Meaning |
|-------|---------|
| `contexts` | citing text snippets |
| `intents` | `background` \| `method` \| `result` |
| `isInfluential` | flags highly influential citations |

`CitationCandidate` in `packages/core/src/features/relations/application/citation-source.ts` currently has `id`, `title`, `authors`, `year`, `url`, `citationCount`. Extend it with these three, all **optional**, then populate them in `apps/web/src/features/relations/infrastructure/semantic-scholar-citation-source.ts`.

**Requirements**

- Additive only. `ICitationSource` implementations that do not provide these must keep compiling — that is the Open/Closed intent stated in the port's own doc-comment.
- **Important caveat:** `contexts` and `intents` exist only for papers where Semantic Scholar has full text. Absent data is the normal case, not an error. Model it as optional and let callers degrade.
- Do not change alert *delivery* (logbook entries, Mattermost). This task ends at the data being available on the candidate.
- Do not change the polling budget (≤ 1 check per paper per day).

**Tests** — extend `apps/web/src/features/relations/test/semantic-scholar-citation-alerts.test.ts` and, if the use-case surface changes, `packages/core/test/check-citation-alerts.usecase.test.ts`. Cover: all three fields present; all absent; `intents` present but `contexts` absent; malformed payload.

---

## Task 4 — Multi-format citation formatters (pure)

**Spec:** `docs/competitive-research-verified-2026-07.md` §6, P1 "Multi-format citation insertion".

Today the pipeline emits only `\cite{key}` for LaTeX. Add **pure formatting functions** for the other common forms, alongside the existing cite-key resolution in `apps/web/src/features/overleaf/application/build-overleaf-export.ts`.

Formats to support:

| Format | Output |
|--------|--------|
| LaTeX | `\cite{key}` *(existing behaviour — do not change it)* |
| Pandoc | `[@key]` |
| Footnote | a footnote-style reference |
| Raw | the bare cite key |

**Requirements**

- **Pure functions plus tests only. Do not wire any UI in this task.** The editor integration is a separate decision and needs a human.
- Reuse the existing cite-key resolution precedence — `metadata.citeKey` → key in `bibtex` → Better BibTeX `Citation Key:` in the Zotero `extra` field → DOI / arXiv / id. **Do not reimplement it.** If it is not already a reusable function, extract it once and have both callers use it; that extraction is the DRY-correct move here.
- Existing Overleaf export output must be byte-identical. `apps/web/src/features/overleaf/test/build-overleaf-export.test.ts` must pass unchanged.

**Tests** — new cases alongside the existing Overleaf export test. Cover each format, plus a paper with no resolvable cite key.

---

## Task 5 — Zotero position ↔ PdfLocus bridge (pure)

**Spec:** `docs/plans/completed/pdf-viewer-plan.md` §5.1, "Two anchors, not one".

Task 1 captures Zotero's `{pageIndex, rects}`. Task 2 gives W3C selectors. Nothing connects them, and §5.1 requires **both** — Zotero rects for write-back interop, quote selectors for durability across re-resolution.

Add pure mapping and decision logic in `packages/core/src/reader/`:

- A combined anchor type carrying an optional Zotero `{pageIndex, rects}` **and** an optional `PdfLocus`, plus the content hash of the PDF the rects were captured against.
- `chooseAnchorStrategy(anchor, currentContentHash)` — returns which anchor to trust: use rects **only** when the content hash matches the file the annotation was made against; otherwise resolve by quote and mark confidence low. Never silently trust rects against a different file.
- Pure functions only. No I/O, no hashing implementation — the hash arrives as a caller-supplied string.

**Note:** `ZoteroAnnotationPosition` currently lives in `apps/web/src/features/papers/domain/zotero.ts`. Do **not** import from `apps/web` into `packages/core` — that inverts the dependency rule. Define the shape structurally in core and let the web layer map onto it.

**Tests** — new file under `packages/core/test/`. Cover: matching hash prefers rects; mismatched hash falls back to quote with low confidence; no rects at all; no quote at all; neither present.

---

## Task 6 — Source resolution ladder ordering (pure)

**Spec:** `docs/plans/completed/pdf-viewer-plan.md` §4.

The plan defines a six-step ladder for locating a paper's PDF: browser cache → Zotero → WebDAV → open-access URL → user URL → opt-in server blob. Build the **ordering and selection logic** as pure functions now; the real network adapters come later.

- Define an `IPdfSourceResolver` port: an id, a `supports(paper)` predicate, and a resolve method. Model it on the existing `ICitationSource` in `packages/core/src/features/relations/application/citation-source.ts` — same Open/Closed intent, where adding a source is a new class and never an edit to the chain.
- Implement the chain runner: try resolvers in priority order, return the first success, skip resolvers that do not support the input, and continue past a failing resolver rather than aborting the chain.
- Report which resolver won, so callers can show provenance and so cost-bearing sources are visibly last.

**Requirements**

- Pure. Tests use in-memory fake resolvers — **no network, no real adapters in this task.**
- The opt-in server blob must be orderable last; the chain must never reorder cost-bearing sources ahead of free ones.

**Tests** — new file under `packages/core/test/`. Cover: first resolver wins; unsupported resolvers skipped; a throwing resolver does not abort the chain; all fail returns a clear miss; winning resolver id reported.

---

## Task 7 — Vault note template engine (Phase B, P0 — the hard part)

**Spec:** `docs/plans/completed/roadmap-2026-07-phased.md` Phase B, "vault note templates".

The highest-priority unblocked item on the roadmap. ZotFlow's templated source notes are its single strongest draw and `§6.9` has no equivalent — but the templating is not the hard part. **The hard part is re-rendering a template without destroying the researcher's own edits.** ZotFlow solves this with persistent and editable regions; a template that clobbers a week of notes on refresh is worse than no template at all.

Build the engine as **application-layer logic with no UI**. Follow the shape of the existing `apps/web/src/features/papers/application/paper-source-note-scaffold.ts` and its test — that is the precedent for this kind of code in this repo.

**Implement:**

- A template format with **variable substitution** over a supplied context object (paper metadata, tags, annotations). Missing variables degrade to empty, never throw, never emit `undefined`.
- **Region markers** delimiting generated regions from user-owned regions.
- A **merge function**: given an existing document and a freshly rendered template, produce an updated document where generated regions are refreshed and **user-edited regions are preserved byte-for-byte**.
- Content outside any marker is user-owned by default. When in doubt, preserve — losing user text is the one unacceptable failure.

**Requirements**

- No UI, no React, no Supabase. Application layer only.
- Deterministic: same input, same output. No clock, no randomness.
- Markers must survive a round trip — render, user edits, re-render, edits still intact.
- Handle a document whose markers were damaged or partially deleted by the user: degrade to preserving everything rather than guessing.

**Tests** — new file under `apps/web/src/features/vault/test/`. Cover: first render from empty; re-render preserving a user-edited region; re-render updating a generated region; user content outside all markers preserved; missing template variables; malformed or half-deleted markers; and a full round trip asserting user text is byte-identical.

---

## Task 8 — Experiment artifact references (Phase B, P1)

**Spec:** `docs/plans/completed/roadmap-2026-07-phased.md` Phase B, "artifact-to-report pinning".

Report sections need to embed experiment artifacts. Build the **reference format and its resolution logic** now; the insertion UI comes later with a human.

- A reference syntax identifying an experiment run and an artifact within it, parseable out of markdown body text.
- `parseArtifactRefs(markdown)` — extract every reference with its position in the source.
- `serialiseArtifactRef(ref)` — the inverse; round-trips exactly.
- A resolution result type distinguishing: resolved, experiment not found, artifact not found, and **experiment stale** (per the existing ~2-minute heartbeat rule in `§6.10`) so a report can flag a figure whose run has gone stale.

**Requirements**

- Pure parsing and formatting. No blob fetching, no Supabase — resolution takes a supplied lookup function.
- The syntax must not collide with existing markdown, wikilinks `[[...]]`, or image embeds already used in vault and paper notes. Check before choosing.

**Tests** — new file under `apps/web/src/features/report/test/` (or `experiments/test/`, whichever owns the code). Cover: single and multiple refs; refs adjacent to normal markdown; round-trip fidelity; each resolution outcome including stale; and text containing no refs.

---

## Task 9 — Citation signal ranking (Phase B, P1 — small)

**Depends on Task 3.** Once `intents` and `isInfluential` are available, add a pure ranking helper so alerts can be ordered by "should I read this?" rather than by date.

- Rank `result` and `method` citations above `background` — someone building on the work matters more than a name-drop.
- Treat `isInfluential` as a strong positive signal.
- Missing signals must not sink an item: absent data is the normal case (see Task 3), so an unranked citation sorts on recency, not last.

**Tests** — extend the Task 3 test file. Cover: ordering across all three intents; `isInfluential` promotion; all-signals-absent falling back to recency; and a mixed list where some items have signals and some do not.

---

## Explicitly out of scope for this queue

**The governing rule is a test surface, not a phase boundary.** Web UI has no unit-test coverage in this repo — 23 test files under `apps/web/src/features/*/test/`, none touching `.tsx` — and the four done-check commands never exercise it. Unsupervised UI work would therefore pass every gate while being functionally unverified. That is why Tasks 7–9 build the testable cores of Phase B and stop short of wiring them into screens.

Do not attempt these. They need a human, credentials, or a decision:

- **Any file under `apps/web/src/**/ui/**`** — no test surface, see above

- The reader UI itself — blocked on the `zotero/reader` vs pdf.js engine choice (`pdf-viewer-plan.md` §1.1)
- Any database persistence of loci or annotations — requires a migration, and migrations are on the never-touch list
- Real PDF source adapters (Zotero fetch, WebDAV, open-access lookup) — need credentials and network
- Zotero annotation **write-back** — blocked on the §5.3 API spike
- Anything under `apps/web/src/**/ui/**`

## When the queue is finished

Append a short summary to `docs/future-work/overnight-notes.md`: which tasks completed, which were skipped and why, and anything a human should check. Commit it. Do not push.

# Library knowledge loop — phase-wise plan

Follow-up to [`competitive-scan-implementation-plan.md`](competitive-scan-implementation-plan.md).
Covers steal-list items **#8** (Elicit extraction table), **#4** (templated source note),
**#11** (recents), and the Notion relation/rollup idea — plus a redesign of how Zotero
annotations surface in the app.

Branch: `feat/library-knowledge-loop`. One PR for the track; a commit per phase.

## Status

| Phase | Status |
|-------|--------|
| 0 Spec | Done |
| 1 Annotation cards + pins | Done |
| 2 Jump-to recents | Done |
| 3 Custom fields | Done |
| 4 Extraction table | Done |
| 5 Relations + rollups | Done |
| 6 Source-note layout | Done |
| 7 Docs | Done |

Migrations: `0103_annotation_pins`, `0104_paper_fields`, `0105_paper_field_relation_rollup`.

---

## Why this track

The cite/excerpt loop shipped in [PR #29](https://github.com/Satwik-Miyyapuram/thesis_tracker/pull/29)
made highlights usable while writing, but it modelled every highlight as a **vault note** under
`Excerpts/`. That was the fastest path to "excerpts are objects", and it works, but it has costs:

- the vault fills with machine-generated pages nobody edits by hand;
- an annotation's home is a folder tree rather than the paper it came from;
- pin-to-section state hides inside YAML frontmatter, so finding "everything pinned to section X"
  means reading and parsing every vault page.

This track moves annotations back under the paper as first-class cards, then builds the
structured layer on top: custom fields, an extraction table over a reading list, and relations
with rollups.

**No excerpt vault notes exist in the current project**, so there is nothing to migrate — the
old pipeline is simply retired in Phase 1.

---

## Decisions made up front

| Question | Decision | Reason |
|----------|----------|--------|
| Where do annotation → section pins live? | New `annotation_pins` table | Queryable by section; mirrors `citation_alert_tracks` (migration `0102`) rather than scanning every paper's `metadata` |
| Where do custom fields live? | SQL: `paper_field_defs` + `paper_field_values` | Phase 4 sorting/filtering and Phase 5 rollups need real columns; JSON in `paper.metadata` would be rewritten at Phase 5 |
| Are annotation cards editable? | Read-only in v1, labelled as synced from Zotero | No Zotero annotation **write** client exists; `zotero-web-api.ts` covers items/attachments only. Two-way sync is a separate track |
| Delivery | One PR, commit per phase | Phases build on each other; reviewing them together keeps the data model coherent |

---

## Phase 0 — Spec

| Work | Accept |
|------|--------|
| This document | Plan + decisions written down |
| Point `competitive-scan-implementation-plan.md` follow-ups and `BACKLOG.md` at it | No stale "follow-up" entries for #8 / #11 / rollups |

Commit: `docs: plan library knowledge loop`

---

## Phase 1 — Annotations as cards under the paper

Replace the `Excerpts/` vault pipeline with an annotation card list rendered under the paper note.

| # | Work | Entry points | Accept |
|---|------|--------------|--------|
| 1.1 | Migration `0103_annotation_pins.sql`: `(id, project_id, paper_id, annotation_key, report_section_id, created_at)`, unique on `(project_id, paper_id, annotation_key)`, RLS matching `citation_alert_tracks` | `supabase/migrations` | `supabase db push` clean; RLS denies cross-project reads |
| 1.2 | Domain port + repositories (in-memory, postgres, supabase) for annotation pins | mirror `citation-alert-track-repository.ts` and `supabase-citation-alert-track-repository.ts` | Unit tests over the in-memory repo |
| 1.3 | Annotation cards under the paper note: quote, comment, page, colour, tags, with copy quote+cite and a pin-to-section select | `papers-list.tsx` (`PaperAnnotations`), `paper-markdown.tsx` | Cards visible per paper; copy produces `> quote` + `[[Title]]`; pin persists across reload |
| 1.4 | Stop creating vault excerpt notes on sync | `sync-annotation-excerpts.ts`, `sync-zotero-annotations.use-case.ts` | Zotero sync creates no `Excerpts/` pages; annotations still land in `paper.metadata.annotations` |
| 1.5 | Report section pane reads annotations + pins instead of vault frontmatter | `section-related-excerpts.tsx`, `section-note.tsx` | Pinned list matches Phase 1.3 pins; Insert still writes blockquote + wikilink |
| 1.6 | Retire the frontmatter helpers that only existed for excerpt notes; keep `setFrontmatterField` if still used elsewhere | `sync-annotation-excerpts.ts`, its test file | `npx tsc --noEmit -p apps/web` clean; no dead exports |

Commit: `feat(papers): annotations as cards under paper note`

---

## Phase 2 — Jump-to recents

| # | Work | Entry points | Accept |
|---|------|--------------|--------|
| 2.1 | Recent-target ring buffer (last ~15 papers / notes / sections) in `localStorage`, project-scoped | new `lib/recent-targets.ts` | Survives reload; clears with app data reset |
| 2.2 | Record a visit when a paper, vault page or report section is opened | papers / vault / report screens | Opening an item moves it to the front |
| 2.3 | Show recents above results in the palette when the query is empty | `jump-to-palette.tsx` | Cmd/Ctrl+K with no query lists recents first |

Commit: `feat(nav): remember recent jump-to targets`

---

## Phase 3 — Custom fields on papers

| # | Work | Entry points | Accept |
|---|------|--------------|--------|
| 3.1 | Migration `0104_paper_fields.sql`: `paper_field_defs (id, project_id, name, kind, options, sort_order)` and `paper_field_values (id, project_id, paper_id, field_id, value)`, RLS per project | `supabase/migrations` | Push clean; values cascade on paper delete |
| 3.2 | Domain types + ports + three repository implementations; kinds `text`, `number`, `select`, `multi_select` | `packages/core` papers domain, `apps/web/src/backend/providers/postgres`, `features/papers/infrastructure` | Use-case tests for define / rename / set value |
| 3.3 | Facade + container wiring | `container/facades.ts`, `create-app-container.ts` | Fields reachable from UI without direct repo access |
| 3.4 | Field strip on the paper note: show defined fields, edit inline, add/rename/remove definitions from a small manager | `papers-list.tsx` | Setting a value persists; renaming a field does not touch paper rows |

Commit: `feat(papers): project-scoped custom fields`

---

## Phase 4 — Extraction table over a reading list

| # | Work | Entry points | Accept |
|---|------|--------------|--------|
| 4.1 | Tree / Table toggle on a reading list | `lists-screen.tsx`, `list-ui.ts` | Toggle persists per list |
| 4.2 | Table: one row per member paper; columns = title, year, status + each custom field; column picker | new `features/reading-lists/ui/extraction-table.tsx` | Nested list members are flattened into rows |
| 4.3 | Inline cell editing writing Phase 3 values | reuse the fields facade | Edit in table shows on the paper note and vice versa |
| 4.4 | Copy as markdown table / CSV | table toolbar | Clipboard paste into a report section renders a valid markdown table |

Explicitly **manual** — no AI column fill in this track.

Commit: `feat(lists): structured extraction table over a reading list`

---

## Phase 5 — Relations and rollups

| # | Work | Entry points | Accept |
|---|------|--------------|--------|
| 5.1 | `relation` field kind: value is a set of paper ids in the same project | Phase 3 schema (`value` jsonb), field editor | Picker lists project papers; deleting a paper drops it from relations |
| 5.2 | Rollup definitions: `count`, `values`, `sum`/`avg` over a related paper's numeric field | field defs (`kind = 'rollup'`, config in `options`) | Rollup recomputes when the source value changes |
| 5.3 | Render rollups read-only in the table and on the paper note | Phase 3.4 + Phase 4.2 surfaces | Rollup cells are not editable |
| 5.4 | Optional: relation edges feed the graph | `build-graph-data.ts` | Behind a legend toggle; skip if it bloats the phase |

Commit: `feat(papers): relation fields and simple rollups`

---

## Phase 6 — Source-note layout

Steal-list #4, the ZotFlow-style durable source note, now that the parts exist.

| # | Work | Entry points | Accept |
|---|------|--------------|--------|
| 6.1 | Compose the paper view: metadata header (authors, year, venue, DOI, citeKey) → summary editor → fields strip → annotation cards | `papers-list.tsx` `PaperNote` | Consistent order on every paper; sections collapsible |
| 6.2 | Light note scaffold on paper create/import (headings only, no AI text) | paper create path | New paper opens with a usable skeleton |

Commit: `feat(papers): source-note layout on paper view`

---

## Phase 7 — Docs

| # | Work | Accept |
|---|------|--------|
| 7.1 | Extend [`../usage-cite-and-excerpts.md`](../../usage-cite-and-excerpts.md) for annotation cards, fields, extraction table | Guide matches shipped UI |
| 7.2 | Update the competitive scan steal-list status and `BACKLOG.md` | #4 / #8 / #11 / rollups marked shipped |

Commit: `docs: library knowledge loop usage`

---

## Verification per phase

```
npx tsc --noEmit -p apps/web
npm test -w packages/core            # when core changed
npx vitest run <touched test files>  # web-side
```

---

## Out of scope

- **AI fill of extraction columns** — deliberately deferred; the manual table lands first.
- **Two-way Zotero annotation editing** — needs an annotation write client; cards stay read-only.
- **A general Notion-style database builder** — fields, relations and rollups on Papers only.
- **Saved DB views (steal #12)** — board already exists; a full saved-view system is separate.

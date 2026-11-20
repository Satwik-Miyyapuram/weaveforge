# Reading-lists core module

The `reading_lists` module holds the pure rules for reading lists: the nested list
tree, the order of lists and items after a drag, the extraction table, the
screening decisions and the PRISMA counts. It does no database work. The app
loads rows, passes them in, and saves the results it gets back.

## What lives in Rust

Each file under `crates/wf-core/src/reading_lists/` covers one job:

- `mod.rs`: registers the submodules and states that the rules come from the TypeScript domain.
- `reading_list.rs`: the reading-list model, the nested tree, the list colour and list membership.
- `list_order.rs`: flattens a tree to ids, reorders ids after a drag, and steps through the order.
- `subtree_items.rs`: collects the items of a subtree and groups them by list. The fetch stays with the caller.
- `list_row.rs`: maps reading-list rows to and from the table columns.
- `extraction_table.rs`: the extraction table rules, such as cell values, export rows and empty cells.
- `screening.rs`: screening decisions, agreement between reviewers, and PRISMA counts.
- `name_filter.rs`: whether a list name contains a search needle, ignoring case. The decision to filter stays with the caller.
- `extraction_keys.rs`: the extraction-table pending-fill cell key (`paperId::fieldId`) and the relation cell title text, with an unknown id shown as itself.
- `extraction_rows.rs`: which listed papers still exist, de-duplicated in list order, each with its values (`flatten_paper_rows`).
- `list_file.rs`: screening decisions kept in the reading-list file itself (files-first). The `items` field of the list's frontmatter holds one entry per decision, written as one-line JSON (`id`, `item`, `reviewer`, `stage`, `decision`, `reason`, `added`, `missing`). It reads and writes those entries, records and removes a decision, marks entries whose paper left the library as `missing` (never dropping them), and picks the decision that counts per item, reviewer and stage (the latest `added`). A file whose `wf` version is newer than this app is read but never written.

## How the app calls it

The wasm exports live in `crates/wf-wasm/src` (for example `reading_list.rs`,
`reading_lists_order.rs`, `reading_list_rows.rs`, `reading_lists_extraction.rs`
and `screening_records.rs`). The TypeScript wrappers in `packages/wf-wasm/src`
import the raw names from `../pkg/wf_wasm.js` and re-export them. The main names are:

- Tree: `buildListTree`, `deepestFirstListIds`, `listDisplayColor`, `listMembershipByKey`.
- Order: `collectListIds`, `reorderedIds`, `movedIds`, `planItemOrder`, `itemIdsForPapers`, `nextSortOrder`, `isInheritedLinkCode`, `subtreeIds`, `groupSubtreeItems`.
  `itemIdsForPapers` maps a paper order to item ids (refuses the first paper not in the list). `nextSortOrder` gives a new row its position. `isInheritedLinkCode` holds the database codes (23503, 42703, PGRST204) that mean only the inherited link failed.
- Rows: `readingListToDomain`, `readingListToRow`, `readingListItemToDomain`, `readingListItemToRow`.
- Creation: `createReadingListWith`, `verdictsFor`.
- Extraction: `flattenPaperRows` (existing listed papers, in list order, with their values; the TS side maps the index back to the paper), `extractionMarkdown`, `extractionCsv`, `emptyCellPaperIds`, `buildProposeFillPrompt`, `pendingFieldFills`.
- Screening: `verdictFor`, `agreementBetween`, `prismaCounts`.
- Screening in list files (`screening_list_file.rs`): `screeningInListFile`, `effectiveScreening`, `recordInListFile`, `removeFromListFile`, `markMissingInListFile`. Each takes the file text and returns the new text or the decisions; a damaged or newer-format file throws and nothing is written.

Code in `apps/web` reads these through `readyCore()` or `typedCore()` from
`apps/web/src/lib/rust-core.ts`, or through the wrappers in `packages/wf-wasm`.
`readyCore()` throws until `loadCore()` has resolved, so call it only after the
core has loaded.

`apps/web/src/features/reading-lists/infrastructure/file-screening-repository.ts`
is the files-first screening repository. It finds the list file that holds an
item, calls the exports above, and writes the file back with the hash it read,
so a file changed on disk in between is not overwritten. It reaches the files
through a small port (`ListFilesPort`).

## Laws

Each law is a property test in `crates/wf-core/tests/reading_lists_files.rs`,
run on random decisions (reasons with quotes, newlines and U+2028 included).

- **A recorded decision reads back unchanged** (`law_record_reads_back`).
- **Recording one decision changes no other entry**: every other decision in the
  file is still there, unchanged and in order (`law_record_keeps_others`).
- **The latest decision wins**: per item, reviewer and stage, the decision that
  counts is the one with the latest `added` time (`law_latest_added_wins`).
- **A paper leaving the library loses no decision**: marking entries missing
  keeps every decision and only sets or clears `missing`
  (`law_mark_missing_keeps_decisions`).

Named cases in the same file cover an empty list, a file with no version, a
newer-format file (read, never written) and a damaged entry (refused, not
dropped). They also check that a write changes only the `items` block (adding
`wf: 3` when missing): spaced keys, comments, block scalars, nested maps and
CRLF line ends stay byte for byte (`obsidian_properties_survive_every_write`,
`crlf_list_file_stays_crlf`). Times compare as instants, so `10:00:00.500Z`
beats `10:00:00Z` and `10:30:00+01:00` loses to `10:00:00Z`
(`later_instant_wins_across_precision_and_offsets`). In the app, one damaged
list file is skipped when reading, so it never hides the other lists.

## What stays in TypeScript, and why

- **Network I/O.** Rust plans the queries for lists, items and screening
  records (`crates/wf-core/src/repos/reading_lists.rs`,
  `reading_list_items.rs`, `screening_decisions.rs`). The generic runner
  `apps/web/src/backend/providers/postgrest/rust-repository.ts` sends them to
  PostgREST.
- **Model calls.** The request that fills an extraction cell is sent from
  TypeScript. Rust builds the prompt text (`buildProposeFillPrompt`) and reads the
  answers (`pendingFieldFills`).
- **Orchestration.** Loading the subtree, saving a drag and running a screening
  pass stay in TypeScript use cases. Each step calls Rust for the rule.
- **Hooks and UI.** Drag handling, the list sidebar and the screening screen stay
  in `apps/web`.
- **Thin wrappers.** The files in `packages/wf-wasm/src` only forward to the raw
  exports, so they keep no rules of their own.

Source: `crates/wf-core/src/reading_lists/`

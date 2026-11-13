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

Code in `apps/web` reads these through `readyCore()` or `typedCore()` from
`apps/web/src/lib/rust-core.ts`, or through the wrappers in `packages/wf-wasm`.
`readyCore()` throws until `loadCore()` has resolved, so call it only after the
core has loaded.

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

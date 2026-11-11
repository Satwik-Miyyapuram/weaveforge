# Proposal payload core module

The `proposal_payload` module checks and shapes the payloads of AI write proposals
before the browser applies them. It does no I/O. The executors in
`apps/web/src/features/ai-assistant/application/parts.ts` call these
functions and keep the host work.

## What lives in Rust

- Validators and shapers for each proposal kind, such as `proposalPaperNoteAddition`,
  `proposalVaultNote`, `proposalLogEntry`, `proposalPaperUpdate`,
  `proposalPaperFieldId`, `proposalPaperFieldFill`, `proposalReadingListChange`,
  `proposalRelation`, `proposalZoteroImport`, `proposalMilestoneFollowUp`,
  `proposalExperimentFollowUp`, `proposalEditVaultNote`,
  `proposalAppendVaultNoteBody`, `proposalReportNotes`, `proposalMilestoneStatus`,
  `proposalExperimentUpdate` and `proposalPaperAnnotation`.
- `proposalPaperFieldFill(payload, defs)` looks up the field definition from the
  listed defs, so the executor passes the defs in.
- Validation messages match the old TypeScript messages exactly, so existing error
  handling still works.

Source: `crates/wf-core/src/ai/proposal_payload.rs`.

## How the app calls it

The wasm exports are in `crates/wf-wasm`. The wrappers are in
`packages/wf-wasm/src`. The executors call them through `readyCore()`.

## What stays in TypeScript, and why

- **Revision checks (`proposalApplies`).** These read the current record and stay in the
  executor.
- **The ink guard.** `isInkNoteBody` runs before a text edit, so an ink note is never
  overwritten.
- **Use case calls and the executor order.** The writes go through the use cases.
- **The Zotero push** after `addManual`.

## Known risk

The wrapper return types must match the core input types. Until `bindings.ts` is
regenerated, `zotero_import`, `create_log_entry` and the `fill.value` argument to
`setValue` are not checked by the compiler.

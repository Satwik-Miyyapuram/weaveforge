# Proposal draft core module

The `proposal_draft` module shapes a pending AI write proposal before it is saved:
it trims the preview, rejects a blank one and tidies the optional fields. It does no I/O.
The use case `create-ai-proposal-draft.use-case.ts` runs the access policy first, calls
`rust().shapeAiProposalDraft`, then saves.

## What lives in Rust

- Trimming the content, with the JavaScript whitespace set.
- The blank check: `AI proposal preview is required.`
- `sourceLinks` defaults to an empty list; `evidence` is kept only when non-empty.
- Status is always `pending`.

Source: `crates/wf-core/src/ai/proposal_draft.rs`. Wasm: `crates/wf-wasm/src/ai_proposal_draft.rs`
(`shapeAiProposalDraft`). Wrapper: `packages/wf-wasm/src/wrappers-1.ts`.

## What stays in TypeScript

- The policy evaluation, which runs before shaping so a denied draft never reaches Rust.
- The clock (`createdAt`) and the save through the proposal store.

## Known risk

The payload and evidence are untyped JSON (`serde_json::Value`) in Rust, because there is no
Rust `AiEvidence` type yet.

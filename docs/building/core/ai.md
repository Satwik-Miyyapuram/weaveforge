# AI core module

The `ai` module holds the pure rules behind the AI assistant: which AI calls a
user may make, how model output is parsed and checked, how proposals are
previewed and applied, and how the wiki is planned, indexed and linted. It has
no network or database code. The app passes data in and gets data out.

## What lives in Rust

- `access_policy.rs`: decides whether AI access is allowed and normalises the AI access settings.
- `chat_split.rs`: joins a chat's system messages and keeps the rest in order for a BYOK request.
- `ai_tool_name.rs`: canonicalises tool names and derives the context nonce.
- `document_text.rs`: says whether a document has any text beyond whitespace, so blank documents skip extraction.
- `evidence.rs`: splits an excerpt around the span a PDF locus points at.
- `extraction.rs`: parses extraction JSON into a result.
- `folder_draft.rs`: builds the draft for a folder.
- `mcp_result.rs`: turns an MCP tool result into the read result the assistant uses.
- `model_concepts.rs`: parses model-concept extraction output.
- `model_router.rs`: chooses which model handles a request.
- `proposal_apply.rs`: applies a proposal to its target.
- `proposal_preview.rs`: builds the preview a user sees before applying.
- `retrieval.rs`: selects and ranks excerpts for a question.
- `untrusted_context.rs`: neutralises and fences untrusted text before it reaches a model.
- `wiki_index.rs`: builds and replaces the wiki index.
- `wiki_lint.rs`: finds wiki problems and orders the fixes.
- `wiki_merge.rs`: merges wiki pages.
- `wiki_pages.rs`: works on wiki page content.
- `wiki_plan.rs`: plans which wiki pages to write.

## How the app calls it

The wasm exports live in `crates/wf-wasm/src` (for example `ai_access_policy.rs`,
`ai_wiki_plan.rs`, `wiki_merge.rs`, `wiki_lint.rs`, `wiki_index.rs`,
`untrusted_context.rs`). The TypeScript wrappers in `packages/wf-wasm/src`
import the raw names from `../pkg/wf_wasm.js` and re-export them. The main
names are:

- `evaluateAiAccess`, `normalizeAiAccessSettings`, `aiReadCategoryForResource` (access policy).
- `canonicalAiToolName`, `contextNonceFrom` (tool names).
- `mcpReadResult` (MCP results).
- `parseExtractionJson`, `toExtractionResult` (model concepts).
- `highlightWithinExcerpt` (evidence, `ai_evidence.rs`).
- `hasText` (blank-document check, `ai_document_text.rs`).
- `splitAiSystemMessages` (system-prompt split for BYOK requests, `ai_chat_split.rs`).
- `planWikiPages`, `wikiProposalContent` (wiki plan).
- `mergeWikiPages` (wiki merge).
- `lintWiki`, `planFixOrder` (wiki lint).
- `buildWikiIndex`, `replaceWikiIndex` (wiki index).
- `buildWikiGraph` (wiki graph).
- `neutraliseContext`, `safeLabel`, `fenceUntrusted`, `untrustedContextRule` (untrusted context).

Code in `apps/web` reads these through `readyCore()` or `typedCore()` from
`apps/web/src/lib/rust-core.ts`, or through the wrappers in `packages/wf-wasm`.
`readyCore()` throws until `loadCore()` has resolved, so call it only after
the core has loaded. The app must not import these names from `@weaveforge/core`
(the `rust-owned-imports` test enforces this for non-test files). The typed
surface is `CoreContract` in `packages/core/src/shared/core-contract.ts`, which
includes the access policy, evidence, retrieval, MCP result, untrusted context
and wiki merge interfaces. Examples: `readyCore().AiAccessPolicy`,
`readyCore().highlightWithinExcerpt(...)`, `readyCore().retrieveAiExcerpts(...)`,
`typedCore().mergeWikiPages(...)`.

The shared types (`AiEvidence`, `ExcerptHighlight`, `McpResult`, `MergeResult`,
`UNTRUSTED_CONTEXT_RULE` and the rest) live in
`packages/core/src/features/ai-assistant/domain/ai-types.ts`. Import them from
there, or from `@weaveforge/core`, and never from the per-feature files that
are being removed.

## What stays in TypeScript, and why

- **DI facades and use cases.** `packages/core/src/features/ai-assistant/application/append-paper-note.use-case.ts`
  wires ports together and keeps the retry loop (`MAX_ATTEMPTS=3`). It calls
  `rust().proposalApplies` for the rule check. The rule lives in Rust; the
  orchestration stays in TypeScript.
- **Model calls and network I/O.** Sending prompts to a provider, reading the
  response stream and calling MCP servers stay in TypeScript. Rust only checks
  and shapes the data.
- **Hooks and UI.** React state, hooks and components stay in `apps/web`.
- **Type contracts.** The TypeScript types that describe the wasm inputs and
  outputs stay in TypeScript, because they are the boundary the app
  type-checks against. They now sit in `ai-types.ts` (data types and the
  `UNTRUSTED_CONTEXT_RULE` const) and `core-contract.ts` (the `*Fns` interfaces
  that `CoreContract` extends). The wf-wasm wrappers keep only the runtime
  forwarding.
- **Proposal grouping.** `apps/web/src/features/ai-assistant/application/proposal-groups.ts`
  is UI-side grouping and bulk-run logic. It stays in TypeScript for now.
- **Thin wrappers.** `packages/wf-wasm/src/proposal-apply.ts` only forwards to
  the raw `proposalApplies` export. It keeps no logic of its own.

## Related

- [Dashboard core](dashboard.md)
- [Plan core](plan.md)
- [Logbook core](logbook.md)
- [Settings core](settings.md)

Source: `crates/wf-core/src/ai/`

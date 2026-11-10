export {
  planWikiPages,
  wikiProposalContent,
} from "../pkg/wf_wasm.js";
/**
 * Wiki page planning (Rust `ai::wiki_plan`), re-exported from index.ts.
 * Keeps the signatures of packages/core/src/features/ai-assistant/application/plan-wiki-pages.use-case.ts.
 * `titles` replaces the TypeScript `titleOf` callback: the caller resolves each document id first.
 */


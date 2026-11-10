/**
 * Wiki page planning (Rust `ai::wiki_plan`), re-exported from index.ts.
 * Keeps the signatures of packages/core/src/features/ai-assistant/application/plan-wiki-pages.use-case.ts.
 * `titles` replaces the TypeScript `titleOf` callback: the caller resolves each document id first.
 */
import {
  planWikiPages as rawPlanWikiPages,
  wikiProposalContent as rawWikiProposalContent,
} from "../pkg/wf_wasm.js";
import type { PlanWikiPagesInput, WikiPagePlan } from "./bindings.js";

/** The review card's text for a planned page: bold title, `Why:` line, then the drafted body. */
export function wikiProposalContent(plan: WikiPagePlan): string {
  return rawWikiProposalContent(plan) as string;
}

/** The pages worth creating, idempotent against `existingTitles`. */
export function planWikiPages(input: PlanWikiPagesInput): WikiPagePlan[] {
  return rawPlanWikiPages(input) as WikiPagePlan[];
}

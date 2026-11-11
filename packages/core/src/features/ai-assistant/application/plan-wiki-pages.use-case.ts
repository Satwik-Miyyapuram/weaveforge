/**
 * Turn extracted concepts into wiki-page proposals.
 *
 * Pages are ordinary vault notes, created through the existing
 * `create_vault_note` proposal kind. That is not a shortcut — it is what makes
 * a generated page a first-class citizen: it joins the graph, search,
 * backlinks, and `[[…]]` autocomplete with no new code, and it goes through the
 * same human review as anything else the assistant writes.
 */

import { type ExtractionResult } from "../domain/ai-extraction.js";
import { rust } from "../../../shared/rust.js";

export interface WikiPagePlan {
  title: string;
  body: string;
  /** Documents the concept was found in, for the review queue's evidence. */
  sourceDocumentIds: string[];
  mentions: number;
}

export interface PlanWikiPagesInput {
  extraction: ExtractionResult;
  /** Titles already in the wiki; these are never proposed again. */
  existingTitles: readonly string[];
  /** Concepts below this many mentions are not worth a page of their own. */
  minMentions?: number;
  maxPages?: number;
  /** Resolve a document id to a title, for the page's mention list. */
  titleOf?(documentId: string): string | undefined;
}

/**
 * The review card's text for a planned page: a bold title the card shows as
 * its heading, a `Why:` line, then the drafted page itself (E26). Generic
 * "Create note" said nothing about which page or why.
 */
export function wikiProposalContent(plan: WikiPagePlan): string {
  return rust().wikiProposalContent(plan);
}

/**
 * Plan the pages worth creating.
 *
 * Idempotent against `existingTitles`: running twice over an unchanged
 * workspace proposes nothing the second time, which is what stops the review
 * queue filling with duplicates.
 */
export function planWikiPages(input: PlanWikiPagesInput): WikiPagePlan[] {
  // `titleOf` is resolved here, once per mentioned document, because the Rust core takes data, not callbacks.
  const titles: Record<string, string> = {};
  for (const mention of input.extraction.mentions) {
    if (mention.documentId in titles) continue;
    const title = input.titleOf?.(mention.documentId);
    if (title !== undefined) titles[mention.documentId] = title;
  }
  return rust().planWikiPages({
    extraction: input.extraction as never,
    existingTitles: [...input.existingTitles],
    minMentions: input.minMentions,
    maxPages: input.maxPages,
    titles,
  }) as WikiPagePlan[];
}

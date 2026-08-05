/**
 * Turn extracted concepts into wiki-page proposals.
 *
 * Pages are ordinary vault notes, created through the existing
 * `create_vault_note` proposal kind. That is not a shortcut — it is what makes
 * a generated page a first-class citizen: it joins the graph, search,
 * backlinks, and `[[…]]` autocomplete with no new code, and it goes through the
 * same human review as anything else the assistant writes.
 */

import {
  conceptKey,
  withoutExisting,
  type ExtractedConcept,
  type ExtractionResult,
} from "../domain/ai-extraction.js";

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

const DEFAULT_MIN_MENTIONS = 2;
const DEFAULT_MAX_PAGES = 25;

function renderPage(
  concept: ExtractedConcept,
  sources: { id: string; title: string; evidence: string }[],
): string {
  const lines: string[] = [];

  lines.push(`> Drafted from ${sources.length} source${sources.length === 1 ? "" : "s"}. Edit freely — this is an ordinary note.`);
  lines.push("");

  if (concept.aliases.length) {
    lines.push(`**Also known as:** ${concept.aliases.join(", ")}`);
    lines.push("");
  }

  lines.push("## Summary");
  lines.push("");
  // Deliberately blank: inventing a definition is exactly the kind of
  // confident wrongness that makes generated wikis untrustworthy. The
  // structure and the links are the value; the prose is the user's.
  lines.push("_Not written yet._");
  lines.push("");

  lines.push("## Mentioned in");
  lines.push("");
  for (const source of sources) {
    lines.push(`- [[${source.title}]]`);
    if (source.evidence) lines.push(`  - ${source.evidence}`);
  }
  lines.push("");

  lines.push(`#${concept.kind}`);

  return lines.join("\n");
}

/**
 * Plan the pages worth creating.
 *
 * Idempotent against `existingTitles`: running twice over an unchanged
 * workspace proposes nothing the second time, which is what stops the review
 * queue filling with duplicates.
 */
export function planWikiPages(input: PlanWikiPagesInput): WikiPagePlan[] {
  const minMentions = input.minMentions ?? DEFAULT_MIN_MENTIONS;
  const maxPages = input.maxPages ?? DEFAULT_MAX_PAGES;

  const fresh = withoutExisting(input.extraction, input.existingTitles);

  const mentionsByConcept = new Map<string, { id: string; title: string; evidence: string }[]>();
  for (const mention of fresh.mentions) {
    const key = conceptKey(mention.conceptName);
    const list = mentionsByConcept.get(key) ?? [];
    list.push({
      id: mention.documentId,
      title: input.titleOf?.(mention.documentId) ?? mention.documentId,
      evidence: mention.evidence,
    });
    mentionsByConcept.set(key, list);
  }

  return fresh.concepts
    .filter((concept) => concept.mentions >= minMentions)
    .slice(0, maxPages)
    .map((concept) => {
      const sources = mentionsByConcept.get(conceptKey(concept.name)) ?? [];
      return {
        title: concept.name,
        body: renderPage(concept, sources),
        sourceDocumentIds: [...new Set(sources.map((source) => source.id))],
        mentions: concept.mentions,
      };
    });
}

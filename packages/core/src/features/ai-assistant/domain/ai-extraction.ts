/**
 * Concept extraction: finding the entities and ideas a workspace is about, so
 * they can become linked wiki pages.
 *
 * The seam is here rather than at `IModelConversation` on purpose. MCP inverts
 * control — an external client calls *us*, so there is no `complete()` to
 * invoke — and forcing both it and a direct API call behind one request/response
 * interface produces an adapter that has to lie about what it can do. Extraction
 * is the honest boundary: it can be satisfied synchronously by a model, or
 * asynchronously by a reviewed proposal, or with no model at all.
 */

export interface ExtractionDocument {
  id: string;
  title: string;
  text: string;
}

export interface ExtractionRequest {
  documents: readonly ExtractionDocument[];
  /**
   * Concepts already in the wiki. Passing them prevents drift — without it an
   * extractor will happily coin "Variational Auto-Encoder" next to an existing
   * "Variational Autoencoder" and split the graph in two.
   */
  existingConcepts?: readonly string[];
  maxConcepts?: number;
}

export type ConceptKind = "concept" | "method" | "dataset" | "metric" | "person" | "venue";

export const CONCEPT_KINDS: readonly ConceptKind[] = [
  "concept",
  "method",
  "dataset",
  "metric",
  "person",
  "venue",
];

export interface ExtractedConcept {
  name: string;
  aliases: readonly string[];
  kind: ConceptKind;
  /** How many documents mention it; drives which concepts are worth a page. */
  mentions: number;
}

export interface ExtractedMention {
  documentId: string;
  conceptName: string;
  /** Verbatim text the concept was found in, for the review queue. */
  evidence: string;
}

export interface ExtractionResult {
  concepts: readonly ExtractedConcept[];
  mentions: readonly ExtractedMention[];
  /**
   * True when the work was handed to something that answers later — the MCP
   * path. Callers must not treat an empty result as "nothing found".
   */
  pending?: boolean;
}

export interface IConceptExtractor {
  readonly id: string;
  extract(request: ExtractionRequest): Promise<ExtractionResult>;
}

export const EMPTY_EXTRACTION: ExtractionResult = { concepts: [], mentions: [] };

/** Normalized key for comparing concept names across casing and spacing. */
export function conceptKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Merge results, summing mention counts and unioning aliases.
 *
 * Used to fold a batch of per-document extractions into one view, and to
 * reconcile a new run against what a previous one found.
 */
export function mergeExtractions(
  results: readonly ExtractionResult[],
): ExtractionResult {
  const concepts = new Map<string, ExtractedConcept>();
  const mentions: ExtractedMention[] = [];
  const seenMentions = new Set<string>();
  let pending = false;

  for (const result of results) {
    if (result.pending) pending = true;

    for (const concept of result.concepts) {
      const key = conceptKey(concept.name);
      const existing = concepts.get(key);
      if (!existing) {
        concepts.set(key, { ...concept, aliases: [...concept.aliases] });
        continue;
      }
      concepts.set(key, {
        ...existing,
        mentions: existing.mentions + concept.mentions,
        aliases: [...new Set([...existing.aliases, ...concept.aliases])],
      });
    }

    for (const mention of result.mentions) {
      const key = `${mention.documentId}|${conceptKey(mention.conceptName)}`;
      if (seenMentions.has(key)) continue;
      seenMentions.add(key);
      mentions.push(mention);
    }
  }

  return {
    concepts: [...concepts.values()].sort((a, b) => b.mentions - a.mentions || a.name.localeCompare(b.name)),
    mentions,
    ...(pending ? { pending: true } : {}),
  };
}

/**
 * Drop concepts that already exist in the wiki, so a second run does not
 * propose pages for everything it proposed the first time.
 */
export function withoutExisting(
  result: ExtractionResult,
  existing: readonly string[],
): ExtractionResult {
  const known = new Set(existing.map(conceptKey));
  const concepts = result.concepts.filter((concept) => {
    if (known.has(conceptKey(concept.name))) return false;
    // An alias colliding with an existing page is the same concept under
    // another name; proposing it would create the duplicate we are avoiding.
    return !concept.aliases.some((alias) => known.has(conceptKey(alias)));
  });
  const kept = new Set(concepts.map((concept) => conceptKey(concept.name)));

  return {
    ...result,
    concepts,
    mentions: result.mentions.filter((mention) => kept.has(conceptKey(mention.conceptName))),
  };
}

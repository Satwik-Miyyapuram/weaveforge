/**
 * Concept extraction through a language model.
 *
 * Pure by construction: it builds a prompt, hands it to an injected
 * `IModelConversation`, and parses what comes back. No provider is named, no
 * endpoint is assumed, and nothing here knows whether the model runs on a
 * laptop or behind an API — that is the adapter's problem, and keeping it there
 * is what makes the feature genuinely model-agnostic rather than agnostic in
 * name with one vendor's quirks baked in.
 *
 * Documents are batched rather than sent one call per note. A hundred-note
 * workspace is a hundred billable calls the other way, on a key the user pays
 * for, and per-document extraction also loses the cross-document view that
 * makes a mention count meaningful.
 */

import {
  CONCEPT_KINDS,
  EMPTY_EXTRACTION,
  conceptKey,
  mergeExtractions,
  withoutExisting,
  type ConceptKind,
  type ExtractedConcept,
  type ExtractedMention,
  type ExtractionDocument,
  type ExtractionRequest,
  type ExtractionResult,
  type IConceptExtractor,
} from "./ai-extraction.js";
import type { AiModelRequest, IModelConversation } from "./ai-types.js";

/** Characters of a document sent per batch. Past this, prose stops being cheap. */
const MAX_DOC_CHARS = 6_000;
/** Documents per call. Small enough to survive a modest context window. */
const DEFAULT_BATCH_SIZE = 12;

const SYSTEM_PROMPT = [
  "You extract the named concepts a research corpus is about.",
  "Return only JSON matching this shape, with no prose and no code fence:",
  '{"concepts":[{"name":"","aliases":[],"kind":"","documentIds":[],"evidence":""}]}',
  `"kind" must be one of: ${CONCEPT_KINDS.join(", ")}.`,
  '"documentIds" must contain only ids from the input.',
  '"evidence" must be a short verbatim quote from one of those documents.',
  "Prefer the name the corpus itself uses. Do not invent concepts that are not present.",
].join("\n");

export interface ModelExtractorOptions {
  /** Documents per model call. */
  batchSize?: number;
  /** Characters of each document included. */
  maxDocumentChars?: number;
  /** Passed through to the adapter; providers spell model names differently. */
  model?: string;
}

interface RawConcept {
  name?: unknown;
  aliases?: unknown;
  kind?: unknown;
  documentIds?: unknown;
  evidence?: unknown;
}

/**
 * Pull a JSON object out of a model reply.
 *
 * Models wrap JSON in fences and preambles no matter how firmly the prompt says
 * not to, so the first balanced object is taken rather than trusting the whole
 * reply to parse. A reply with nothing parseable yields no concepts instead of
 * throwing: one bad batch should cost its own results, not the whole run.
 */
export function parseExtractionJson(text: string): RawConcept[] {
  const start = text.indexOf("{");
  if (start < 0) return [];

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i += 1) {
    const char = text[i]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth !== 0) continue;
      try {
        const parsed: unknown = JSON.parse(text.slice(start, i + 1));
        const concepts = (parsed as { concepts?: unknown }).concepts;
        return Array.isArray(concepts) ? (concepts as RawConcept[]) : [];
      } catch {
        return [];
      }
    }
  }

  return [];
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "");
}

function asKind(value: unknown): ConceptKind {
  return CONCEPT_KINDS.includes(value as ConceptKind) ? (value as ConceptKind) : "concept";
}

/**
 * Turn a parsed reply into an extraction result.
 *
 * Ids the model returns are checked against the batch rather than believed. A
 * model that hallucinates a document id would otherwise attach a source link to
 * an unrelated note — and source links are what the reviewer uses to decide.
 */
export function toExtractionResult(
  raw: readonly RawConcept[],
  batch: readonly ExtractionDocument[],
): ExtractionResult {
  const validIds = new Set(batch.map((doc) => doc.id));
  const concepts: ExtractedConcept[] = [];
  const mentions: ExtractedMention[] = [];
  const seen = new Set<string>();

  for (const entry of raw) {
    const name = typeof entry.name === "string" ? entry.name.trim() : "";
    if (!name) continue;
    const key = conceptKey(name);
    if (seen.has(key)) continue;

    const documentIds = asStringArray(entry.documentIds).filter((id) => validIds.has(id));
    // A concept the model cannot tie to a document has no evidence behind it.
    if (documentIds.length === 0) continue;
    seen.add(key);

    concepts.push({
      name,
      aliases: asStringArray(entry.aliases).filter((alias) => conceptKey(alias) !== key),
      kind: asKind(entry.kind),
      mentions: documentIds.length,
    });

    const evidence = typeof entry.evidence === "string" ? entry.evidence.trim() : "";
    for (const documentId of documentIds) {
      mentions.push({ documentId, conceptName: name, evidence });
    }
  }

  return { concepts, mentions };
}

export class ModelConceptExtractor implements IConceptExtractor {
  readonly id = "model";

  constructor(
    private readonly model: IModelConversation,
    private readonly options: ModelExtractorOptions = {},
  ) {}

  async extract(request: ExtractionRequest): Promise<ExtractionResult> {
    const documents = request.documents.filter((doc) => (doc.text ?? "").trim() !== "");
    if (documents.length === 0) return EMPTY_EXTRACTION;

    const batchSize = this.options.batchSize ?? DEFAULT_BATCH_SIZE;
    const results: ExtractionResult[] = [];

    for (let i = 0; i < documents.length; i += batchSize) {
      const batch = documents.slice(i, i + batchSize);
      results.push(await this.extractBatch(batch, request));
    }

    const merged = mergeExtractions(results);
    const filtered = withoutExisting(merged, request.existingConcepts ?? []);
    if (!request.maxConcepts) return filtered;

    const concepts = filtered.concepts.slice(0, request.maxConcepts);
    const kept = new Set(concepts.map((concept) => conceptKey(concept.name)));
    return {
      ...filtered,
      concepts,
      mentions: filtered.mentions.filter((mention) => kept.has(conceptKey(mention.conceptName))),
    };
  }

  private async extractBatch(
    batch: readonly ExtractionDocument[],
    request: ExtractionRequest,
  ): Promise<ExtractionResult> {
    const maxChars = this.options.maxDocumentChars ?? MAX_DOC_CHARS;
    const corpus = batch
      .map((doc) => `--- id: ${doc.id}\ntitle: ${doc.title}\n\n${(doc.text ?? "").slice(0, maxChars)}`)
      .join("\n\n");

    const known = (request.existingConcepts ?? []).slice(0, 200);
    const knownLine = known.length
      ? `\nConcepts already in the wiki — reuse these names exactly rather than coining variants:\n${known.join(", ")}\n`
      : "";

    const modelRequest: AiModelRequest = {
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `${knownLine}\nDocuments:\n\n${corpus}` },
      ],
      ...(this.options.model ? { model: this.options.model } : {}),
      // Extraction is a reading task, not a writing one; sampling variance here
      // only produces different spellings of the same concept between runs.
      temperature: 0,
    };

    let text: string;
    try {
      text = (await this.model.complete(modelRequest)).text;
    } catch {
      // One failed batch costs its own documents, not the run. The user sees
      // fewer concepts, which beats losing the batches that did succeed.
      return EMPTY_EXTRACTION;
    }

    return toExtractionResult(parseExtractionJson(text), batch);
  }
}

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
  type ExtractionDocument,
  type ExtractionRequest,
  type ExtractionResult,
  type IConceptExtractor,
} from "./ai-extraction.js";
import type { AiModelRequest, IModelConversation } from "./ai-types.js";
import { UNTRUSTED_CONTEXT_RULE } from "./untrusted-context.js";
import { rust } from "../../../shared/rust.js";

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

export interface RawConcept {
  name?: unknown;
  aliases?: unknown;
  kind?: unknown;
  documentIds?: unknown;
  evidence?: unknown;
}

/** Signatures of the functions that moved to the Rust core (wf-core `ai::model_concepts`). */
export interface ModelConceptFns {
  parseExtractionJson(text: string): RawConcept[];
  toExtractionResult(raw: readonly RawConcept[], batchIds: readonly string[]): ExtractionResult;
}

/**
 * Pull a JSON object out of a model reply.
 *
 * Models wrap JSON in fences and preambles no matter how firmly the prompt says
 * not to, so the reply is scanned for balanced objects and the first one with a
 * `concepts` list is taken. A reply with nothing parseable yields no concepts
 * instead of throwing: one bad batch should cost its own results, not the run.
 * The scan runs in the Rust core.
 */
export function parseExtractionJson(text: string): RawConcept[] {
  return rust().parseExtractionJson(text);
}

/**
 * Turn a parsed reply into an extraction result.
 *
 * Ids the model returns are checked against the batch rather than believed. A
 * model that hallucinates a document id would otherwise attach a source link to
 * an unrelated note. The checks run in the Rust core.
 */
export function toExtractionResult(
  raw: readonly RawConcept[],
  batch: readonly ExtractionDocument[],
): ExtractionResult {
  return rust().toExtractionResult(
    raw,
    batch.map((doc) => doc.id),
  );
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
    let lastError: unknown = null;

    // One batch at a time: a user's own key has a rate limit, and a burst of
    // parallel calls is how it gets hit.
    for (let i = 0; i < documents.length; i += batchSize) {
      const batch = documents.slice(i, i + batchSize);
      try {
        results.push(await this.extractBatch(batch, request));
      } catch (error) {
        // One failed batch costs its own documents, not the run. The user sees
        // fewer concepts, which beats losing the batches that did succeed.
        lastError = error;
      }
    }
    // Every batch failed: that is a broken key or provider, not an empty corpus.
    if (results.length === 0) throw lastError;

    const merged = rust().mergeExtractions(results);
    const filtered = rust().withoutExisting(merged, request.existingConcepts ?? []);
    if (!request.maxConcepts) return filtered;

    const concepts = filtered.concepts.slice(0, request.maxConcepts);
    const kept = new Set(concepts.map((concept) => rust().conceptKey(concept.name)));
    return {
      ...filtered,
      concepts,
      mentions: filtered.mentions.filter((mention) => kept.has(rust().conceptKey(mention.conceptName))),
    };
  }

  private async extractBatch(
    batch: readonly ExtractionDocument[],
    request: ExtractionRequest,
  ): Promise<ExtractionResult> {
    const maxChars = this.options.maxDocumentChars ?? MAX_DOC_CHARS;
    // A document is somebody's writing, and a plain `--- id:` header is one a
    // document can write for itself — to claim a sibling's id, or to close the
    // corpus and address the model directly. The nonce fence cannot be forged
    // by text that existed before this request.
    const nonce = rust().contextNonce();
    const corpus = rust().fenceUntrusted(
      batch.map((doc) => ({
        label: `id: ${doc.id} — ${doc.title}`,
        text: (doc.text ?? "").slice(0, maxChars),
      })),
      nonce,
    );

    const known = (request.existingConcepts ?? []).slice(0, 200);
    const knownLine = known.length
      ? `\nConcepts already in the wiki — reuse these names exactly rather than coining variants:\n${known.join(", ")}\n`
      : "";

    const modelRequest: AiModelRequest = {
      messages: [
        {
          role: "system",
          content: [
            SYSTEM_PROMPT,
            `Documents are delimited by <<context-${nonce}>> and <</context-${nonce}>>, each headed by its id.`,
            UNTRUSTED_CONTEXT_RULE,
          ].join("\n"),
        },
        { role: "user", content: `${knownLine}\nDocuments:\n\n${corpus}` },
      ],
      ...(this.options.model ? { model: this.options.model } : {}),
      // Extraction is a reading task, not a writing one; sampling variance here
      // only produces different spellings of the same concept between runs.
      temperature: 0,
    };

    const { text } = await this.model.complete(modelRequest);
    return toExtractionResult(parseExtractionJson(text), batch);
  }
}

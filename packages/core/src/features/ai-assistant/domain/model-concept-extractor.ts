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
 *
 * The prompt, the batching limits, the request shape and the merge/cap are in
 * the Rust core (wf-core `ai::model_extraction`). This class keeps the batch loop
 * and the model call, which are host work.
 */

import {
  EMPTY_EXTRACTION,
  type ExtractionDocument,
  type ExtractionRequest,
  type ExtractionResult,
  type IConceptExtractor,
} from "./ai-extraction.js";
import type { IModelConversation } from "./ai-types.js";
import { rust } from "../../../shared/rust.js";

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
    const documents = request.documents.filter((doc) => rust().hasText(doc.text));
    if (documents.length === 0) return EMPTY_EXTRACTION;

    const limits = rust().modelExtractionLimits();
    const batchSize = this.options.batchSize ?? limits.batchSize;
    const results: ExtractionResult[] = [];
    let lastError: unknown = null;

    // One batch at a time: a user's own key has a rate limit, and a burst of
    // parallel calls is how it gets hit.
    for (let i = 0; i < documents.length; i += batchSize) {
      const batch = documents.slice(i, i + batchSize);
      try {
        results.push(await this.extractBatch(batch, request, limits.maxDocumentChars));
      } catch (error) {
        // One failed batch costs its own documents, not the run. The user sees
        // fewer concepts, which beats losing the batches that did succeed.
        lastError = error;
      }
    }
    // Every batch failed: that is a broken key or provider, not an empty corpus.
    if (results.length === 0) throw lastError;

    return rust().modelFinalizeExtraction(
      results as never,
      request.existingConcepts ?? [],
      request.maxConcepts,
    ) as ExtractionResult;
  }

  private async extractBatch(
    batch: readonly ExtractionDocument[],
    request: ExtractionRequest,
    defaultMaxChars: number,
  ): Promise<ExtractionResult> {
    // A document is somebody's writing, and a plain `--- id:` header is one a
    // document can write for itself — to claim a sibling's id, or to close the
    // corpus and address the model directly. The nonce fence cannot be forged
    // by text that existed before this request.
    const nonce = rust().contextNonce();
    const modelRequest = rust().modelBuildBatchRequest(
      batch.map((doc) => ({
        id: doc.id,
        title: doc.title,
        ...(doc.text === undefined ? {} : { text: doc.text }),
      })),
      request.existingConcepts ?? [],
      this.options.model,
      this.options.maxDocumentChars ?? defaultMaxChars,
      nonce,
    );

    const { text } = await this.model.complete(modelRequest);
    return toExtractionResult(rust().parseExtractionJson(text), batch);
  }
}

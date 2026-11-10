/**
 * Concept extraction with no model at all.
 *
 * The harvesting, merging and ranking live in the Rust core (wf-core
 * `ai::lexical_concepts`). This class is the host shim: it hands the documents
 * over and returns what comes back.
 */
import {
  type ExtractionRequest,
  type ExtractionResult,
  type IConceptExtractor,
} from "./ai-extraction.js";
import { rust } from "../../../shared/rust.js";

export class LexicalConceptExtractor implements IConceptExtractor {
  readonly id = "lexical";

  async extract(request: ExtractionRequest): Promise<ExtractionResult> {
    // Absent optional fields are left out rather than sent as undefined, which would reach wasm as null.
    return rust().extractLexical({
      documents: request.documents.map((doc) => ({
        id: doc.id,
        ...(doc.text === undefined ? {} : { text: doc.text }),
      })),
      ...(request.maxConcepts === undefined ? {} : { maxConcepts: request.maxConcepts }),
    });
  }
}

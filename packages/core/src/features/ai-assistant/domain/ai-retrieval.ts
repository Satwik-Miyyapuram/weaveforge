import type { AiSourceLink } from "./ai-types.js";
import { rust } from "../../../shared/rust.js";

export interface AiRetrievalDocument {
  source: AiSourceLink;
  /** Already-decrypted, explicitly granted text. Never persist this value. */
  text: string;
}

export interface AiRetrievedExcerpt {
  source: AiSourceLink;
  passageId: string;
  text: string;
  score: number;
}

/** Signatures of the function that moved to the Rust core (wf-wasm, crates/wf-core/src/ai/retrieval.rs). */
export interface AiRetrievalFns {
  retrieveAiExcerpts(
    documents: readonly AiRetrievalDocument[],
    query: string,
    options: { limit?: number; maxChars?: number },
  ): readonly AiRetrievedExcerpt[];
}

/**
 * Small deterministic lexical retriever for the unlocked browser. It has no
 * storage, network, or model dependency, keeping selected plaintext local.
 * Scoring and windowing run in the Rust core.
 */
export function retrieveAiExcerpts(
  documents: readonly AiRetrievalDocument[],
  query: string,
  options: { limit?: number; maxChars?: number } = {},
): readonly AiRetrievedExcerpt[] {
  return rust().retrieveAiExcerpts(documents, query, options);
}

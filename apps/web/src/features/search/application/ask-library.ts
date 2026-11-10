/**
 * Ask your library: hybrid search finds the passages, the user's own model
 * answers from them alone and cites them as [n]. The passages are the user's
 * documents, so they go to the model fenced as untrusted data.
 */
import { type AiModelRequest, type IModelConversation, type SearchHit } from "@weaveforge/core";
import { readyCore, typedCore } from "@/lib/rust-core";

export interface CitedSource {
  n: number;
  hit: SearchHit;
}

export interface AskResult {
  answer: string;
  /** The sources the answer cites, by their [n], in the order it first cites them. */
  sources: CitedSource[];
}

/** The system and user turns (prompt text and source fencing are Rust `search::ask_library`). */
export function buildAskRequest(question: string, hits: readonly SearchHit[], nonce: string): AiModelRequest {
  const { system, user } = readyCore().askPrompt(
    question,
    hits.map((hit) => ({ title: hit.title, page: hit.page ?? null, excerpt: hit.excerpt?.text ?? null })),
    nonce,
  );
  return {
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.2,
  };
}

/** The hits named by [n] or [n, m] markers, first citation order, each once. */
export function citedSources(answer: string, hits: readonly SearchHit[]): CitedSource[] {
  return readyCore()
    .citedSourceNumbers(answer, hits.length)
    .map((n) => ({ n, hit: hits[n - 1]! }));
}

export async function askLibrary(input: {
  question: string;
  search: (query: string) => Promise<readonly SearchHit[]>;
  model: IModelConversation;
  nonce?: string;
}): Promise<AskResult> {
  const hits = await input.search(input.question);
  if (hits.length === 0) return { answer: "Nothing in your library matches that question.", sources: [] };
  const { text } = await input.model.complete(buildAskRequest(input.question, hits, input.nonce ?? typedCore().contextNonce()));
  return { answer: text, sources: citedSources(text, hits) };
}

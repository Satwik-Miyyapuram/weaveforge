/**
 * Ask your library: hybrid search finds the passages, the user's own model
 * answers from them alone and cites them as [n]. The passages are the user's
 * documents, so they go to the model fenced as untrusted data.
 */
import {
  contextNonce,
  type AiModelRequest,
  type IModelConversation,
  type SearchHit,
} from "@weaveforge/core";
import { readyCore } from "@/lib/rust-core";

export interface CitedSource {
  n: number;
  hit: SearchHit;
}

export interface AskResult {
  answer: string;
  /** The sources the answer cites, by their [n], in the order it first cites them. */
  sources: CitedSource[];
}

const SYSTEM_PROMPT = [
  "You answer questions about the user's research library.",
  "Use only the numbered sources supplied. If they do not answer the question, say so.",
  "Cite every claim with its source number in square brackets, like [1] or [2].",
  "Be brief.",
].join(" ");

/** The source's heading line and passage; its number is the fence label. */
function sourceText(hit: SearchHit): string {
  const heading = `${hit.title}${hit.page != null ? ` (p. ${hit.page})` : ""}`;
  return hit.excerpt?.text ? `${heading}\n${hit.excerpt.text}` : heading;
}

export function buildAskRequest(question: string, hits: readonly SearchHit[], nonce: string): AiModelRequest {
  const sources = readyCore().fenceUntrusted(
    hits.map((hit, i) => ({ label: String(i + 1), text: sourceText(hit) })),
    nonce,
  );
  return {
    messages: [
      {
        role: "system",
        content: [
          SYSTEM_PROMPT,
          `Sources are delimited by <<context-${nonce}>> and <</context-${nonce}>>, each headed by its number.`,
          readyCore().untrustedContextRule(),
        ].join("\n"),
      },
      { role: "user", content: `${sources}\n\nQuestion: ${question}` },
    ],
    temperature: 0.2,
  };
}

/** The hits named by [n] or [n, m] markers, first citation order, each once. */
export function citedSources(answer: string, hits: readonly SearchHit[]): CitedSource[] {
  const seen = new Set<number>();
  const out: CitedSource[] = [];
  for (const match of answer.matchAll(/\[(\d+(?:\s*,\s*\d+)*)\]/g)) {
    for (const part of match[1]!.split(",")) {
      const n = Number(part.trim());
      const hit = hits[n - 1];
      if (n < 1 || !hit || seen.has(n)) continue;
      seen.add(n);
      out.push({ n, hit });
    }
  }
  return out;
}

export async function askLibrary(input: {
  question: string;
  search: (query: string) => Promise<readonly SearchHit[]>;
  model: IModelConversation;
  nonce?: string;
}): Promise<AskResult> {
  const hits = await input.search(input.question);
  if (hits.length === 0) return { answer: "Nothing in your library matches that question.", sources: [] };
  const { text } = await input.model.complete(buildAskRequest(input.question, hits, input.nonce ?? contextNonce()));
  return { answer: text, sources: citedSources(text, hits) };
}

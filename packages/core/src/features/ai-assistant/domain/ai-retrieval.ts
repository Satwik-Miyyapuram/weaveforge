import type { AiSourceLink } from "./ai-types.js";

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

/**
 * Small deterministic lexical retriever for the unlocked browser. It has no
 * storage, network, or model dependency, keeping selected plaintext local.
 */
export function retrieveAiExcerpts(
  documents: readonly AiRetrievalDocument[],
  query: string,
  options: { limit?: number; maxChars?: number } = {},
): readonly AiRetrievedExcerpt[] {
  const terms = tokenize(query);
  if (terms.length === 0) return [];
  const limit = Math.max(1, Math.min(options.limit ?? 8, 20));
  const maxChars = Math.max(120, Math.min(options.maxChars ?? 900, 2_000));
  return documents
    .map((document) => {
      const text = document.text.replace(/\s+/g, " ").trim();
      const score = scoreText(text, terms);
      return {
        source: document.source,
        passageId: `${document.source.sourceId}:0`,
        text: excerptAroundFirstMatch(text, terms, maxChars),
        score,
      };
    })
    .filter((result) => result.score > 0 && result.text.length > 0)
    .sort((a, b) => b.score - a.score || a.source.label.localeCompare(b.source.label))
    .slice(0, limit);
}

function tokenize(value: string): readonly string[] {
  return [...new Set(value.toLocaleLowerCase().match(/[\p{L}\p{N}_-]{2,}/gu) ?? [])];
}

function scoreText(text: string, terms: readonly string[]): number {
  const lower = text.toLocaleLowerCase();
  return terms.reduce((score, term) => {
    const matches = lower.match(new RegExp(escapeRegExp(term), "gu"))?.length ?? 0;
    return score + Math.min(matches, 6);
  }, 0);
}

function excerptAroundFirstMatch(text: string, terms: readonly string[], maxChars: number): string {
  if (text.length <= maxChars) return text;
  const lower = text.toLocaleLowerCase();
  const first = Math.min(...terms.map((term) => lower.indexOf(term)).filter((index) => index >= 0));
  const start = Number.isFinite(first) ? Math.max(0, first - Math.floor(maxChars * 0.35)) : 0;
  const end = Math.min(text.length, start + maxChars);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

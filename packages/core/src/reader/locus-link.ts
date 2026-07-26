import type { PdfLocus, TextPositionSelector, TextQuoteSelector } from "./pdf-locus.js";

/**
 * Deep-link (de)serialisation for jump-to-locus. A locus is encoded inline in
 * a same-origin URL param so "open the source at this sentence" works without a
 * server round-trip or a stored anchor id. Read-only; never trusts its input.
 *
 * `encodeLocus` returns raw JSON. Callers that put it in a query string should
 * let `URLSearchParams` / the URL API percent-encode once — do not pre-encode.
 */

function isQuote(value: unknown): value is TextQuoteSelector {
  if (typeof value !== "object" || value === null) return false;
  const q = value as Record<string, unknown>;
  return q.type === "TextQuoteSelector" && typeof q.exact === "string" && q.exact.length > 0;
}

function isPosition(value: unknown): value is TextPositionSelector {
  if (typeof value !== "object" || value === null) return false;
  const p = value as Record<string, unknown>;
  return (
    p.type === "TextPositionSelector" &&
    typeof p.start === "number" &&
    typeof p.end === "number"
  );
}

function parseLocusJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    // Legacy links that pre-encoded before URLSearchParams / manual concat.
    try {
      return JSON.parse(decodeURIComponent(raw));
    } catch {
      return null;
    }
  }
}

/** Serialise a locus into a query-param value (raw JSON; encode at the URL layer). */
export function encodeLocus(locus: PdfLocus): string {
  const quote: TextQuoteSelector = {
    type: "TextQuoteSelector",
    exact: locus.quote.exact,
    ...(locus.quote.prefix != null ? { prefix: locus.quote.prefix } : {}),
    ...(locus.quote.suffix != null ? { suffix: locus.quote.suffix } : {}),
  };
  const payload: PdfLocus = locus.position ? { quote, position: locus.position } : { quote };
  return JSON.stringify(payload);
}

/** Parse a locus param back into a `PdfLocus`, or null when malformed. */
export function decodeLocus(raw: string | null | undefined): PdfLocus | null {
  if (!raw) return null;
  const parsed = parseLocusJson(raw);
  if (typeof parsed !== "object" || parsed === null) return null;
  const candidate = parsed as Record<string, unknown>;
  if (!isQuote(candidate.quote)) return null;
  const locus: PdfLocus = { quote: candidate.quote };
  if (isPosition(candidate.position)) locus.position = candidate.position;
  return locus;
}

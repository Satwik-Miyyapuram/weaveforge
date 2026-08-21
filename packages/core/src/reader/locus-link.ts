import type { PdfLocus, TextPositionSelector, TextQuoteSelector } from "./pdf-locus.js";

/**
 * Deep-link (de)serialisation for jump-to-locus. A locus is encoded inline in
 * a same-origin URL param so "open the source at this sentence" works without a
 * server round-trip or a stored anchor id. Read-only; never trusts its input.
 *
 * `encodeLocus` returns raw JSON. Callers that put it in a query string should
 * let `URLSearchParams` / the URL API percent-encode once — do not pre-encode.
 */

const MAX_LOCUS_PARAM_CHARS = 8_000;
const MAX_QUOTE_FIELD_CHARS = 2_000;

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function clampQuoteField(value: string): string {
  return value.length <= MAX_QUOTE_FIELD_CHARS ? value : value.slice(0, MAX_QUOTE_FIELD_CHARS);
}

function isQuote(value: unknown): value is TextQuoteSelector {
  if (typeof value !== "object" || value === null) return false;
  const q = value as Record<string, unknown>;
  if (q.type !== "TextQuoteSelector" || typeof q.exact !== "string" || q.exact.length === 0) {
    return false;
  }
  if (q.exact.length > MAX_QUOTE_FIELD_CHARS) return false;
  if (!isOptionalString(q.prefix) || !isOptionalString(q.suffix)) return false;
  if (typeof q.prefix === "string" && q.prefix.length > MAX_QUOTE_FIELD_CHARS) return false;
  if (typeof q.suffix === "string" && q.suffix.length > MAX_QUOTE_FIELD_CHARS) return false;
  return true;
}

function isPosition(value: unknown): value is TextPositionSelector {
  if (typeof value !== "object" || value === null) return false;
  const p = value as Record<string, unknown>;
  if (p.type !== "TextPositionSelector") return false;
  if (typeof p.start !== "number" || typeof p.end !== "number") return false;
  if (!Number.isFinite(p.start) || !Number.isFinite(p.end)) return false;
  if (p.start < 0 || p.end < p.start) return false;
  return true;
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
    exact: clampQuoteField(locus.quote.exact),
    ...(locus.quote.prefix != null ? { prefix: clampQuoteField(locus.quote.prefix) } : {}),
    ...(locus.quote.suffix != null ? { suffix: clampQuoteField(locus.quote.suffix) } : {}),
  };
  const payload: PdfLocus = locus.position ? { quote, position: locus.position } : { quote };
  const raw = JSON.stringify(payload);
  if (raw.length > MAX_LOCUS_PARAM_CHARS) {
    // Prefer a quote-only payload over an unreadable deep link.
    return JSON.stringify({ quote });
  }
  return raw;
}

/** Parse a locus param back into a `PdfLocus`, or null when malformed. */
export function decodeLocus(raw: string | null | undefined): PdfLocus | null {
  if (!raw) return null;
  if (raw.length > MAX_LOCUS_PARAM_CHARS) return null;
  const parsed = parseLocusJson(raw);
  if (typeof parsed !== "object" || parsed === null) return null;
  const candidate = parsed as Record<string, unknown>;
  if (!isQuote(candidate.quote)) return null;
  const locus: PdfLocus = { quote: candidate.quote };
  if (isPosition(candidate.position)) locus.position = candidate.position;
  return locus;
}

/**
 * Paper record rules (Rust `papers::paper`, `papers::paper_field`, `papers::annotation_quotation_type`),
 * re-exported from index.ts. Each function keeps the signature of the TS file of the same name in
 * packages/core/src/features/papers/domain.
 */
import {
  coercePaperFieldValue as rawCoercePaperFieldValue,
  encodeRollupOptions as rawEncodeRollupOptions,
  extractHashtagRefs as rawExtractHashtagRefs,
  extractHashtags as rawExtractHashtags,
  imagesOf as rawImagesOf,
  isEmptyPaperSummary as rawIsEmptyPaperSummary,
  isPaperFieldKind as rawIsPaperFieldKind,
  isQuotationType as rawIsQuotationType,
  normalizeDoi as rawNormalizeDoi,
  resolveRelatedPaperUrl as rawResolveRelatedPaperUrl,
  normalizeFieldName as rawNormalizeFieldName,
  normalizeSelectOptions as rawNormalizeSelectOptions,
  normalizeTags as rawNormalizeTags,
  parseRollupOptions as rawParseRollupOptions,
} from "../pkg/wf_wasm.js";
import type {
  HashtagRef,
  PaperFieldKind,
  PaperFieldRollupConfig,
  PaperFieldValueData,
  QuotationType,
} from "./bindings.js";

/** A DOI without its resolver prefix, lower-cased; undefined when blank. */
export function normalizeDoi(doi?: string): string | undefined {
  return rawNormalizeDoi(doi ?? undefined);
}

/** The page a related-paper hit links to: its url, else its DOI link, else its arXiv page. */
export function resolveRelatedPaperUrl(hit: {
  url?: string;
  doi?: string;
  arxivId?: string;
}): string | undefined {
  return rawResolveRelatedPaperUrl(hit.url, hit.doi, hit.arxivId);
}

/** Storage paths of a paper's attached images (`metadata.images`); empty when absent. */
export function imagesOf(metadata: Record<string, unknown> | null | undefined): string[] {
  return rawImagesOf(metadata ?? null);
}

/** Tags trimmed, lower-cased and de-duplicated, blanks dropped. */
export function normalizeTags(tags: string[]): string[] {
  return rawNormalizeTags(tags);
}

/** Every `#tag` in `text`, with its position. */
export function extractHashtagRefs(text?: string): HashtagRef[] {
  return rawExtractHashtagRefs(text ?? undefined) as HashtagRef[];
}

/** The distinct `#tag` names in `text`. */
export function extractHashtags(text?: string): string[] {
  return rawExtractHashtags(text ?? undefined);
}

/** Whether a summary is missing or the "No summary yet." placeholder. */
export function isEmptyPaperSummary(summary: string | null | undefined): boolean {
  return rawIsEmptyPaperSummary(summary ?? undefined);
}

/** A field name trimmed, with inner whitespace runs collapsed to one space. */
export function normalizeFieldName(raw: string): string {
  return rawNormalizeFieldName(raw);
}

/** Select options trimmed, blanks dropped, and case-insensitive repeats removed (first spelling wins). */
export function normalizeSelectOptions(raw: readonly string[]): string[] {
  return rawNormalizeSelectOptions([...raw]);
}

/** Whether `value` names a paper field kind. */
export function isPaperFieldKind(value: string): value is PaperFieldKind {
  return rawIsPaperFieldKind(value);
}

/** A rollup config as the field's stored option strings. */
export function encodeRollupOptions(config: PaperFieldRollupConfig): string[] {
  return rawEncodeRollupOptions(config);
}

/** The rollup config stored in a field's options, or null when they hold none. */
export function parseRollupOptions(options: readonly string[]): PaperFieldRollupConfig | null {
  return (rawParseRollupOptions([...options]) as PaperFieldRollupConfig | null) ?? null;
}

/**
 * The value a field stores for `raw` (null or blank clears it, `null` is returned). Throws with the
 * refusal message for a wrong shape or a rollup field.
 */
export function coercePaperFieldValue(
  kind: PaperFieldKind,
  raw: PaperFieldValueData | null | undefined,
): PaperFieldValueData | null {
  return (rawCoercePaperFieldValue(kind, raw ?? null) as PaperFieldValueData | null) ?? null;
}

/** Whether `value` names a quotation type. */
export function isQuotationType(value: string): value is QuotationType {
  return rawIsQuotationType(value);
}

/**
 * Paper record rules (Rust `papers::paper`, `papers::paper_field`, `papers::annotation_quotation_type`),
 * re-exported from index.ts. Each function keeps the signature of the TS file of the same name in
 * packages/core/src/features/papers/domain.
 */
import {
  encodeRollupOptions as rawEncodeRollupOptions,
  extractHashtagRefs as rawExtractHashtagRefs,
  extractHashtags as rawExtractHashtags,
  isEmptyPaperSummary as rawIsEmptyPaperSummary,
  isPaperFieldKind as rawIsPaperFieldKind,
  isQuotationType as rawIsQuotationType,
  normalizeDoi as rawNormalizeDoi,
  normalizeTags as rawNormalizeTags,
  parseRollupOptions as rawParseRollupOptions,
} from "../pkg/wf_wasm.js";
import type { HashtagRef, PaperFieldKind, PaperFieldRollupConfig, QuotationType } from "./bindings.js";

/** A DOI without its resolver prefix, lower-cased; undefined when blank. */
export function normalizeDoi(doi?: string): string | undefined {
  return rawNormalizeDoi(doi ?? undefined);
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

/** Whether `value` names a quotation type. */
export function isQuotationType(value: string): value is QuotationType {
  return rawIsQuotationType(value);
}

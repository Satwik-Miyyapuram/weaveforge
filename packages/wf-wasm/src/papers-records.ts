/**
 * Paper record rules (Rust `papers::paper`, `papers::paper_field`, `papers::annotation_quotation_type`),
 * re-exported from index.ts. Each function keeps the signature of the TS file of the same name in
 * packages/core/src/features/papers/domain.
 */
import {
  coercePaperFieldValue as rawCoercePaperFieldValue,
  imagesOf as rawImagesOf,
  resolveRelatedPaperUrl as rawResolveRelatedPaperUrl,
  normalizeSelectOptions as rawNormalizeSelectOptions,
  parseRollupOptions as rawParseRollupOptions,
} from "../pkg/wf_wasm.js";
import type {
  PaperFieldKind,
  PaperFieldRollupConfig,
  PaperFieldValueData,
} from "./bindings.js";

export {
  checkNewPaper,
  encodeRollupOptions,
  extractHashtagRefs,
  extractHashtags,
  isEmptyPaperSummary,
  isPaperFieldKind,
  isQuotationType,
  normalizeDoi,
  normalizeFieldName,
  normalizeTags,
} from "../pkg/wf_wasm.js";

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

/** Select options trimmed, blanks dropped, and case-insensitive repeats removed (first spelling wins). */
export function normalizeSelectOptions(raw: readonly string[]): string[] {
  return rawNormalizeSelectOptions([...raw]);
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


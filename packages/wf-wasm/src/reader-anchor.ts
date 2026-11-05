/**
 * Text and geometry anchor resolution (`packages/core/src/reader/anchor-*`), backed by
 * Rust. Offsets are UTF-16 code units, as in the TS copy. Re-exported from index.ts.
 */
import {
  normaliseWhitespace as rawNormaliseWhitespace,
  findQuoteMatches as rawFindQuoteMatches,
  pickNearestMatch as rawPickNearestMatch,
  resolvePositionSelector as rawResolvePositionSelector,
  resolveTextAnchor as rawResolveTextAnchor,
  chooseAnchorStrategy as rawChooseAnchorStrategy,
} from "../pkg/wf_wasm.js";
import type {
  AnchorCombinedPdf,
  AnchorPdfLocus,
  AnchorPositionSelector,
  AnchorQuoteSelector,
  AnchorConfidence,
  AnchorStrategy,
  AnchorTextSpan,
  AnchorVia,
} from "./bindings.js";

/**
 * Collapse whitespace runs to one space; `map[i]` is the original offset of
 * normalised unit `i`, and `map[normalised.length]` the exclusive end (Rust `normalise_whitespace`).
 */
export function normaliseWhitespace(
  text: string,
  options: { trim?: boolean } = {},
): { normalised: string; map: number[] } {
  return rawNormaliseWhitespace(text, options) as { normalised: string; map: number[] };
}

/** Every exact occurrence of `quote.exact` whose prefix/suffix match (Rust `find_quote_matches`). */
export function findQuoteMatches(text: string, quote: AnchorQuoteSelector): { start: number; end: number }[] {
  return rawFindQuoteMatches(text, quote) as { start: number; end: number }[];
}

/** The match nearest `position.start`; the first on ties (Rust `pick_nearest_match`). */
export function pickNearestMatch(
  matches: readonly AnchorTextSpan[],
  position: AnchorPositionSelector | undefined,
): { start: number; end: number } | undefined {
  return (rawPickNearestMatch(matches, position) ?? undefined) as { start: number; end: number } | undefined;
}

/** The position span when in bounds and ordered, else `null` (Rust `resolve_position_selector`). */
export function resolvePositionSelector(
  text: string,
  position: AnchorPositionSelector,
): { start: number; end: number } | null {
  return rawResolvePositionSelector(text, position) as { start: number; end: number } | null;
}

/** Quote first, then position fallback; `null` when neither works (Rust `resolve_text_anchor`). */
export function resolveTextAnchor(text: string, locus: AnchorPdfLocus): { start: number; end: number; via: AnchorVia; confidence: AnchorConfidence } | null {
  return rawResolveTextAnchor(text, locus) as { start: number; end: number; via: AnchorVia; confidence: AnchorConfidence } | null;
}

/** Which anchor to trust for the current PDF (Rust `choose_anchor_strategy`). */
export function chooseAnchorStrategy(
  anchor: AnchorCombinedPdf,
  currentContentHash: string,
): AnchorStrategy {
  const strategy = rawChooseAnchorStrategy(anchor, currentContentHash) as AnchorStrategy;
  // Hand back the caller's own objects, as the TS copy does, so unknown fields survive.
  if (strategy.kind === "rects") return { ...strategy, position: anchor.zoteroPosition! };
  if (strategy.kind === "quote") return { ...strategy, locus: anchor.locus! };
  return strategy;
}

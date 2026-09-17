/**
 * The text layer, flowed across pages.
 *
 * A page's text is stored on that page (§ink-note, `<!-- page n -->`), but a
 * note that came from the editor keeps everything on page 1, and a page is
 * only so tall. Rather than clip what does not fit, the surplus runs on to
 * the next page — and past the last page, on to as many new ones as it needs.
 * Storage is untouched: this is how the text is *shown*, not where it lives.
 *
 * The fit is estimated, not measured in the DOM: each source line takes
 * `ceil(width / contentWidth)` rows of the underlay's fixed line height, with
 * the width read off a canvas in the same font. `pre-wrap` + `break-word`
 * wraps at roughly that, and a row's slack at the page foot is invisible.
 */

import { useMemo } from "react";

import { INK_UNDERLAY } from "./ink-sheet-underlay";

export interface TextFlowMetrics {
  /** Rows of text a page holds. */
  rowsPerPage: number;
  /** The width the text wraps at, in CSS px. */
  contentWidth: number;
  /** The rendered width of a line of text, in CSS px. */
  measure: (line: string) => number;
}

/** The rows a source line takes once wrapped. */
function rowsOf(line: string, metrics: TextFlowMetrics): number {
  if (line.length === 0) return 1;
  return Math.max(
    1,
    Math.ceil(metrics.measure(line) / Math.max(1, metrics.contentWidth)),
  );
}

/**
 * Flow `pages` (each page's pure text) so that no page holds more than fits.
 *
 * Returns at least `pages.length` entries; more when the last page overflows.
 * A page's own text always comes after what flowed on to it.
 */
export function flowTextPages(
  pages: readonly string[],
  metrics: TextFlowMetrics,
): string[] {
  const out: string[] = [];
  let carry: string[] = [];
  const fill = (source: string[]): void => {
    const kept: string[] = [];
    let rows = 0;
    let i = 0;
    for (; i < source.length; i += 1) {
      const need = rowsOf(source[i]!, metrics);
      // A line taller than a page on its own still goes somewhere.
      if (rows + need > metrics.rowsPerPage && kept.length > 0) break;
      kept.push(source[i]!);
      rows += need;
    }
    carry = source.slice(i);
    // A carried block starts the next page at its top: leading blanks go.
    while (carry.length > 0 && carry[0]!.trim() === "") carry.shift();
    out.push(kept.join("\n"));
  };
  for (const text of pages) {
    const own = text.length > 0 ? text.split(/\r?\n/) : [];
    // A blank row between what flowed in and what the page already had.
    const source =
      carry.length > 0 && own.length > 0
        ? [...carry, "", ...own]
        : [...carry, ...own];
    fill(source);
  }
  while (carry.length > 0) fill(carry);
  return out;
}

/**
 * The flow metrics for a sheet of `pageSize` at `scale`, in the browser's
 * own font; `null` where there is no document to measure with.
 */
export function textFlowMetrics(
  pageSize: { width: number; height: number },
  scale: number,
): TextFlowMetrics | null {
  if (typeof document === "undefined") return null;
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return null;
  const fontSize = INK_UNDERLAY.fontSize(scale);
  const family = getComputedStyle(document.body).fontFamily || "sans-serif";
  ctx.font = `${fontSize}px ${family}`;
  const width = Math.round(pageSize.width * scale);
  const height = Math.round(pageSize.height * scale);
  const rowHeight = fontSize * INK_UNDERLAY.lineHeight;
  return {
    rowsPerPage: Math.max(
      1,
      Math.floor((height - 2 * INK_UNDERLAY.padY(scale)) / rowHeight),
    ),
    contentWidth: Math.max(1, width - 2 * INK_UNDERLAY.padX(scale)),
    measure: (line) => ctx.measureText(line).width,
  };
}

/** `pages`' pure text, flowed to fit sheets of `pageSize` at `scale`. */
export function useFlowedTextPages(
  pages: readonly string[],
  pageSize: { width: number; height: number },
  scale: number,
): string[] {
  // The host's page list is a ref's array, mutated in place: the joined text
  // is the identity that matters, not the array's.
  const key = pages.join("␞");
  return useMemo(() => {
    const metrics = textFlowMetrics(pageSize, scale);
    return metrics ? flowTextPages(pages, metrics) : [...pages];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, pageSize.width, pageSize.height, scale]);
}

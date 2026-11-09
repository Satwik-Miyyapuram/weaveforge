/**
 * The public bibliography API, kept stable so the UI does not need a
 * rewrite: `referenceListLines` and `parseReferenceList` take the outline
 * items the reader has always handed over. Section scoring runs in the Rust
 * core (`findReferenceSection`); entry splitting and field parsing stay in
 * `bibliography-parser`.
 */

import { rust } from "../../shared/rust.js";
import { bodyFontSize, outlineTextLines } from "./outline-rust.js";
import type { OutlineTextItem } from "./outline-types.js";
import type { ParsedReference } from "./analysis/analysis-types.js";
import { parseBibliography } from "./analysis/bibliography-parser.js";
import { isBoldFont, type TextLine } from "./analysis/line-reconstruction.js";

export type { ParsedReference };

/** Outline lines as the analysis modules see them, with synthetic offsets. */
function analysisLines(pages: readonly (readonly OutlineTextItem[])[]): {
  lines: TextLine[];
  source: OutlineTextItem[];
} {
  const source = outlineTextLines(pages);
  let cursor = 0;
  const lines = source.map((item) => {
    const start = cursor;
    cursor += item.str.length + 1;
    return {
      page: item.page,
      x: item.x,
      y: item.y,
      right: item.x,
      text: item.str,
      fontSize: item.fontSize,
      bold: isBoldFont(item.fontName),
      start,
      end: start + item.str.length,
    };
  });
  return { lines, source };
}

/** The bibliography's span over `lines` (indices into them), or `null` when there is none. */
function referenceSpan(
  lines: readonly TextLine[],
  pages: readonly (readonly OutlineTextItem[])[],
): { start: number; end: number } | null {
  const span: { start: number; end: number } | null | undefined = rust().findReferenceSection(
    lines,
    bodyFontSize(pages),
    pages.length,
    undefined,
  );
  return span ?? null;
}

/** The bibliography's lines, heading excluded; empty when there is none. */
export function referenceListLines(pages: readonly (readonly OutlineTextItem[])[]): OutlineTextItem[] {
  const { lines, source } = analysisLines(pages);
  const span = referenceSpan(lines, pages);
  return span ? source.slice(span.start, span.end) : [];
}

/** Best-effort bibliography parsing; needs a heading or a numbered run in the last third. */
export function parseReferenceList(pages: readonly (readonly OutlineTextItem[])[]): ParsedReference[] {
  const { lines } = analysisLines(pages);
  const span = referenceSpan(lines, pages);
  if (!span) return [];
  return parseBibliography(lines.slice(span.start, span.end), false);
}

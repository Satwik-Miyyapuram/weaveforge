/**
 * The public bibliography API, kept stable so the UI does not need a
 * rewrite: `referenceListLines` and `parseReferenceList` take the outline
 * items the reader has always handed over. The work is done by the analysis
 * modules — section scoring in `reference-section`, entry splitting and
 * field parsing in `bibliography-parser`.
 */

import { bodyFontSize, outlineTextLines, type OutlineTextItem } from "./outline-from-text.js";
import type { ParsedReference } from "./analysis/analysis-types.js";
import { parseBibliography } from "./analysis/bibliography-parser.js";
import { findReferenceSection } from "./analysis/reference-section.js";
import type { TextLine } from "./analysis/line-reconstruction.js";

export type { ParsedReference };

function isBoldFont(fontName: string | undefined): boolean {
  return /bold|black|heavy/i.test(fontName ?? "");
}

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

/** The bibliography's lines, heading excluded; empty when there is none. */
export function referenceListLines(pages: readonly (readonly OutlineTextItem[])[]): OutlineTextItem[] {
  const { lines, source } = analysisLines(pages);
  const span = findReferenceSection(lines, {
    bodyFontSize: bodyFontSize(pages),
    pageCount: pages.length,
  });
  return span ? source.slice(span.start, span.end) : [];
}

/** Best-effort bibliography parsing; needs a heading or a numbered run in the last third. */
export function parseReferenceList(pages: readonly (readonly OutlineTextItem[])[]): ParsedReference[] {
  const { lines } = analysisLines(pages);
  const span = findReferenceSection(lines, {
    bodyFontSize: bodyFontSize(pages),
    pageCount: pages.length,
  });
  if (!span) return [];
  return parseBibliography(lines.slice(span.start, span.end), false);
}

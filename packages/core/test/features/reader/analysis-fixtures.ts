/**
 * Fixture builders for the document-analysis tests: fake pages that behave
 * like pdf.js text layers — glyph runs with transforms, `hasEOL` line ends,
 * `/Link` annotations with internal destinations — one helper per citation
 * convention under test.
 */

import type { AnalyzePdfPage, PdfLink } from "../../../src/features/reader/analysis/analysis-types.js";
import type { PageTextItem } from "../../../src/reader/selection-to-anchor.js";

export interface RunOptions {
  fontSize?: number;
  bold?: boolean;
  /** Defaults to true — most fixture runs end their line. */
  hasEOL?: boolean;
  width?: number;
}

/** One glyph run at `(x, y)`, font size in the transform like pdf.js does. */
export function run(str: string, x: number, y: number, options: RunOptions = {}): PageTextItem {
  const fontSize = options.fontSize ?? 10;
  return {
    str,
    transform: [fontSize, 0, 0, fontSize, x, y],
    width: options.width ?? str.length * fontSize * 0.5,
    height: fontSize,
    hasEOL: options.hasEOL ?? true,
    ...(options.bold ? { fontName: "ABCDEF+Title-Bold" } : {}),
  };
}

export interface LineSpec {
  text: string;
  x?: number;
  bold?: boolean;
  fontSize?: number;
  /** Override the run's y (grows downward here, converted to PDF space). */
  dy?: number;
}

/**
 * A page of single-column lines, top to bottom from y 720 in steps of 15.
 * Links are supplied separately, in PDF user space.
 */
export function textPage(
  pageNumber: number,
  rows: readonly (string | LineSpec)[],
  links: readonly PdfLink[] = [],
): AnalyzePdfPage {
  const items: PageTextItem[] = [];
  let y = 720;
  for (const row of rows) {
    const spec = typeof row === "string" ? { text: row } : row;
    y -= spec.dy ?? 15;
    items.push(run(spec.text, spec.x ?? 40, y, { bold: spec.bold, fontSize: spec.fontSize }));
  }
  return { pageNumber, items, links };
}

/** A rectangle covering a run built by `textPage` at the given row. */
export function rectOver(str: string, x: number, y: number, fontSize = 10): [number, number, number, number] {
  const width = str.length * fontSize * 0.5;
  return [x - 1, y - 2, x + width + 1, y + fontSize + 2];
}

/** Letter-only surnames, so the author extractor has no digits to trip on. */
export const SURNAMES = [
  "Anderson", "Baker", "Clarke", "Davis", "Evans", "Freeman", "Gupta", "Harris",
  "Ivanov", "Jones", "Kim", "Lee", "Miller", "Nakamura", "Olsen", "Patel",
  "Quinn", "Rossi", "Schmidt", "Tanaka",
];

/** A numbered bibliography, one entry per line. */
export function numberedReferences(count: number, heading = "References"): (string | LineSpec)[] {
  return [
    { text: heading, bold: true, fontSize: 12 },
    ...Array.from(
      { length: count },
      (_, i) => `[${i + 1}] ${SURNAMES[i % SURNAMES.length]}, A. ${1990 + i}. A useful method ${i + 1}. In Proceedings of Test ${i + 1}.`,
    ),
  ];
}

/** An author-year bibliography in APA shape. */
export function authorYearReferences(entries: readonly { surname: string; year: number; title?: string }[]): (string | LineSpec)[] {
  return [
    { text: "References", bold: true, fontSize: 12 },
    ...entries.map((entry) =>
      `${entry.surname}, A. (${entry.year}). ${entry.title ?? `${entry.surname} work ${entry.year}`}. Journal of Tests.`,
    ),
  ];
}

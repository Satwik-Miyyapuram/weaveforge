/**
 * Normalize pdf.js text items into lines.
 *
 * The text layer hands the reader glyph runs, not lines: a visual line is
 * whatever runs share a baseline, and the same page can carry body text, a
 * raised heading numeral and a footnote at three different sizes on one
 * baseline band. Runs are joined the way `outlineTextLines` does — a loose
 * band first, tightened when the loose pass fuses two lines — but every line
 * also carries its character offsets into the page text, which the citation
 * and bibliography code needs to stay aligned with the overlay.
 *
 * The page-text convention is the reader's everywhere: items concatenated, a
 * newline after each `hasEOL` item — the same string the search index and
 * the anchor code assume, so offsets computed here line up with them.
 */

import type { PageTextItem } from "./analysis-types.js";

/** One reconstructed line, with offsets into its page's text. */
export interface TextLine {
  page: number;
  /** Left edge and baseline of the first run, PDF user space. */
  x: number;
  y: number;
  /** Right edge of the last run. */
  right: number;
  text: string;
  /** Largest run on the line — headings stand out by size. */
  fontSize: number;
  /** Any run set in a bold/Black/Heavy face. */
  bold: boolean;
  /** Offsets into the page text, `end` exclusive of a trailing newline. */
  start: number;
  end: number;
}

/** Items concatenated, `\n` after each `hasEOL` item — the reader's convention. */
export function pageTextFromItems(items: readonly { str: string; hasEOL?: boolean }[]): string {
  let text = "";
  for (const item of items) {
    text += item.str;
    if (item.hasEOL) text += "\n";
  }
  return text;
}

function isBoldFont(fontName: string | undefined): boolean {
  return /bold|black|heavy/i.test(fontName ?? "");
}

interface Run {
  item: PageTextItem;
  start: number;
  end: number;
  fontSize: number;
  x: number;
  y: number;
  right: number;
}

/** The page's runs with geometry and offsets lifted out of the transform. */
function runsOf(items: readonly PageTextItem[]): { runs: Run[]; text: string } {
  const runs: Run[] = [];
  let text = "";
  for (const item of items) {
    const start = text.length;
    text += item.str + (item.hasEOL ? "\n" : "");
    if (!item.str.trim()) continue;
    const fontSize = Math.hypot(item.transform[2] ?? 0, item.transform[3] ?? 0);
    runs.push({
      item,
      start,
      end: start + item.str.length,
      fontSize,
      x: item.transform[4] ?? 0,
      y: item.transform[5] ?? 0,
      right: (item.transform[4] ?? 0) + (item.width || 0),
    });
  }
  return { runs, text };
}

interface Joined {
  text: string;
  x: number;
  y: number;
  right: number;
  fontSize: number;
  bold: boolean;
  start: number;
  end: number;
  /** Baseline spread of the joined runs — a fused pair of lines shows here. */
  spread: number;
}

function joinRuns(runs: readonly Run[], tolerance: number): Joined[] {
  const lines: (Joined & { minY: number; maxY: number })[] = [];
  let line: (typeof lines)[number] | undefined;
  for (const run of runs) {
    const band = Math.max(1, tolerance * Math.max(line?.fontSize ?? 0, run.fontSize));
    if (line && Math.abs(line.y - run.y) <= band && run.x >= line.x) {
      line.text = `${line.text.trimEnd()} ${run.item.str.trimStart()}`;
      line.fontSize = Math.max(line.fontSize, run.fontSize);
      if (isBoldFont(run.item.fontName)) line.bold = true;
      line.right = Math.max(line.right, run.right);
      line.end = run.end;
      line.minY = Math.min(line.minY, run.y);
      line.maxY = Math.max(line.maxY, run.y);
      line.spread = line.maxY - line.minY;
    } else {
      line = {
        text: run.item.str.trim(),
        x: run.x,
        y: run.y,
        right: run.right,
        fontSize: run.fontSize,
        bold: isBoldFont(run.item.fontName),
        start: run.start,
        end: run.end,
        spread: 0,
        minY: run.y,
        maxY: run.y,
      };
      lines.push(line);
    }
  }
  return lines.map(({ minY: _a, maxY: _b, ...rest }) => rest);
}

/**
 * One page's runs as lines, in the page's own order. Two passes, as in the
 * outline code: a loose band that catches a heading's raised numeral, then a
 * tight pass when the loose one fused lines whose runs span several font
 * heights.
 */
export function reconstructLines(page: number, items: readonly PageTextItem[]): TextLine[] {
  const { runs } = runsOf(items);
  for (const tolerance of [0.75, 0.5]) {
    const joined = joinRuns(runs, tolerance);
    const fused = joined.some((line) => line.spread > line.fontSize * 0.5);
    if (tolerance === 0.75 && !fused) {
      return joined.map(({ spread: _spread, ...line }) => ({ page, ...line }));
    }
    if (tolerance === 0.5) {
      return joined.map(({ spread: _spread, ...line }) => ({ page, ...line }));
    }
  }
  return [];
}

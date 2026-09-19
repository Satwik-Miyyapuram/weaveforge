/**
 * Detect columns and reading order.
 *
 * Papers set in two columns print the left column top-to-bottom, then the
 * right one, but the text layer's order is whatever the producer wrote. The
 * detection is by left margins: lines cluster on the left margin of each
 * column, and a real second column starts past the middle of the page while
 * the first column's lines end before it. Page furniture (running heads that
 * span the page) is ignored by the caller rather than here.
 */

import type { TextLine } from "./line-reconstruction.js";

/** How close two left margins must be to count as one column, in points. */
const MARGIN_TOLERANCE = 10;
/** A line of a previous column must end this far before the next one starts. */
const GUTTER = 12;

/**
 * Column index (0-based) for each supplied line, all on one page. Lines whose
 * margin fits no dominant column take the nearest one, so a paragraph indent
 * never spawns a column of its own.
 */
export function detectColumns(lines: readonly TextLine[]): number[] {
  if (lines.length < 4) return lines.map(() => 0);
  const pageRight = Math.max(...lines.map((line) => line.right));
  const pageLeft = Math.min(...lines.map((line) => line.x));
  const width = pageRight - pageLeft;
  if (width <= 0) return lines.map(() => 0);

  // Cluster left margins.
  const clusters: { x: number; count: number; members: TextLine[] }[] = [];
  for (const line of lines) {
    const cluster = clusters.find((c) => Math.abs(c.x - line.x) <= MARGIN_TOLERANCE);
    if (cluster) {
      cluster.x = (cluster.x * cluster.count + line.x) / (cluster.count + 1);
      cluster.count += 1;
      cluster.members.push(line);
    } else {
      clusters.push({ x: line.x, count: 1, members: [line] });
    }
  }
  const dominant = clusters
    .filter((c) => c.count >= Math.max(3, lines.length / 10))
    .sort((a, b) => a.x - b.x);
  if (dominant.length < 2) return lines.map(() => 0);

  // A two-column page: the second dominant margin sits past the page's middle
  // and the first column's lines stop short of it.
  const first = dominant[0]!;
  const second = dominant.find(
    (c) =>
      c !== first &&
      c.x >= pageLeft + width * 0.42 &&
      first.members.every((m) => m.right <= c.x + GUTTER || m.right >= pageRight - 2),
  );
  if (!second) return lines.map(() => 0);

  return lines.map((line) => (line.x >= second.x - MARGIN_TOLERANCE ? 1 : 0));
}

/**
 * Reading order over already-column-tagged lines: page, then column, then top
 * to bottom (PDF baselines grow upward, so larger `y` first).
 */
export function sortByReadingOrder<T extends TextLine>(
  tagged: readonly { line: T; column: number }[],
): T[] {
  return tagged
    .slice()
    .sort(
      (a, b) =>
        a.line.page - b.line.page ||
        a.column - b.column ||
        b.line.y - a.line.y ||
        a.line.x - b.line.x,
    )
    .map((entry) => entry.line);
}

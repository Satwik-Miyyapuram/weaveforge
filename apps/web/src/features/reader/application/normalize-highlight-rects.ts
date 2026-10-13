/**
 * One clean band per line of a text highlight.
 *
 * A browser selection's `getClientRects()` over the PDF text layer returns one
 * box per text span, and pdf.js sizes those spans by the font's ascent and
 * descent, not by the line pitch. Neighbouring spans on a line overlap, and a
 * line's boxes reach into the line above and below. Each box is painted with a
 * translucent fill, so every overlap paints twice: dark patches inside a line
 * and dark stripes between lines.
 *
 * This merges the boxes of one line into a single band and splits any overlap
 * between two lines at its midpoint, so no point of the page is covered twice.
 * Rects are PDF user space, `[x1, y1, x2, y2]` with a bottom-left origin.
 */

type Rect = [number, number, number, number];

/** Two boxes share a line when they overlap by at least this share of the shorter one. */
const SAME_LINE = 0.5;
/** A horizontal gap below this share of the line height is the space between words. */
const WORD_GAP = 0.6;

interface Line {
  bottom: number;
  top: number;
  spans: Rect[];
}

function asRect(value: readonly number[]): Rect | null {
  if (value.length < 4) return null;
  const [a, b, c, d] = value as [number, number, number, number];
  if (![a, b, c, d].every(Number.isFinite)) return null;
  const rect: Rect = [Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d)];
  return rect[2] - rect[0] > 0 && rect[3] - rect[1] > 0 ? rect : null;
}

function verticalOverlap(a: { bottom: number; top: number }, b: { bottom: number; top: number }) {
  return Math.min(a.top, b.top) - Math.max(a.bottom, b.bottom);
}

export function normalizeHighlightRects(rects: readonly (readonly number[])[]): number[][] {
  const boxes = rects.map(asRect).filter((r): r is Rect => r !== null);
  if (boxes.length < 2) return boxes;

  // Top of the page first (largest y), then left to right.
  boxes.sort((a, b) => b[3] + b[1] - (a[3] + a[1]) || a[0] - b[0]);

  const lines: Line[] = [];
  for (const box of boxes) {
    const band = { bottom: box[1], top: box[3] };
    const height = box[3] - box[1];
    const line = lines.find(
      (l) => verticalOverlap(l, band) >= SAME_LINE * Math.min(height, l.top - l.bottom),
    );
    if (line) {
      line.spans.push(box);
      line.bottom = Math.min(line.bottom, box[1]);
      line.top = Math.max(line.top, box[3]);
    } else {
      lines.push({ ...band, spans: [box] });
    }
  }
  lines.sort((a, b) => b.top + b.bottom - (a.top + a.bottom));

  // Split the overlap between consecutive lines at its midpoint.
  for (let i = 0; i + 1 < lines.length; i++) {
    const upper = lines[i]!;
    const lower = lines[i + 1]!;
    if (verticalOverlap(upper, lower) > 0) {
      const mid = (upper.bottom + lower.top) / 2;
      upper.bottom = mid;
      lower.top = mid;
    }
  }

  const out: number[][] = [];
  for (const line of lines) {
    const gap = WORD_GAP * (line.top - line.bottom);
    const spans = [...line.spans].sort((a, b) => a[0] - b[0]);
    let left = spans[0]![0];
    let right = spans[0]![2];
    for (const span of spans.slice(1)) {
      if (span[0] <= right + gap) {
        right = Math.max(right, span[2]);
      } else {
        out.push([left, line.bottom, right, line.top]);
        left = span[0];
        right = span[2];
      }
    }
    out.push([left, line.bottom, right, line.top]);
  }
  return out;
}

/**
 * Finds the text a press beside the words was aimed at.
 *
 * The text layer's runs are separate boxes with bare page between them, so a
 * press a few pixels left of a line, past its end or between two lines lands
 * on no text and starts no selection. This picks the nearest run, favouring
 * the press's own line, and a point just inside it where a caret can sit.
 */
export interface Box { left: number; top: number; right: number; bottom: number }

// A press further than this from every run is not aimed at text.
const MAX_DX = 120;
const MAX_DY = 24;
// Vertical distance counts more, so a press keeps to its own line.
const LINE_WEIGHT = 4;

export function snapToText(
  runs: readonly Box[],
  x: number,
  y: number,
): { index: number; x: number; y: number } | null {
  let index = -1;
  let bestScore = Infinity;
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i]!;
    if (run.right <= run.left || run.bottom <= run.top) continue;
    const dx = Math.max(run.left - x, 0, x - run.right);
    const dy = Math.max(run.top - y, 0, y - run.bottom);
    if (dx > MAX_DX || dy > MAX_DY) continue;
    const score = dy * LINE_WEIGHT + dx;
    if (score < bestScore) {
      bestScore = score;
      index = i;
    }
  }
  if (index < 0) return null;
  const run = runs[index]!;
  return {
    index,
    x: Math.min(Math.max(x, run.left + 0.5), run.right - 0.5),
    y: y >= run.top && y <= run.bottom ? y : (run.top + run.bottom) / 2,
  };
}

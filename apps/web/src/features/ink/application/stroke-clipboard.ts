import { INK_COLOURS, INK_SHAPES, INK_TOOLS, makeInkStroke, type InkStroke } from "@weaveforge/core";

/**
 * Lassoed strokes on the clipboard, as one line of text a note's paste turns
 * back into ink. Plain text so it survives any clipboard, prefixed so a paste
 * elsewhere says what it is.
 */

const PREFIX = "weaveforge-ink:";
const oneOf = <T extends string>(list: readonly T[], value: unknown): T | undefined =>
  list.includes(value as T) ? (value as T) : undefined;

/** The clipboard text for a set of strokes. */
export function strokeClipText(strokes: readonly InkStroke[]): string {
  const kept = strokes.map(({ points, pressures, width, tool, colour, shape }) => ({
    points,
    pressures,
    width,
    tool,
    colour,
    shape,
  }));
  return `${PREFIX}${JSON.stringify({ strokes: kept })}`;
}

/** The strokes a clipboard text carries, or `null` when it carries none. */
export function parseStrokeClip(text: string | null | undefined): InkStroke[] | null {
  if (!text?.startsWith(PREFIX)) return null;
  try {
    const clip = JSON.parse(text.slice(PREFIX.length)) as { strokes?: unknown } | null;
    if (!Array.isArray(clip?.strokes)) return null;
    const out: InkStroke[] = [];
    for (const raw of clip.strokes as Partial<InkStroke>[]) {
      const points = raw?.points;
      if (!Array.isArray(points) || points.length < 4 || points.length % 2 !== 0) continue;
      if (!points.every(Number.isFinite)) continue;
      const pressures = Array.isArray(raw.pressures) && raw.pressures.every(Number.isFinite) ? raw.pressures : [];
      out.push(
        makeInkStroke({
          points,
          pressures,
          width: Number.isFinite(raw.width) ? raw.width : undefined,
          tool: oneOf(INK_TOOLS, raw.tool),
          colour: oneOf(INK_COLOURS, raw.colour),
          shape: oneOf(INK_SHAPES, raw.shape),
        }),
      );
    }
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

/**
 * Where pasted strokes land: where they were copied from, stepped down and
 * right while that spot already holds the same ink, then kept on the page.
 */
export function pastedStrokesPlace(
  strokes: readonly InkStroke[],
  onPage: readonly InkStroke[],
  pageSize: { width: number; height: number },
): InkStroke[] {
  const STEP = 50;
  const starts = new Set(onPage.map((s) => `${s.points[0]},${s.points[1]}`));
  const first = strokes[0]!;
  let dx = 0;
  let dy = 0;
  for (let tries = 0; tries < 20 && starts.has(`${first.points[0]! + dx},${first.points[1]! + dy}`); tries += 1) {
    dx += STEP;
    dy += STEP;
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of strokes) {
    for (let i = 0; i < s.points.length; i += 2) {
      minX = Math.min(minX, s.points[i]!);
      maxX = Math.max(maxX, s.points[i]!);
      minY = Math.min(minY, s.points[i + 1]!);
      maxY = Math.max(maxY, s.points[i + 1]!);
    }
  }
  dx = clampShift(minX + dx, maxX + dx, pageSize.width) + dx;
  dy = clampShift(minY + dy, maxY + dy, pageSize.height) + dy;
  return strokes.map((s) => ({
    ...s,
    points: s.points.map((v, i) => v + (i % 2 === 0 ? dx : dy)),
  }));
}

/** The extra shift that keeps `[lo, hi]` inside `[0, size]` where it fits. */
function clampShift(lo: number, hi: number, size: number): number {
  if (lo < 0) return -lo;
  if (hi > size) return Math.max(-lo, size - hi);
  return 0;
}

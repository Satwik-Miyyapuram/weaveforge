import type { GNode } from "../application/build-graph-data";

/**
 * How big a node and its label draw at a zoom, in graph units. Plain and stamp
 * nodes share it, and every stroke is a fraction of the drawn size, so an
 * outline never outgrows its node however far in the camera goes.
 */
export interface NodeSize {
  r: number;
  /** Outline width. */
  line: number;
  /** The stamp's offset shadow. */
  drop: number;
  /** Pointer radius: the drawn shape plus its outline, never under 7px on screen. */
  hit: number;
}

export interface LabelSize {
  font: number;
  /** The stamp tag's border. */
  line: number;
  /** Space between the node and its label. */
  gap: number;
}

const LINE = 0.14;
const DROP = 0.22;
const LABEL_LINE = 0.1;
const MIN_HIT_PX = 7;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function nodeSize(baseR: number, kind: GNode["kind"], zoom: number, bounded = true): NodeSize {
  const z = Math.max(0.01, zoom);
  if (bounded) {
    const R = Math.max(5, baseR * clamp(z ** 0.45, 0.6, 3.2));
    const r = R / z;
    const line = Math.max(1.2, R * 0.13) / z;
    return { r, line, drop: Math.max(1.5, R * 0.18) / z, hit: Math.max(r + line, MIN_HIT_PX / z) };
  }
  const r = baseR;
  const line = r * LINE;
  return { r, line, drop: r * DROP, hit: Math.max(r + line, MIN_HIT_PX / z) };
}

export function labelSize(kind: GNode["kind"], zoom: number, bounded = true): LabelSize {
  const z = Math.max(0.01, zoom);
  const screen = kind === "tag" ? 10 : 10.5;
  if (bounded) {
    const font = (screen * clamp(z ** 0.35, 0.85, 2.2)) / z;
    return { font, line: Math.max(1, font * z * 0.09) / z, gap: 2 / z };
  }
  const font = Math.max(kind === "tag" ? 4 : 4.5, screen / z);
  return { font, line: font * LABEL_LINE, gap: font * 0.2 };
}

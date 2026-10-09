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

const MIN_SCREEN_R = 4;
const MAX_SCREEN_R = { tag: 16, other: 18 };
/** Screen size grows with zoom to this power: far gentler than the camera's 1. */
const GROWTH = 0.15;
const LINE = 0.14;
const DROP = 0.22;
const LABEL_LINE = 0.1;
const MIN_HIT_PX = 7;

export function nodeSize(baseR: number, kind: GNode["kind"], zoom: number, bounded = true): NodeSize {
  const z = Math.max(0.01, zoom);
  let r = baseR;
  if (bounded) {
    const max = kind === "tag" ? MAX_SCREEN_R.tag : MAX_SCREEN_R.other;
    r = Math.max(MIN_SCREEN_R, Math.min(max, baseR * Math.pow(Math.max(0.35, z), GROWTH))) / z;
  }
  const line = r * LINE;
  return { r, line, drop: r * DROP, hit: Math.max(r + line, MIN_HIT_PX / z) };
}

export function labelSize(kind: GNode["kind"], zoom: number, bounded = true): LabelSize {
  const z = Math.max(0.01, zoom);
  const screen = kind === "tag" ? 10 : 10.5;
  const font = bounded ? screen / z : Math.max(kind === "tag" ? 4 : 4.5, screen / z);
  return { font, line: font * LABEL_LINE, gap: font * 0.2 };
}

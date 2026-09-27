import { forceX, forceY } from "d3-force";

import type { GNode } from "../application/build-graph-data";

/** The pull towards the middle: always a little, more as Center goes up. */
const GRAVITY_BASE = 0.02;
const GRAVITY_PER_CENTER = 0.25;

/**
 * A real pull towards the middle for every node, set as the `x` and `y` forces.
 *
 * The center force only shifts the whole graph back to the middle; it pulls no
 * node in. Without a real pull, papers with no links are pushed apart by repel
 * for as long as the simulation runs, so every slider change (which reheats it)
 * spread them further and the layout depended on how often you had touched it,
 * not on the settings. A weak pull gives every setting one resting shape, the
 * same as a reload.
 */
export function setGravity(d3Force: (name: string, force?: unknown) => unknown, center: number): void {
  const gravity = GRAVITY_BASE + center * GRAVITY_PER_CENTER;
  d3Force("x", forceX<GNode>(0).strength(gravity));
  d3Force("y", forceY<GNode>(0).strength(gravity));
}

"use client";

import { useEffect } from "react";

/**
 * The two ways the graph view follows the reader.
 *
 * Both were effects inside `graph-canvas.tsx`, which is the file nearest the
 * 800-line limit in this repository; they are the graph's *camera*, not its
 * drawing, so they live beside it instead of inside it.
 */

/** The little that centring needs of a node; the canvas's own type satisfies it. */
interface Positioned {
  id: string;
  x?: number | null;
  y?: number | null;
}

/** The ForceGraph handle's camera, as loosely as it can be typed from here. */
interface Camera {
  centerAt?: (x: number, y: number, ms?: number) => void;
  zoom?: (k: number, ms?: number) => void;
}

/**
 * Move the view to the node the side panel just picked.
 *
 * Choosing a paper in the panel's Papers list re-seeds the graph around that
 * node, but a seed somewhere off-screen looks like the click did nothing, and
 * the panel swapping to the paper is easy to miss. The view moves to it the way
 * it moves to a search hit. One tick later, because a freshly seeded node has no
 * coordinates until the layout has placed it.
 */
export function useFollowSeed(
  localSeed: string | null,
  nodes: readonly Positioned[],
  cameraRef: { current: unknown },
  autoFitRef: { current: boolean },
  delayMs = 250,
): void {
  useEffect(() => {
    if (!localSeed) return;
    const timer = setTimeout(() => {
      const node = nodes.find((n) => n.id === localSeed);
      if (node?.x == null || node.y == null) return;
      const camera = cameraRef.current as Camera | null;
      autoFitRef.current = false;
      camera?.centerAt?.(node.x, node.y, 400);
      camera?.zoom?.(1.2, 400);
    }, delayMs);
    return () => clearTimeout(timer);
  }, [localSeed, nodes, cameraRef, autoFitRef, delayMs]);
}

/**
 * Escape leaves the selected edge.
 *
 * The popover's close is a small ✕ in its corner and nothing else clears the
 * selection — a click on the background lands on the graph, which either keeps
 * the popover or opens another one, so the edge state looked impossible to
 * leave. Escape is what closes every other overlay in the app. `onEscape` has to
 * be stable; a fresh closure per render would re-subscribe on every frame.
 */
export function useEscapeToClear(active: boolean, onEscape: () => void): void {
  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onEscape();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, onEscape]);
}

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

export interface FgHandle {
  refresh?: () => void;
  zoomToFit?: (ms?: number, padding?: number) => void;
  getGraphBbox?: () => { x: [number, number]; y: [number, number] } | null;
  centerAt?: (x?: number, y?: number, ms?: number) => void;
  zoom?: (k?: number, ms?: number) => void;
  d3ReheatSimulation?: () => void;
  d3Force?: (
    name: string,
    force?: unknown,
  ) => {
    strength?: (v: number) => void;
    distance?: (v: number) => void;
  } | undefined;
}

export function fitPadding(width: number, height: number): number {
  return Math.max(72, Math.round(Math.min(width, height) * 0.1));
}

export function fitGraphView(fg: FgHandle, nodes: { x?: number; y?: number }[], width: number, height: number, ms = 0): boolean {
  if (nodes.length === 0) return false;
  if (!nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y))) return false;
  const pad = fitPadding(width, height);
  const labelMargin = 42;
  const bbox = fg.getGraphBbox?.();
  if (!bbox) {
    fg.zoomToFit?.(ms, pad + labelMargin);
    return true;
  }
  const xSpan = Math.max(bbox.x[1] - bbox.x[0] + labelMargin * 2, 1);
  const ySpan = Math.max(bbox.y[1] - bbox.y[0] + labelMargin * 2, 1);
  const cx = (bbox.x[0] + bbox.x[1]) / 2;
  const cy = (bbox.y[0] + bbox.y[1]) / 2;
  const zoomK = Math.min((width - pad * 2) / xSpan, (height - pad * 2) / ySpan);
  fg.centerAt?.(cx, cy, ms);
  fg.zoom?.(Math.min(Math.max(zoomK, 0.04), 2.5), ms);
  return true;
}

/** Reuse simulation node objects so x/y/vx/vy survive graph updates. */
export function mergeSimNodes<T extends { id: string; label: string; val: number; color: string; kind: string; paperId?: string; noteId?: string; tagName?: string; x?: number; y?: number; fx?: number; fy?: number }>(
  incoming: T[],
  cache: Map<string, T>,
  pinned: Map<string, { x: number; y: number }>,
  laneX: ((node: T) => number | null) | null,
): T[] {
  const next = new Map<string, T>();
  for (const n of incoming) {
    const prev = cache.get(n.id);
    const node: T = prev
      ? { ...prev, label: n.label, val: n.val, color: n.color, kind: n.kind, paperId: n.paperId, noteId: n.noteId, tagName: n.tagName }
      : { ...n };
    const pin = pinned.get(n.id);
    const lane = laneX?.(node) ?? null;
    if (pin) {
      node.fx = pin.x;
      node.fy = pin.y;
    } else if (lane !== null) {
      node.fx = lane;
      delete node.fy;
    } else {
      delete node.fx;
      delete node.fy;
    }
    next.set(n.id, node);
  }
  cache.clear();
  for (const [id, node] of next) cache.set(id, node);
  return [...next.values()];
}


/**
 * Pure changes to a freeform page's file: move, patch, remove, add. Each returns
 * a new file and leaves the input alone, so the editor can keep a history of
 * whole-file snapshots (`canvas-history.ts`).
 */

import { setInk, type CanvasFile, type RawCanvasNode } from "./canvas-doc";
import { readInk, type InkStroke } from "./freeform-ink";

/** The ink strokes the file holds, malformed ones dropped. */
export function strokesOf(file: CanvasFile): InkStroke[] {
  return readInk(file.wfInk);
}

/** Moves the nodes and strokes in `ids` by a whole number of page pixels from their stored place. */
export function moveItems(file: CanvasFile, ids: ReadonlySet<string>, dx: number, dy: number): CanvasFile {
  const nodes = file.nodes.map((node) =>
    ids.has(node.id) ? { ...node, x: Math.round(node.x + dx), y: Math.round(node.y + dy) } : node,
  );
  const strokes = strokesOf(file).map((stroke) =>
    ids.has(stroke.id) ? { ...stroke, x: stroke.x + dx, y: stroke.y + dy } : stroke,
  );
  return setInk({ ...file, nodes }, strokes);
}

/** Sets fields on one node. */
export function patchNode(file: CanvasFile, id: string, patch: Partial<RawCanvasNode>): CanvasFile {
  return { ...file, nodes: file.nodes.map((node) => (node.id === id ? { ...node, ...patch } : node)) };
}

/** Removes the nodes and strokes in `ids`, and any edge that ends at a removed node. */
export function removeItems(file: CanvasFile, ids: ReadonlySet<string>): CanvasFile {
  const nodes = file.nodes.filter((node) => !ids.has(node.id));
  const gone = new Set(file.nodes.filter((node) => ids.has(node.id)).map((node) => node.id));
  const edges = file.edges.filter((edge) => !gone.has(edge.fromNode) && !gone.has(edge.toNode));
  const strokes = strokesOf(file).filter((stroke) => !ids.has(stroke.id));
  return setInk({ ...file, nodes, edges }, strokes);
}

export function addNode(file: CanvasFile, node: RawCanvasNode): CanvasFile {
  return { ...file, nodes: [...file.nodes, node] };
}

export function addStroke(file: CanvasFile, stroke: InkStroke): CanvasFile {
  return setInk(file, [...strokesOf(file), stroke]);
}

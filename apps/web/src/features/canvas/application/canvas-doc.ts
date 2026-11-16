/**
 * A canvas note's body (JSON Canvas 1.0, as Obsidian writes it) mapped to the
 * nodes and edges the canvas editor draws, and back.
 *
 * Every node and edge keeps the object it was read from (`data.raw`), so a
 * field this editor does not know — a later spec version's, or a plugin's such
 * as Advanced Canvas's `styleAttributes` — is written back untouched. The text
 * layout itself (tabs, one node per line, key order) is the Rust core's job:
 * `normalizeCanvasText` in wf-core `canvas`.
 */

/** A node as stored: the spec's fields plus whatever else the file carried. */
export interface RawCanvasNode {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  file?: string;
  subpath?: string;
  url?: string;
  label?: string;
  color?: string;
  [field: string]: unknown;
}

/** An edge as stored. `toEnd` defaults to `arrow`, `fromEnd` to `none`. */
export interface RawCanvasEdge {
  id: string;
  fromNode: string;
  toNode: string;
  fromSide?: string;
  toSide?: string;
  fromEnd?: string;
  toEnd?: string;
  label?: string;
  color?: string;
  [field: string]: unknown;
}

/** A whole canvas file, top-level plugin fields included. */
export interface CanvasFile {
  nodes: RawCanvasNode[];
  edges: RawCanvasEdge[];
  [field: string]: unknown;
}

/** The body of a canvas with nothing on it, byte for byte as Obsidian writes it. */
export const EMPTY_CANVAS_TEXT = '{\n\t"nodes":[],\n\t"edges":[]\n}';

/** The node kinds the editor draws; `unknown` is a later version's, shown as a plain box. */
export type CanvasNodeKind = "text" | "file" | "link" | "group" | "unknown";

const KNOWN_KINDS = new Set<string>(["text", "file", "link", "group"]);

export interface CanvasFlowNode {
  id: string;
  type: CanvasNodeKind;
  position: { x: number; y: number };
  width: number;
  height: number;
  /** Groups draw behind everything else, as in Obsidian. */
  zIndex: number;
  data: { raw: RawCanvasNode };
}

export interface CanvasFlowEdge {
  id: string;
  source: string;
  target: string;
  /** The side the edge leaves from; the handle ids are the spec's side names. */
  sourceHandle?: string | null;
  targetHandle?: string | null;
  label?: string;
  color?: string;
  markerStart: boolean;
  markerEnd: boolean;
  data: { raw: RawCanvasEdge };
}

/** What `fromFlow` reads off a node: React Flow's nodes satisfy it as they are. */
export interface NodeLike {
  id: string;
  position: { x: number; y: number };
  width?: number | null;
  height?: number | null;
  data: { raw: RawCanvasNode };
}

/** What `fromFlow` reads off an edge; a new edge has no `raw` yet. */
export interface EdgeLike {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  data?: { raw: RawCanvasEdge };
}

function notACanvas(): Error {
  return new Error("This note's body is not a canvas (JSON Canvas needs an object with nodes and edges).");
}

/** Reads a canvas body. A blank body is an empty canvas; other JSON throws. */
export function parseCanvasFile(text: string): CanvasFile {
  if (text.trim() === "") return { nodes: [], edges: [] };
  const value: unknown = JSON.parse(text);
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw notACanvas();
  const file = value as Record<string, unknown>;
  const nodes = file.nodes ?? [];
  const edges = file.edges ?? [];
  if (!Array.isArray(nodes) || !Array.isArray(edges)) throw notACanvas();
  return { ...file, nodes: nodes as RawCanvasNode[], edges: edges as RawCanvasEdge[] };
}

/** The canvas as the editor draws it. */
export function toFlow(file: CanvasFile): { nodes: CanvasFlowNode[]; edges: CanvasFlowEdge[] } {
  const nodes = file.nodes.map<CanvasFlowNode>((raw) => ({
    id: raw.id,
    type: KNOWN_KINDS.has(raw.type) ? (raw.type as CanvasNodeKind) : "unknown",
    position: { x: raw.x, y: raw.y },
    width: raw.width,
    height: raw.height,
    zIndex: raw.type === "group" ? 0 : 1,
    data: { raw },
  }));
  const edges = file.edges.map<CanvasFlowEdge>((raw) => ({
    id: raw.id,
    source: raw.fromNode,
    target: raw.toNode,
    sourceHandle: raw.fromSide ?? null,
    targetHandle: raw.toSide ?? null,
    ...(raw.label !== undefined ? { label: raw.label } : {}),
    ...(raw.color !== undefined ? { color: raw.color } : {}),
    markerStart: raw.fromEnd === "arrow",
    markerEnd: (raw.toEnd ?? "arrow") === "arrow",
    data: { raw },
  }));
  return { nodes, edges };
}

/** A number kept as read when it did not change, else rounded as Obsidian writes it. */
function settle(next: number | null | undefined, stored: number): number {
  if (next === undefined || next === null || next === stored) return stored;
  return Math.round(next);
}

/**
 * The file the editor's state stands for. Nodes and edges keep the editor's
 * order; an edge whose node was deleted goes with it (an edge that already
 * pointed at nothing in the file is kept, so a save loses nothing it did not
 * cause). Top-level fields come from `file`.
 */
export function fromFlow(file: CanvasFile, nodes: readonly NodeLike[], edges: readonly EdgeLike[]): CanvasFile {
  const present = new Set(nodes.map((n) => n.id));
  const removed = new Set(file.nodes.map((n) => n.id).filter((id) => !present.has(id)));
  const outNodes = nodes.map<RawCanvasNode>((node) => {
    const raw = node.data.raw;
    return {
      ...raw,
      id: node.id,
      x: settle(node.position.x, raw.x),
      y: settle(node.position.y, raw.y),
      width: settle(node.width, raw.width),
      height: settle(node.height, raw.height),
    };
  });
  const outEdges = edges
    .filter((edge) => !removed.has(edge.source) && !removed.has(edge.target))
    .map<RawCanvasEdge>((edge) => {
      const out: RawCanvasEdge = { ...(edge.data?.raw ?? {}), id: edge.id, fromNode: edge.source, toNode: edge.target };
      if (edge.sourceHandle) out.fromSide = edge.sourceHandle;
      else delete out.fromSide;
      if (edge.targetHandle) out.toSide = edge.targetHandle;
      else delete out.toSide;
      return out;
    });
  return { ...file, nodes: outNodes, edges: outEdges };
}

/** A 16-hex-digit id, the shape Obsidian gives nodes and edges. */
export function newCanvasId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

const DEFAULT_SIZE: Record<Exclude<CanvasNodeKind, "unknown">, { width: number; height: number }> = {
  text: { width: 250, height: 60 },
  file: { width: 400, height: 400 },
  link: { width: 400, height: 400 },
  group: { width: 400, height: 300 },
};

/** A new node of `kind` at `at`, with its required field (`text`, `file`, `url`, or a group's label). */
export function makeNode(
  kind: Exclude<CanvasNodeKind, "unknown">,
  at: { x: number; y: number },
  fields: Partial<RawCanvasNode> = {},
): RawCanvasNode {
  const required =
    kind === "text" ? { text: "" } : kind === "file" ? { file: "" } : kind === "link" ? { url: "" } : { label: "Group" };
  return {
    id: newCanvasId(),
    type: kind,
    ...required,
    x: Math.round(at.x),
    y: Math.round(at.y),
    ...DEFAULT_SIZE[kind],
    ...fields,
  };
}

/** `nodes` with the ones in `ids` shifted by `delta` (a group dragging its members). */
export function moveMembers<N extends { id: string; position: { x: number; y: number } }>(
  nodes: readonly N[],
  ids: readonly string[],
  delta: { x: number; y: number },
): N[] {
  const members = new Set(ids);
  return nodes.map((node) =>
    members.has(node.id)
      ? { ...node, position: { x: node.position.x + delta.x, y: node.position.y + delta.y } }
      : node,
  );
}

/**
 * The nodes a drag of `dragged` carries along: the members of every group
 * being dragged, each once, minus the nodes being dragged themselves (React
 * Flow moves those already).
 */
export function groupCarry(
  dragged: readonly { id: string; type?: string }[],
  membersOf: (groupId: string) => readonly string[],
): string[] {
  const moving = new Set(dragged.map((node) => node.id));
  const carried = new Set<string>();
  for (const group of dragged) {
    if (group.type !== "group") continue;
    for (const id of membersOf(group.id)) if (!moving.has(id)) carried.add(id);
  }
  return [...carried];
}

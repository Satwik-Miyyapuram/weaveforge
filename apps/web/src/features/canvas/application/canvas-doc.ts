/**
 * A freeform page's body: JSON Canvas 1.0 (as Obsidian writes it) plus the
 * top-level `wfInk` strokes (see `freeform-ink.ts`).
 *
 * The editor keeps the parsed file and changes it by spreading, so every field
 * it does not touch (a plugin's `styleAttributes`, a later spec's keys, edges it
 * only draws) is written back as it was read. The text layout itself (tabs, one
 * node per line, key order) is the Rust core's job: `normalizeCanvasText`.
 */

import { unreadInk, type InkStroke } from "./freeform-ink";

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

/** A whole canvas file, top-level plugin fields and `wfInk` included. */
export interface CanvasFile {
  nodes: RawCanvasNode[];
  edges: RawCanvasEdge[];
  wfInk?: unknown[];
  [field: string]: unknown;
}

/** The body of a canvas with nothing on it, byte for byte as Obsidian writes it. */
export const EMPTY_CANVAS_TEXT = '{\n\t"nodes":[],\n\t"edges":[]\n}';

/** The node kinds the page draws; `unknown` is a later version's, shown as a plain card. */
export type CanvasNodeKind = "text" | "file" | "link" | "group" | "unknown";

const KNOWN_KINDS = new Set<string>(["text", "file", "link", "group"]);

/** The kind the page draws a node as. */
export function nodeKind(raw: RawCanvasNode): CanvasNodeKind {
  return KNOWN_KINDS.has(raw.type) ? (raw.type as CanvasNodeKind) : "unknown";
}

const LABEL_LENGTH = 40;

/** A short name for a card, for screen readers: its kind and the start of its content. */
export function nodeLabel(raw: RawCanvasNode): string {
  switch (nodeKind(raw)) {
    case "text": {
      const line = (raw.text ?? "").split("\n")[0]?.trim() ?? "";
      if (!line) return "Text: empty";
      return `Text: ${line.length > LABEL_LENGTH ? `${line.slice(0, LABEL_LENGTH)}…` : line}`;
    }
    case "file":
      return `File: ${(raw.file ?? "").split("/").pop() || "no file"}`;
    case "link":
      return `Link: ${raw.url || "no address"}`;
    case "group":
      return raw.label ? `Group: ${raw.label}` : "Group";
    default:
      return `${raw.type} node`;
  }
}

const DEFAULT_BOX = { width: 320, height: 40 };

/** The box a node is drawn in. A missing or non-numeric coordinate is drawn at 0, never NaN. */
export function nodeBox(raw: RawCanvasNode): { x: number; y: number; width: number; height: number } {
  return {
    x: finiteOr(raw.x, 0),
    y: finiteOr(raw.y, 0),
    width: finiteOr(raw.width, DEFAULT_BOX.width),
    height: finiteOr(raw.height, DEFAULT_BOX.height),
  };
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
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

/** The file with its ink replaced. No strokes means no `wfInk` field at all. */
export function setInk(file: CanvasFile, strokes: readonly InkStroke[]): CanvasFile {
  const { wfInk: previous, ...rest } = file;
  if (previous !== undefined && !Array.isArray(previous) && strokes.length === 0) return file;
  const ink = [...unreadInk(previous), ...strokes];
  return ink.length === 0 ? (rest as CanvasFile) : { ...rest, wfInk: ink };
}

export function newCanvasId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** A new node of `kind` at `at` (rounded to whole page pixels), with the field its kind needs. */
export function makeNode(
  kind: Exclude<CanvasNodeKind, "unknown">,
  at: { x: number; y: number },
  size: { width: number; height: number },
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
    width: size.width,
    height: size.height,
    ...fields,
  };
}

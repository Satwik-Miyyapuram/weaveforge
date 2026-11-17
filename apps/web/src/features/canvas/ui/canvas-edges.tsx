"use client";

import { nodeBox, type RawCanvasEdge, type RawCanvasNode } from "../application/canvas-doc";

/** Where an edge leaves or enters a box: the middle of the named side, or the centre when no side is named. */
export function anchorOf(box: { x: number; y: number; width: number; height: number }, side?: string): { x: number; y: number } {
  const { x, y, width, height } = box;
  switch (side) {
    case "top":
      return { x: x + width / 2, y };
    case "right":
      return { x: x + width, y: y + height / 2 };
    case "bottom":
      return { x: x + width / 2, y: y + height };
    case "left":
      return { x, y: y + height / 2 };
    default:
      return { x: x + width / 2, y: y + height / 2 };
  }
}

/** A preset colour (`1`..`6`) is styled by the theme; a hex one is the file's own. */
function colorProps(color: string | undefined): { attr?: string; style?: { stroke: string } } {
  if (!color) return {};
  if (/^[1-6]$/.test(color)) return { attr: color };
  return { style: { stroke: color } };
}

/**
 * Straight lines between the nodes an edge joins, read-only. JSON Canvas draws
 * an arrow at the `toEnd` unless it is `none`, and at `fromEnd` only when it is `arrow`.
 */
export function EdgeLayer({ nodes, edges }: { nodes: readonly RawCanvasNode[]; edges: readonly RawCanvasEdge[] }) {
  const boxes = new Map(nodes.map((node) => [node.id, nodeBox(node)]));
  return (
    <svg className="canvas-edges" aria-hidden="true">
      <defs>
        <marker id="canvas-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
          <path d="M0 0L10 5L0 10z" className="canvas-edges__arrow" />
        </marker>
      </defs>
      {edges.map((edge) => {
        const from = boxes.get(edge.fromNode);
        const to = boxes.get(edge.toNode);
        if (!from || !to) return null;
        const a = anchorOf(from, edge.fromSide);
        const b = anchorOf(to, edge.toSide);
        const colour = colorProps(edge.color);
        const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        return (
          <g key={edge.id}>
            <line
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              className="canvas-edges__line"
              data-color={colour.attr}
              style={colour.style}
              markerEnd={edge.toEnd === "none" ? undefined : "url(#canvas-arrow)"}
              markerStart={edge.fromEnd === "arrow" ? "url(#canvas-arrow)" : undefined}
            />
            {edge.label ? (
              <text x={middle.x} y={middle.y} className="canvas-edges__label" textAnchor="middle">
                {edge.label}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

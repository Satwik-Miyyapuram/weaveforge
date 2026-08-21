"use client";

import { RELATION_COLORS, NOTE_COLOR, REPORT_COLOR, tagColor } from "@/features/relations/domain/graph-palette";
import css from "./pitch.module.css";

/** Reading-status colours, as the graph screen assigns them. */
export const STATUS_COLORS: Record<string, string> = {
  to_read: "#b9b2a6",
  reading: "#7c9885",
  read: "#5a7d8c",
  skimmed: "#c98a6b",
};

export type Node = {
  id: string;
  label: string;
  step: number;
  kind?: "paper" | "tag" | "note" | "report";
  status?: keyof typeof STATUS_COLORS;
  hub?: boolean;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
};

export const NODES: Node[] = [
  { id: "mine", label: "Your Method", step: 0, status: "reading", hub: true },
  { id: "bvae", label: "β-VAE", step: 0, status: "read" },
  { id: "vae", label: "Kingma 2014", step: 0, status: "read" },
  { id: "vgae", label: "VGAE", step: 1, status: "read" },
  { id: "gcn", label: "Kipf 2017", step: 1, status: "skimmed" },
  { id: "notes", label: "reading cluster", step: 1, kind: "note" },
  { id: "t-dis", label: "#disentanglement", step: 1, kind: "tag" },
  { id: "t-gp", label: "#graph-prior", step: 1, kind: "tag" },
  { id: "factor", label: "FactorVAE", step: 2, status: "to_read" },
  { id: "chall", label: "Locatello 2019", step: 2, status: "read" },
  { id: "sec", label: "3.2 graph-prior", step: 2, kind: "report" },
  { id: "new", label: "new citation", step: 3, status: "reading" },
];

/** [from, to, relation, revealed-at-step] — relations from the showcase seed. */
export const EDGES: [string, string, keyof typeof RELATION_COLORS | "", number][] = [
  ["mine", "bvae", "extends", 0],
  ["bvae", "vae", "extends", 0],
  ["mine", "vgae", "builds_on", 1],
  ["vgae", "gcn", "uses_method", 1],
  ["notes", "bvae", "", 1],
  ["mine", "t-gp", "", 1],
  ["vgae", "t-gp", "", 1],
  ["bvae", "t-dis", "", 1],
  ["mine", "t-dis", "", 1],
  ["factor", "bvae", "extends", 2],
  ["chall", "bvae", "contradicts", 2],
  ["chall", "factor", "cites", 2],
  ["sec", "mine", "", 2],
  ["new", "mine", "cites", 3],
];

export function nodeFill(n: Node): string {
  if (n.kind === "tag") return tagColor(n.label.replace(/^#/, ""));
  if (n.kind === "note") return NOTE_COLOR;
  if (n.kind === "report") return REPORT_COLOR;
  return STATUS_COLORS[n.status ?? "read"] ?? STATUS_COLORS.read!;
}

/** A node once the layout has run: position is no longer optional. */
export type Placed = Omit<Node, "x" | "y" | "vx" | "vy"> & { x: number; y: number; vx: number; vy: number };

/**
 * Settle the graph once with a force pass. Running a live simulation while the
 * reader is reading is battery spent on nothing, so this happens at mount and
 * the result is drawn as static SVG that re-tints with the theme.
 */
export function layoutGraph(width: number, height: number) {
  const nodes: Placed[] = NODES.map((n, i) => ({
    ...n,
    x: width / 2 + Math.cos((i / NODES.length) * Math.PI * 2) * 130,
    y: height / 2 + Math.sin((i / NODES.length) * Math.PI * 2) * 100,
    vx: 0,
    vy: 0,
  }));
  const by = new Map(nodes.map((n) => [n.id, n]));
  const links = EDGES.flatMap(([a, b, kind, step]) => {
    const from = by.get(a), to = by.get(b);
    return from && to ? [{ a: from, b: to, kind, step }] : [];
  });

  for (let t = 0; t < 500; t++) {
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]!, b = nodes[j]!;
        const dx = b.x - a.x, dy = b.y - a.y;
        const d2 = dx * dx + dy * dy || 0.01;
        const d = Math.sqrt(d2);
        const f = 3400 / d2;
        a.vx -= (dx / d) * f; a.vy -= (dy / d) * f;
        b.vx += (dx / d) * f; b.vy += (dy / d) * f;
      }
    }
    for (const l of links) {
      const dx = l.b.x - l.a.x, dy = l.b.y - l.a.y;
      const d = Math.hypot(dx, dy) || 0.01;
      const f = (d - 92) * 0.015;
      l.a.vx += (dx / d) * f; l.a.vy += (dy / d) * f;
      l.b.vx -= (dx / d) * f; l.b.vy -= (dy / d) * f;
    }
    for (const n of nodes) {
      n.vx += (width / 2 - n.x) * 0.002;
      n.vy += (height / 2 - n.y) * 0.002;
      n.vx *= 0.85; n.vy *= 0.85;
      n.x = Math.max(60, Math.min(width - 60, n.x + n.vx));
      n.y = Math.max(30, Math.min(height - 34, n.y + n.vy));
    }
  }
  // Round before returning. The same simulation on the server and in the
  // browser can land on values that differ in the last float digit, and React
  // reports that as a hydration mismatch on every <line> in the graph.
  // Two decimals is far below a pixel and identical on both sides.
  for (const n of nodes) {
    n.x = Math.round(n.x * 100) / 100;
    n.y = Math.round(n.y * 100) / 100;
  }
  return { nodes, links };
}

/**
 * Drives the pinned visual from scroll position. Geometry is the source of
 * truth: whichever step's midpoint is nearest the reading line owns the stage.
 * An IntersectionObserver alone leaves the story stuck on step one whenever
 * its callbacks are throttled or delayed.
 */

export function Graph({ upto }: { upto: number }) {
  const W = 520, H = 360;
  const { nodes, links } = layoutGraph(W, H);
  return (
    <svg className={css.fig} viewBox={`0 0 ${W} ${H}`} role="img"
         aria-label="Citation graph: papers, concept tags and typed relations from the research library">
      {links.map((l, i) => (
        <line
          key={i}
          x1={l.a.x} y1={l.a.y} x2={l.b.x} y2={l.b.y}
          stroke={l.kind ? RELATION_COLORS[l.kind] : "var(--border-strong)"}
          strokeWidth={l.kind ? 1.8 : 1.2}
          opacity={l.step <= upto ? 1 : 0}
          style={{ transition: "opacity .5s ease" }}
        />
      ))}
      {nodes.map((n) => {
        const r = n.kind === "tag" ? 7 : n.hub ? 13 : 9;
        const fill = nodeFill(n);
        return (
          <g key={n.id} opacity={n.step <= upto ? 1 : 0} style={{ transition: "opacity .5s ease" }}>
            {n.kind === "tag" ? (
              <rect x={n.x - r} y={n.y - r} width={r * 2} height={r * 2} rx={2} fill={fill} />
            ) : n.kind === "note" ? (
              <polygon points={`${n.x},${n.y - r} ${n.x + r},${n.y} ${n.x},${n.y + r} ${n.x - r},${n.y}`} fill={fill} />
            ) : n.kind === "report" ? (
              <rect x={n.x - r * 0.9} y={n.y - r * 0.9} width={r * 1.8} height={r * 1.8} rx={3} fill={fill} />
            ) : (
              <circle cx={n.x} cy={n.y} r={r} fill={fill}
                      stroke={n.hub ? "var(--ink)" : "none"} strokeWidth={n.hub ? 2 : 0} />
            )}
            <text x={n.x} y={n.y + r + 13} textAnchor="middle" fill="var(--muted)"
                  fontSize={10} fontFamily="var(--font-mono)">{n.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

/**
 * A run's loss curve, drawn point by point.
 *
 * The numbers are a fixed series, not random: the same values render on the
 * server and in the browser, and only how many of them are visible changes.
 * Randomising here would trade a live feel for a hydration mismatch on every
 * point in the path.
 */

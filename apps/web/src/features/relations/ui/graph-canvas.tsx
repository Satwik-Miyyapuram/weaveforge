"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { forceCollide } from "d3-force";
import type {
  GraphViewSettings,
  Paper,
  PaperRelation,
  ReadingList,
  ReportSection,
  VaultPage,
} from "@weaveforge/core";
import {
  buildGraphData,
  type GLink,
  type GNode,
} from "../application/build-graph-data";
import { cloneLinks, filterGraphByNodes, localSubgraph } from "../application/local-graph";
import { EdgeDetailPopover } from "./graph-side-panel";

// Wrapper forwards the ref through an `innerRef` prop because next/dynamic's
// LoadableComponent drops a real `ref`, which would null out fgRef and silently
// disable d3Force/forceCollide/autoFit/refresh.
const ForceGraph2D = dynamic(() => import("./force-graph-2d"), { ssr: false });

interface FgHandle {
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

const FG = ForceGraph2D as unknown as React.ComponentType<
  Record<string, unknown> & { innerRef?: React.Ref<FgHandle> }
>;

const DIM = "rgba(140, 133, 124, 0.12)";
/** Canvas units between one publication year and the next in the timeline layout. */
const YEAR_SPACING = 90;

function fitPadding(width: number, height: number): number {
  return Math.max(72, Math.round(Math.min(width, height) * 0.1));
}

function fitGraphView(fg: FgHandle, nodes: GNode[], width: number, height: number, ms = 0) {
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
function mergeSimNodes(
  incoming: GNode[],
  cache: Map<string, GNode>,
  pinned: Map<string, { x: number; y: number }>,
  /**
   * Where a node belongs on the timeline, or null if it is not on one.
   *
   * Pinning x rather than pulling it there with a force, because a force loses.
   * `forceX` closes a fraction of the remaining gap each tick while the link
   * and charge forces pull the other way, and the pull from a single citation
   * across five years is enough to leave a paper the better part of a year out
   * of its lane — measured at up to 149px on a 90px spacing, which puts two
   * papers from the same year a full year apart. A timeline that is only
   * approximately chronological is worse than no timeline, because it still
   * invites you to read distance as time. Raising the strength does not fix
   * it; d3 treats strength above 1 as overshoot, and it still drifted 85px.
   */
  laneX: ((node: GNode) => number | null) | null,
): GNode[] {
  const next = new Map<string, GNode>();
  for (const n of incoming) {
    const prev = cache.get(n.id);
    const node: GNode = prev
      ? { ...prev, label: n.label, val: n.val, color: n.color, kind: n.kind, paperId: n.paperId, noteId: n.noteId, tagName: n.tagName }
      : { ...n };
    const pin = pinned.get(n.id);
    const lane = laneX?.(node) ?? null;
    if (pin) {
      // A node the reader pinned themselves stays exactly where they put it,
      // timeline or not. They asked for that position out loud.
      node.fx = pin.x;
      node.fy = pin.y;
    } else if (lane !== null) {
      node.fx = lane;
      // y stays free, so related work still finds its own height and the
      // clusters the forces produce survive.
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

export function GraphCanvas({
  papers,
  notes,
  sections = [],
  relations,
  settings,
  membership,
  lists,
  fill = false,
  localSeed,
  localDepth,
  pinned,
  onPinToggle,
  onNodeClick,
  onTagToPapers,
  onTagToNotes,
  onRefresh,
}: {
  papers: Paper[];
  notes: VaultPage[];
  sections?: ReportSection[];
  relations: PaperRelation[];
  settings: GraphViewSettings;
  membership: Map<string, Set<string>>;
  lists: ReadingList[];
  fill?: boolean;
  localSeed: string | null;
  localDepth: number;
  pinned: Map<string, { x: number; y: number }>;
  onPinToggle: (id: string, pos: { x: number; y: number } | null) => void;
  onNodeClick?: (node: GNode) => void;
  onTagToPapers?: (map: Map<string, string[]>) => void;
  onTagToNotes?: (map: Map<string, string[]>) => void;
  onRefresh?: () => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<FgHandle | null>(null);
  // ForceGraph2D is lazy-loaded (next/dynamic), so it mounts *after* this
  // component's effects first run — at which point fgRef.current is still null.
  // A plain ref never notifies us when the instance finally attaches, so the
  // effect that installs forceCollide / autoFit would early-return once and
  // never re-run, leaving nodes overlapping and unclickable. A callback ref
  // bumps state the moment the handle arrives, re-running those effects.
  const [fgReady, setFgReady] = useState(0);
  const setFgHandle = useCallback((inst: FgHandle | null) => {
    const had = fgRef.current;
    fgRef.current = inst;
    if (inst && !had) setFgReady((n) => n + 1);
  }, []);
  const simNodesRef = useRef<Map<string, GNode>>(new Map());
  const dataRef = useRef<{ nodes: GNode[]; links: GLink[] }>({ nodes: [], links: [] });
  const topologyRef = useRef("");
  /** Follow the layout with the camera until the user navigates on their own. */
  const autoFitRef = useRef(true);
  const zoomKRef = useRef(1);
  const hoverRef = useRef<{ nodeId: string | null; link: GLink | null }>({ nodeId: null, link: null });
  // Bounding boxes of labels already drawn this frame (graph space). Used to
  // suppress overlapping labels so dense clusters stay readable. Reset each
  // frame in onRenderFramePre.
  const labelBoxesRef = useRef<{ x1: number; y1: number; x2: number; y2: number }[]>([]);
  const hoverClearTimer = useRef<number | null>(null);
  const hoverPaintRaf = useRef<number | null>(null);
  const [linkTooltip, setLinkTooltip] = useState<GLink | null>(null);
  const [width, setWidth] = useState(760);
  const [measuredH, setMeasuredH] = useState(560);
  const [selectedEdge, setSelectedEdge] = useState<{ edge: PaperRelation; x: number; y: number } | null>(null);

  const height = fill
    ? measuredH
    : (() => {
        const vh = typeof window !== "undefined" ? window.innerHeight : 800;
        // Mobile: use more of the tall viewport; desktop caps at 560.
        const isNarrow = typeof window !== "undefined" && window.innerWidth < 900;
        return isNarrow
          ? Math.max(320, Math.round(vh * 0.72))
          : Math.min(560, Math.round(vh * 0.62));
      })();

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      if (!e) return;
      setWidth(Math.max(280, Math.round(e.contentRect.width)));
      if (fill) setMeasuredH(Math.max(240, Math.round(e.contentRect.height)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fill]);

  const autoFit = useCallback((ms = 0) => {
    const fg = fgRef.current;
    if (!fg || !autoFitRef.current) return;
    fitGraphView(fg, dataRef.current.nodes, width, height, ms);
  }, [width, height]);

  // Keep the whole graph in view while the container resizes, until the user
  // takes over. Also fires once the lazy FG instance attaches (fgReady).
  useEffect(() => { autoFit(); }, [autoFit, fgReady]);

  // Manual pan/zoom/drag hands camera control to the user.
  const stopAutoFit = useCallback(() => { autoFitRef.current = false; }, []);

  useEffect(() => () => {
    if (hoverClearTimer.current) window.clearTimeout(hoverClearTimer.current);
    if (hoverPaintRaf.current) window.cancelAnimationFrame(hoverPaintRaf.current);
  }, []);

  useEffect(() => {
    const fg = fgRef.current;
    if (!fg?.d3Force) return;
    fg.d3Force("charge")?.strength?.(settings.chargeStrength);
    fg.d3Force("link")?.distance?.(settings.linkDistance);
    fg.d3Force("center")?.strength?.(
      settings.layout === "timeline" ? settings.centerStrength * 0.2 : settings.centerStrength,
    );
    // Re-energise so the new forces take effect immediately. Reheating only
    // raises alpha — nodes keep their current positions and re-settle from
    // there, rather than snapping back to the centre.
    fg.d3ReheatSimulation?.();
  }, [settings.chargeStrength, settings.linkDistance, settings.centerStrength, settings.layout, fgReady]);

  // Rebuild graph data only when a field buildGraphData actually reads changes.
  // Depending on the whole `settings` object rebuilt the node array whenever a
  // physics slider (charge/link/center strength) moved, which handed
  // react-force-graph a fresh graphData and re-initialised the simulation from
  // the centre — losing the current layout. Those forces are applied live via
  // the d3Force effect instead, so they must NOT rebuild the data.
  const { data: rawData, neighbors, tagToPapers, tagToNotes } = useMemo(() => {
    return buildGraphData(papers, relations, settings, membership, lists, notes, sections);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    papers, relations, membership, lists, notes, sections,
    settings.edgeMode, settings.relationTypes, settings.showConcepts,
    settings.minConceptDegree, settings.showConceptCooccurrence, settings.hideOrphans,
    settings.nodeSize, settings.linkThickness, settings.showAutoStyle,
    settings.colorBy, settings.groupBy,
  ]);

  useEffect(() => {
    onTagToPapers?.(tagToPapers);
  }, [tagToPapers, onTagToPapers]);

  useEffect(() => {
    onTagToNotes?.(tagToNotes);
  }, [tagToNotes, onTagToNotes]);

  const localSet = useMemo(
    () => localSubgraph(localSeed, localDepth, neighbors),
    [localSeed, localDepth, neighbors],
  );

  const topologyKey = useMemo(() => {
    const filtered = filterGraphByNodes(rawData.nodes, rawData.links, localSet);
    const nodeIds = filtered.nodes.map((n) => n.id).sort().join(",");
    const linkIds = filtered.links.map((l) => l.id).sort().join(",");
    return `${nodeIds}|${linkIds}|${localSeed ?? ""}|${localDepth}`;
  }, [rawData, localSet, localSeed, localDepth]);

  /**
   * The timeline layout.
   *
   * Each paper's x is fixed to its publication year, so the graph reads left
   * to right as the field actually developed, while y is left to the forces —
   * related work still clumps vertically. On a citation graph that is a real
   * gain over a free layout: an arrow pointing left is influence flowing
   * backwards through time, and it is visible at a glance.
   *
   * Anything without a year — a tag, a note, a paper whose year nobody filled
   * in — is left alone rather than pinned to a guess. Defaulting the year
   * would stack every one of them in a single stripe and state a publication
   * date that does not exist.
   */
  const laneX = useMemo(() => {
    if (settings.layout !== "timeline") return null;
    const years = rawData.nodes
      .map((n) => n.year)
      .filter((y): y is number => typeof y === "number");
    if (years.length === 0) return null;
    // Centred on the middle of the collection, so a library of 2020s papers
    // does not start halfway across the canvas.
    const mid = Math.round(years.reduce((a, b) => a + b, 0) / years.length);
    return (node: GNode) =>
      typeof node.year === "number" ? (node.year - mid) * YEAR_SPACING : null;
  }, [settings.layout, rawData.nodes]);

  const data = useMemo(() => {
    const filtered = filterGraphByNodes(rawData.nodes, rawData.links, localSet);
    const nodes = mergeSimNodes(filtered.nodes, simNodesRef.current, pinned, laneX);
    const links = cloneLinks(filtered.links);
    return { nodes, links };
  }, [rawData, localSet, pinned, laneX]);

  dataRef.current = data;

  // Restart simulation when graph topology changes; refresh canvas on visual-only changes.
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    // Keep nodes from piling on top of each other. Overlapping nodes share the
    // same pixels in the pointer buffer, so only the top one stays clickable —
    // spacing them by a hair more than their hit radius keeps every node
    // reachable, including after the user drags things around.
    fg.d3Force?.(
      "collide",
      forceCollide<GNode>().radius((n) => Math.max(3, n.val) + 3).strength(0.9),
    );
    const topologyChanged = topologyRef.current !== topologyKey;
    topologyRef.current = topologyKey;
    if (topologyChanged) {
      autoFitRef.current = true;
      fg.d3ReheatSimulation?.();
      autoFit();
    }
    fg.refresh?.();
  }, [data, topologyKey, autoFit, fgReady]);

  const requestHoverPaint = useCallback(() => {
    const wrap = wrapRef.current;
    if (wrap) {
      wrap.style.cursor = hoverRef.current.nodeId || hoverRef.current.link ? "pointer" : "";
    }
    if (hoverPaintRaf.current != null) return;
    hoverPaintRaf.current = window.requestAnimationFrame(() => {
      hoverPaintRaf.current = null;
      fgRef.current?.refresh?.();
    });
  }, []);

  const setHoverNode = useCallback((id: string | null) => {
    if (hoverClearTimer.current) {
      window.clearTimeout(hoverClearTimer.current);
      hoverClearTimer.current = null;
    }
    if (id) {
      if (hoverRef.current.nodeId === id && !hoverRef.current.link) return;
      hoverRef.current = { nodeId: id, link: null };
      setLinkTooltip(null);
      requestHoverPaint();
      return;
    }
    hoverClearTimer.current = window.setTimeout(() => {
      hoverRef.current.nodeId = null;
      requestHoverPaint();
    }, 100);
  }, [requestHoverPaint]);

  const setHoverLink = useCallback((link: GLink | null) => {
    if (hoverClearTimer.current) {
      window.clearTimeout(hoverClearTimer.current);
      hoverClearTimer.current = null;
    }
    if (link) {
      if (hoverRef.current.link?.id === link.id) return;
      hoverRef.current = { nodeId: null, link };
      setLinkTooltip(link.kind === "rel" ? link : null);
      requestHoverPaint();
      return;
    }
    hoverClearTimer.current = window.setTimeout(() => {
      hoverRef.current.link = null;
      setLinkTooltip(null);
      requestHoverPaint();
    }, 100);
  }, [requestHoverPaint]);

  useEffect(() => {
    fgRef.current?.refresh?.();
  }, [settings.searchQuery, settings.textFadeThreshold, pinned]);

  const searchQ = settings.searchQuery.trim().toLowerCase();
  const searchHits = useMemo(() => {
    if (!searchQ) return null;
    const hits = new Set<string>();
    for (const n of data.nodes) {
      if (n.label.toLowerCase().includes(searchQ)) hits.add(n.id);
    }
    return hits;
  }, [data.nodes, searchQ]);

  const isSearchHit = (id: string) => !searchHits || searchHits.has(id);

  /**
   * What stays lit while the pointer is on a node.
   *
   * The complaint that sends people away from a graph like this one is that a
   * few hundred papers become an unreadable cloud — every node touching every
   * other, and no way to answer "what is this one actually connected to?"
   * without dragging it out of the crowd. Hovering answers it directly: the
   * node and everything one hop from it keep their colour, and the rest of the
   * graph drops back far enough to read the shape through.
   *
   * `neighbors` is built once alongside the graph data, so this is a map
   * lookup per hover rather than a walk over every link. That distinction
   * matters on a dense graph, where the obvious implementation runs the whole
   * edge list on every mousemove.
   */
  const lit = useCallback(
    (id: string): boolean => {
      const hovered = hoverRef.current.nodeId;
      if (!hovered) return true;
      if (id === hovered) return true;
      return neighbors.get(hovered)?.has(id) ?? false;
    },
    [neighbors],
  );

  /** A link survives the hover dim only if it is one of the hovered node's own. */
  const linkLit = useCallback((l: GLink): boolean => {
    const hovered = hoverRef.current.nodeId;
    if (!hovered) return true;
    const src = typeof l.source === "object" ? (l.source as GNode).id : l.source;
    const tgt = typeof l.target === "object" ? (l.target as GNode).id : l.target;
    return src === hovered || tgt === hovered;
  }, []);

  const nodeR = (n: GNode) => Math.max(3, n.val);
  // Hit target matches the drawn shape (plus a hair) so neighbouring hit areas
  // don't overlap and steal each other's clicks in the pointer buffer.
  //
  // But force-graph resolves clicks by sampling ONE pixel of an offscreen
  // buffer at pointerPos * devicePixelRatio. On Windows display scaling the DPR
  // is fractional (e.g. 1.5625), and a small zoomed-out node has no solid-colour
  // interior pixel — the sample lands on an anti-aliased edge, matches nothing,
  // and the node becomes unclickable. Enforce a minimum on-screen hit radius
  // (graph units = screen px / zoom) so there's always a pure-colour pixel to
  // hit. Collision spacing keeps this from overlapping neighbours in practice.
  const POINTER_MIN_SCREEN_PX = 7;
  const hoverR = useCallback(
    (n: GNode) => Math.max(nodeR(n) + 1, POINTER_MIN_SCREEN_PX / (zoomKRef.current || 1)),
    [],
  );

  const labelVisible = useCallback(
    (node: GNode) =>
      (!searchHits || searchHits.has(node.id)) &&
      (node.kind === "tag" ||
        node.id === hoverRef.current.nodeId ||
        zoomKRef.current > settings.textFadeThreshold),
    [settings.textFadeThreshold, searchHits],
  );

  const paintShape = useCallback(
    (node: GNode, ctx: CanvasRenderingContext2D, fillColor: string, r = nodeR(node)) => {
      ctx.beginPath();
      const x = node.x ?? 0;
      const y = node.y ?? 0;
      if (node.kind === "tag") {
        ctx.rect(x - r, y - r, r * 2, r * 2);
      } else if (node.kind === "note") {
        ctx.moveTo(x, y - r);
        ctx.lineTo(x + r, y);
        ctx.lineTo(x, y + r);
        ctx.lineTo(x - r, y);
        ctx.closePath();
      } else if (node.kind === "report") {
        const rr = r * 0.9;
        if (typeof ctx.roundRect === "function") {
          ctx.roundRect(x - rr, y - rr, rr * 2, rr * 2, 3);
        } else {
          ctx.rect(x - rr, y - rr, rr * 2, rr * 2);
        }
      } else {
        ctx.arc(x, y, r, 0, 2 * Math.PI);
      }
      ctx.fillStyle = fillColor;
      ctx.fill();
    },
    [],
  );

  const css = typeof window !== "undefined" ? getComputedStyle(document.documentElement) : null;
  const inkColor = css?.getPropertyValue("--ink").trim() || "#2c2a26";
  const fontFamily = css?.getPropertyValue("--font").trim() || "sans-serif";

  const relationById = useMemo(() => new Map(relations.map((e) => [e.id, e])), [relations]);

  const resolveGraphNode = useCallback(
    (ref: string | GNode): GNode | undefined => {
      const id = typeof ref === "object" ? ref.id : ref;
      return data.nodes.find((n) => n.id === id);
    },
    [data.nodes],
  );

  // The hit target is the node's own shape only. Painting the wide label
  // rectangle as a hit area let neighbouring labels overlap and cover adjacent
  // nodes' circles, making those nodes unclickable.
  const paintNodeHitArea = useCallback(
    (node: GNode, color: string, ctx: CanvasRenderingContext2D) => {
      paintShape(node, ctx, color, hoverR(node));
    },
    [hoverR, paintShape],
  );

  const paintLinkHitArea = useCallback((link: GLink, color: string, ctx: CanvasRenderingContext2D) => {
    const src = resolveGraphNode(link.source as string | GNode);
    const tgt = resolveGraphNode(link.target as string | GNode);
    if (!src || !tgt || src.x == null || src.y == null || tgt.x == null || tgt.y == null) return;
    const sx = src.x;
    const sy = src.y;
    const tx = tgt.x;
    const ty = tgt.y;
    // Keep the hit stroke close to the drawn width so bundled edges meeting at
    // a shared node don't overlap and overwrite each other in the pointer
    // buffer, which would leave only the last-painted edge clickable.
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(2.5, link.width * 2.5);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    if (link.kind === "rel") {
      const mx = (sx + tx) / 2;
      const my = (sy + ty) / 2;
      const dx = tx - sx;
      const dy = ty - sy;
      const dist = Math.hypot(dx, dy) || 1;
      const bend = 0.18 * dist;
      ctx.quadraticCurveTo(mx + (-dy / dist) * bend, my + (dx / dist) * bend, tx, ty);
    } else {
      ctx.lineTo(tx, ty);
    }
    ctx.stroke();
  }, [resolveGraphNode]);

  const handleNodeClick = useCallback(
    (node: GNode, ev: MouseEvent) => {
      if (ev.detail === 2 && node.x != null && node.y != null) {
        onPinToggle(node.id, pinned.has(node.id) ? null : { x: node.x, y: node.y });
        return;
      }
      onNodeClick?.(node);
    },
    [onNodeClick, onPinToggle, pinned],
  );

  const handleNodeContext = useCallback((node: GNode, ev: MouseEvent) => {
    ev.preventDefault();
    if (node.x == null || node.y == null) return;
    onPinToggle(node.id, { x: node.x, y: node.y });
  }, [onPinToggle]);

  const handleLinkClick = useCallback(
    (link: GLink, ev: MouseEvent) => {
      if (link.kind === "rel" && link.relationId) {
        const edge = relationById.get(link.relationId);
        if (edge) {
          setSelectedEdge({ edge, x: ev.clientX, y: ev.clientY });
          return;
        }
      }
      const src = resolveGraphNode(link.source as string | GNode);
      const tgt = resolveGraphNode(link.target as string | GNode);
      const pick = tgt?.kind === "tag" ? tgt : src?.kind === "tag" ? src : tgt ?? src;
      if (pick) handleNodeClick(pick, ev);
    },
    [relationById, resolveGraphNode, handleNodeClick],
  );

  const centerOnSearch = useCallback(() => {
    if (!searchHits || searchHits.size === 0) return;
    const first = data.nodes.find((n) => searchHits.has(n.id));
    if (first?.x != null && first?.y != null) {
      autoFitRef.current = false;
      fgRef.current?.centerAt?.(first.x, first.y, 400);
      fgRef.current?.zoom?.(1.2, 400);
    }
  }, [searchHits, data.nodes]);

  useEffect(() => {
    if (searchHits && searchHits.size > 0) centerOnSearch();
  }, [searchHits, centerOnSearch]);

  return (
    <div
      className={`graph-wrap${fill ? " fill" : ""}`}
      ref={wrapRef}
      onPointerDownCapture={stopAutoFit}
      onWheelCapture={stopAutoFit}
    >
      <FG
        innerRef={setFgHandle}
        graphData={data}
        nodeId="id"
        width={width}
        height={height}
        backgroundColor="transparent"
        nodeRelSize={4}
        nodeVal={(n: GNode) => n.val}
        cooldownTicks={300}
        warmupTicks={80}
        d3VelocityDecay={0.35}
        d3AlphaDecay={0.028}
        d3AlphaMin={0.001}
        autoPauseRedraw={false}
        enableNodeDrag={true}
        linkHoverPrecision={6}
        onZoom={(t: { k: number }) => { zoomKRef.current = t.k; }}
        onEngineTick={() => autoFit()}
        onEngineStop={() => autoFit(400)}
        onNodeHover={(n: GNode | null) => setHoverNode(n?.id ?? null)}
        onLinkHover={(l: GLink | null) => setHoverLink(l)}
        onNodeClick={handleNodeClick}
        onNodeRightClick={handleNodeContext}
        onLinkClick={handleLinkClick}
        linkColor={(l: GLink) => {
          if (searchHits && searchHits.size > 0) {
            const src = typeof l.source === "object" ? (l.source as GNode).id : l.source;
            const tgt = typeof l.target === "object" ? (l.target as GNode).id : l.target;
            if (!searchHits.has(src) || !searchHits.has(tgt)) return DIM;
          }
          if (!linkLit(l)) return DIM;
          return l.color;
        }}
        linkWidth={(l: GLink) => {
          const hl = hoverRef.current.link;
          return hl?.id === l.id ? l.width * 1.4 : l.width;
        }}
        linkLineDash={(l: GLink) => (l.dashed ? [4, 3] : undefined)}
        linkCurvature={(l: GLink) => (l.kind === "rel" ? 0.18 : 0.06)}
        linkDirectionalArrowLength={(l: GLink) => (l.kind === "rel" ? 2.6 : 0)}
        linkDirectionalArrowRelPos={1}
        linkPointerAreaPaint={(link: GLink, color: string, ctx: CanvasRenderingContext2D) =>
          paintLinkHitArea(link, color, ctx)}
        nodePointerAreaPaint={(node: GNode, color: string, ctx: CanvasRenderingContext2D) =>
          paintNodeHitArea(node, color, ctx)}
        onRenderFramePre={() => { labelBoxesRef.current = []; }}
        nodeCanvasObjectMode={() => "replace"}
        nodeCanvasObject={(node: GNode, ctx: CanvasRenderingContext2D, zoom: number) => {
          zoomKRef.current = zoom;
          // Two independent reasons to fade: the search has excluded it, or a
          // hover elsewhere has. Kept distinct so a node one hop from the
          // pointer still dims when the search has ruled it out.
          const dimmed = !isSearchHit(node.id) || !lit(node.id);
          ctx.globalAlpha = dimmed ? 0.12 : 1;
          paintShape(node, ctx, node.color);
          if (labelVisible(node)) {
            const label = node.label.length > 28 ? `${node.label.slice(0, 27)}…` : node.label;
            const fontSize = node.kind === "tag" ? 4 : 4.5;
            ctx.font = `${fontSize}px ${fontFamily}`;
            const lx = node.x ?? 0;
            const ly = (node.y ?? 0) - nodeR(node) - 2;
            const w = ctx.measureText(label).width;
            const box = { x1: lx - w / 2, y1: ly - fontSize, x2: lx + w / 2, y2: ly + 1 };
            // The hovered node and tags always win; everything else yields to a
            // label already placed on the same pixels this frame.
            const priority = node.kind === "tag" || node.id === hoverRef.current.nodeId;
            const clash =
              !priority &&
              labelBoxesRef.current.some(
                (b) => box.x1 < b.x2 && box.x2 > b.x1 && box.y1 < b.y2 && box.y2 > b.y1,
              );
            if (!clash) {
              labelBoxesRef.current.push(box);
              // Follows the node. A label at full strength over a node faded
              // to a tenth reads as the one thing on screen worth looking at,
              // which is the opposite of what the dim is for.
              ctx.globalAlpha = dimmed ? 0.12 : 1;
              ctx.fillStyle = inkColor;
              ctx.textAlign = "center";
              ctx.fillText(label, lx, ly);
            }
          }
          if (pinned.has(node.id)) {
            ctx.strokeStyle = inkColor;
            ctx.lineWidth = 0.8 / zoom;
            ctx.stroke();
          }
          ctx.globalAlpha = 1;
        }}
      />
      {linkTooltip?.relation && (
        <div className="graph-link-tooltip" role="tooltip">
          {linkTooltip.relation.replace("_", " ")}
          {linkTooltip.sourceKind === "auto" && " (auto)"}
        </div>
      )}
      {selectedEdge && (
        <EdgeDetailPopover
          edge={selectedEdge.edge}
          papers={papers}
          position={selectedEdge}
          onClose={() => setSelectedEdge(null)}
          onDeleted={() => onRefresh?.()}
        />
      )}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

import type { GLink } from "../application/build-graph-data";
import type { FgHandle } from "./graph-canvas-hooks";

/**
 * What the pointer is over, kept in a ref so hovering repaints the canvas
 * without re-rendering React. Leaving waits 100 ms, so moving between a node
 * and its edge does not flicker. Only a relation's tooltip is React state.
 */
export function useGraphHover(
  wrapRef: RefObject<HTMLDivElement | null>,
  fgRef: RefObject<FgHandle | null>,
) {
  const hoverRef = useRef<{ nodeId: string | null; link: GLink | null }>({ nodeId: null, link: null });
  const hoverClearTimer = useRef<number | null>(null);
  const hoverPaintRaf = useRef<number | null>(null);
  const [linkTooltip, setLinkTooltip] = useState<GLink | null>(null);

  useEffect(() => () => {
    if (hoverClearTimer.current) window.clearTimeout(hoverClearTimer.current);
    if (hoverPaintRaf.current) window.cancelAnimationFrame(hoverPaintRaf.current);
  }, []);

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
  }, [wrapRef, fgRef]);

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

  return { hoverRef, linkTooltip, setHoverNode, setHoverLink };
}

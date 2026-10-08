"use client";

import { memo, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  pdfRectToScreenBox,
  type DocumentSearchMatch,
  type PageProjection,
  type PageTextItem,
} from "@weaveforge/core";
import { locateMention } from "../application/reference-locate";
import type { FindMark } from "../application/find-marks";

interface FindOverlayProps {
  /** The document's matches; only those on `pageIndex` are painted. */
  matches: readonly DocumentSearchMatch[];
  /** Index into `matches` of the one the user stepped to, or -1. */
  active: number;
  pageIndex: number;
  items: readonly PageTextItem[];
  projection: PageProjection;
}

export interface FindHitBox {
  key: string;
  current: boolean;
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Find the text node and character offset inside a text-layer span for an item-local offset.
 * Traverses text nodes in document order so spans decorated with citations remain measurable.
 */
function findTextPointInSpan(
  span: Node,
  targetOffset: number,
): { node: Node; offset: number } | null {
  const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
  let accumulated = 0;
  let textNode: Node | null = null;
  let lastTextNode: Node | null = null;
  while ((textNode = walker.nextNode())) {
    lastTextNode = textNode;
    const len = textNode.textContent?.length ?? 0;
    if (accumulated + len >= targetOffset) {
      return {
        node: textNode,
        offset: Math.max(0, targetOffset - accumulated),
      };
    }
    accumulated += len;
  }
  if (lastTextNode) {
    return {
      node: lastTextNode,
      offset: lastTextNode.textContent?.length ?? 0,
    };
  }
  return null;
}

/**
 * Measure search matches directly from the rendered PDF.js text layer DOM.
 * This guarantees search highlights use the exact same layout, line boxes,
 * and character advances as native browser text selection.
 */
export function measureFindDomBoxes(
  textLayer: HTMLElement,
  pageBox: HTMLElement,
  items: readonly PageTextItem[],
  matches: readonly DocumentSearchMatch[],
  active: number,
  pageIndex: number,
): FindHitBox[] | null {
  if (typeof document === "undefined" || typeof document.createRange !== "function") return null;
  const pageRect = pageBox.getBoundingClientRect();
  if (pageRect.width <= 0 || pageRect.height <= 0) return null;

  let cursor = 0;
  const itemBounds = items.map((item) => {
    const start = cursor;
    const length = item.str.length;
    cursor += length + (item.hasEOL ? 1 : 0);
    return { start, end: start + length, length };
  });

  const out: FindHitBox[] = [];
  let foundAny = false;

  matches.forEach((match, matchIdx) => {
    if (match.pageIndex !== pageIndex) return;
    if (match.end <= match.start) return;

    let subIndex = 0;
    for (let i = 0; i < items.length; i++) {
      const b = itemBounds[i]!;
      if (b.length === 0 || b.end <= match.start || b.start >= match.end) continue;

      const from = Math.max(0, match.start - b.start);
      const to = Math.min(b.length, match.end - b.start);
      if (to <= from) continue;

      const span = textLayer.querySelector<HTMLElement>(`[data-item-index="${i}"]`);
      if (!span) continue;

      const startPoint = findTextPointInSpan(span, from);
      const endPoint = findTextPointInSpan(span, to);
      if (!startPoint || !endPoint) continue;

      try {
        const range = document.createRange();
        range.setStart(startPoint.node, startPoint.offset);
        range.setEnd(endPoint.node, endPoint.offset);
        const rects = range.getClientRects();
        for (let r = 0; r < rects.length; r++) {
          const rect = rects[r]!;
          if (rect.width < 0.5 || rect.height < 0.5) continue;
          foundAny = true;
          out.push({
            key: `${matchIdx}:${subIndex++}`,
            current: matchIdx === active,
            left: rect.left - pageRect.left,
            top: rect.top - pageRect.top,
            width: rect.width,
            height: rect.height,
          });
        }
      } catch {
        /* ignore range measurement errors */
      }
    }
  });

  return foundAny ? out : null;
}

/**
 * Every hit of the find box, painted on its page; the current one is louder.
 * Measures against the DOM text layer for exact text-selection alignment,
 * with synchronous geometric fallback for initial paint and unit tests.
 */
function FindOverlayInner({ matches, active, pageIndex, items, projection }: FindOverlayProps) {
  const layerRef = useRef<HTMLDivElement>(null);
  const [domBoxes, setDomBoxes] = useState<FindHitBox[] | null>(null);

  const fallbackBoxes = useMemo(() => {
    const out: FindHitBox[] = [];
    matches.forEach((match, index) => {
      if (match.pageIndex !== pageIndex) return;
      const { rects } = locateMention(items, match.start, match.end);
      rects.forEach((rect, i) => {
        const box = pdfRectToScreenBox(rect, projection);
        if (box.width < 1 || box.height < 1) return;
        out.push({ key: `${index}:${i}`, current: index === active, ...box });
      });
    });
    return out;
  }, [matches, active, pageIndex, items, projection]);

  useLayoutEffect(() => {
    const layer = layerRef.current;
    if (!layer || typeof document === "undefined") return;
    const pageEl = layer.closest<HTMLElement>(".pdf-reader-page") ?? layer.parentElement;
    if (!pageEl) return;
    const textLayer = pageEl.querySelector<HTMLElement>(".pdf-reader-textlayer") ??
      pageEl.closest(".pdf-reader-page-row")?.querySelector<HTMLElement>(".pdf-reader-textlayer");
    if (!textLayer) {
      setDomBoxes(null);
      return;
    }

    const update = () => {
      const measured = measureFindDomBoxes(textLayer, pageEl, items, matches, active, pageIndex);
      setDomBoxes(measured);
    };

    update();

    const observer = new MutationObserver(update);
    observer.observe(textLayer, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-item-index"],
    });

    const onResize = () => update();
    window.addEventListener("resize", onResize);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, [matches, active, pageIndex, items, projection]);

  const boxes = domBoxes && domBoxes.length > 0 ? domBoxes : fallbackBoxes;

  if (!boxes.length) return null;
  return (
    <div ref={layerRef} className="pdf-reader-find-layer">
      {boxes.map(({ key, current, ...box }) => (
        <span
          key={key}
          className={`pdf-reader-find-hit${current ? " is-current" : ""}`}
          style={box}
        />
      ))}
    </div>
  );
}

export const FindOverlay = memo(FindOverlayInner);

/** Ticks beside the scrollbar, one per match, the current one in the accent. */
export function FindMarks({ marks, active }: { marks: readonly FindMark[]; active: number }) {
  if (!marks.length) return null;
  return (
    <div className="pdf-reader-find-marks" aria-hidden="true">
      {marks.map((mark) => (
        <span
          key={mark.index}
          className={`pdf-reader-find-mark${mark.index === active ? " is-current" : ""}`}
          style={{ top: `${mark.fraction * 100}%` }}
        />
      ))}
    </div>
  );
}

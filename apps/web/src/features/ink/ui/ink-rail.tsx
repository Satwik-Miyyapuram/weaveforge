"use client";

/**
 * The rail: every page of the note in one column, so the note is one scroll
 * rather than a step.
 *
 * Only the page being written on is live — its canvas and its worker — and
 * the pages around it are static ink (§ink-page-static) or inert placeholders,
 * so the scroll shows written pages as written pages.
 *
 * The one rule that makes the window smooth is that **the live layer never
 * remounts**. The canvas was transferred to the worker at mount
 * (`transferControlToOffscreen`, once per canvas), so a canvas that unmounts
 * is a canvas the worker can no longer paint — a flip that swapped the live
 * page's element would orphan it. The live layer is therefore rendered once,
 * as a sibling of the slots rather than inside one, and a flip *moves* it over
 * the current slot (a `top`, in a layout effect, before paint). The canvas
 * element survives every flip; the worker keeps its surface; a page change is
 * a repaint, not a rebuild.
 *
 * The slots themselves are fixed: one box per page, in order, all the same
 * size, so a flip changes no slot's geometry and the scroll offset is never
 * corrected. The layer is absolutely positioned and out of flow, so the
 * scroller's scrollHeight comes from the slots alone.
 */

import { useLayoutEffect, useRef, type CSSProperties } from "react";
import type { InkStroke } from "@weaveforge/core";
import { inkPageFigures } from "@weaveforge/core";
import type { InkPalette } from "../render/ink-palette";
import { InkGhostPage } from "./ink-ghost-page";
import { InkPageStatic } from "./ink-page-static";
import { pureInkPageText } from "./ink-sheet-underlay";
import { OverlayScrollbar } from "@/components/overlay-scrollbar";

/** What the rail needs from the host. */
export interface InkRailProps {
  /** Desk between pages, in CSS pixels; the ⋯ menu sets it. */
  pageGap?: number;
  /** The scroller, on the rail's own root: the host watches its scroll. */
  scrollRef: { current: HTMLDivElement | null };
  /** 0-based: the live page. */
  pageIndex: number;
  /** How many pages the note has. */
  pageCount: number;
  /** The live page's size in page units. */
  pageSize: { width: number; height: number };
  /** The CSS-pixels-per-unit fit, zoom included. */
  scale: number;
  /** The fallback paper, for a page the sidecar has not named. */
  paper: string;
  /** The paper of each page, by index, where the sidecar has named it. */
  pages: readonly { paper: string }[] | null;
  /** A ghost's background, by page index. */
  ghosts: ReadonlyMap<number, string>;
  /** Decoded strokes for note pages, so adjacent pages render their ink. */
  strokesMap?: ReadonlyMap<number, readonly InkStroke[]>;
  /** Text pages for the note, for figure metadata. */
  textPages?: readonly string[] | null;
  /** Each page's text as shown, flowed to fit (§ink-text-flow); by index. */
  flowedText?: readonly string[];
  /** Figure blob URLs by path. */
  figureUrls?: ReadonlyMap<string, string>;
  /**
   * `vault:`/`paperimg:` src → a fetchable URL, or null to drop the image.
   *
   * The rail paints the pages either side of the current one, and their text
   * is the same underlay the live page uses — so it needs the same resolver, or
   * a paper's figure appears on the live page and is a broken image on the page
   * beside it.
   */
  resolveImageSrc?: (src: string) => string | null;
  /** Theme palette. */
  palette?: InkPalette;
  /** Everything else the live page needs, as the page component takes it. */
  children: React.ReactNode;
}

export function InkRail(props: InkRailProps) {
  const {
    scrollRef,
    pageIndex,
    pageCount,
    pageSize,
    scale,
    paper,
    pages,
    ghosts,
    strokesMap,
    textPages,
    flowedText,
    figureUrls,
    resolveImageSrc,
    palette,
    children,
    pageGap = 0,
  } = props;

  const total = Math.max(1, pageCount);
  const layerRef = useRef<HTMLDivElement | null>(null);

  /**
   * Tell the live layer where the current slot is, before paint.
   *
   * The layer spans the whole scroll (its height is the scroller's content
   * height), so the canvas inside it — sticky at the top — covers the pane
   * wherever the scroll is, and a pen that lands on a neighbouring page's
   * visible part still lands on the canvas rather than on inert static ink,
   * where the browser would read the pen-down as the start of a scroll.
   * The sheet itself is placed by `--ink-slot-top`: the slot's own
   * `offsetTop`, the one source of truth for where a page sits, so zoom
   * changes, page inserts and the sidecar's answer all land with no extra
   * arithmetic. The slots' `.ink-page` boxes are `position: relative`, so
   * `offsetTop` is measured against the scroller's padding box — exactly the
   * coordinate the layer's own top starts from.
   */
  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    const layer = layerRef.current;
    if (!scroller || !layer) return;
    // The slot, not the layer's own copy of the live page: the layer is a
    // sibling of the slots, so `:scope >` skips it.
    const slot = scroller.querySelector<HTMLElement>(
      `:scope > .ink-page[data-page="${pageIndex}"]`,
    );
    if (!slot) return;
    layer.style.setProperty("--ink-slot-top", `${slot.offsetTop}px`);
    // The layer's box is the slots': measured with the layer out of the
    // sum, or it would feed its own size back into the next measure. Width
    // too, so a zoomed sheet wider than the pane keeps the canvas docked
    // through a horizontal scroll.
    layer.style.width = "0px";
    layer.style.height = "0px";
    const { scrollWidth, scrollHeight } = scroller;
    layer.style.width = `${scrollWidth}px`;
    layer.style.height = `${scrollHeight}px`;
  }, [pageIndex, scrollRef, total, pageSize.width, pageSize.height, scale, pageGap]);

  return (
    <div className="ink-rail-container">
      <div
        className="ink-page-scroll"
        ref={scrollRef}
        style={{ ["--ink-page-gap" as string]: `${pageGap}px` } as CSSProperties}
      >
        {/* The fixed slots: every page in order. The current page's slot renders
            as static ink beneath the layer, so during a flip's repaint there is
            never a blank where the page is about to be.

            The window is the reader's own: the pages that are on screen stay
            exactly as they are — a flip from page 3 to page 4 re-renders slots 3
            and 4 with the *same* props, so React keeps their DOM — while the slot
            that fell out of the window (2) drops to a placeholder and the one
            that entered (5) is loaded. `hasContent` keeps a written page drawn
            even when it has scrolled out of the ±1 window, so the ink never
            vanishes under the reader's eye mid-scroll. */}
        {Array.from({ length: total }, (_, index) => {
          const distance = Math.abs(index - pageIndex);
          const pageStrokes = strokesMap?.get(index);
          const pageText = textPages?.[index] ?? "";
          const pureText = flowedText
            ? (flowedText[index] ?? "")
            : pageText
              ? pureInkPageText(pageText)
              : "";
          const pageFigures = pageText ? inkPageFigures(pageText) : undefined;
          const hasContent =
            (pageStrokes !== undefined && pageStrokes.length > 0) ||
            pureText.length > 0 ||
            (pageFigures !== undefined && pageFigures.length > 0);

          if (distance <= 1 || hasContent) {
            return (
              <InkPageStatic
                key={`page-${index}`}
                index={index}
                pageSize={pageSize}
                scale={scale}
                paper={pages?.[index]?.paper ?? paper}
                backgroundUrl={ghosts.get(index) ?? null}
                figures={pageFigures}
                figureUrls={figureUrls}
                pureText={pureText}
                resolveImageSrc={resolveImageSrc}
                strokes={pageStrokes}
                palette={palette}
              />
            );
          }

          return (
            <InkGhostPage
              key={`page-${index}`}
              index={index}
              pageSize={pageSize}
              scale={scale}
              paper={pages?.[index]?.paper ?? paper}
              backgroundUrl={ghosts.get(index) ?? null}
            />
          );
        })}
        {/* The live layer: rendered once, moved per flip, never remounted. Its
            child is the host's `InkPage` — the canvas, the underlay, the
            figures, the overlay — exactly as the page component lays it out. */}
        <div ref={layerRef} className="ink-live-layer">
          {children}
        </div>
      </div>
      <OverlayScrollbar scrollRef={scrollRef} />
    </div>
  );
}

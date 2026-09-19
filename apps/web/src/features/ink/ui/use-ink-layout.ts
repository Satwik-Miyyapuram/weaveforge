"use client";

/**
 * The host's layout wiring: the worker told where the page is, the palette
 * kept in step with the theme, the pane measured, and the rail's scroll
 * watched for the flip that makes the note one continuous scroll.
 *
 * These are effects, not render work — the canvas is a window onto the sheet
 * and every scroll costs one message, not a page-sized re-raster (§6.2.1).
 */

import { useCallback, useEffect, useRef } from "react";
import { flushSync } from "react-dom";

import type { InkWorkerMessage } from "../application/capture-protocol";
import { backingRatio } from "../render/ink-renderer";
import { readThemePalette, samePalette, type InkPalette } from "../render/ink-palette";

/** What the layout needs from the host. */
export interface InkLayoutDeps {
  /** The worker's door. */
  send: (message: InkWorkerMessage, transfer?: Transferable[]) => void;
  /** The renderer, so a late-comer gets the layout again. */
  backend: string | null;
  /** The live sheet, the canvas, and the pane they sit in. */
  canvasRef: { current: HTMLCanvasElement | null };
  sheetRef: { current: HTMLDivElement | null };
  scrollRef: { current: HTMLDivElement | null };
  /** The CSS-pixels-per-unit fit, zoom included. */
  scale: number;
  /** The scroller's visible box. */
  view: { width: number; height: number };
  /** The current page's size in page units. */
  pageSize: { width: number; height: number };
  /** 0-based: the live page. */
  pageIndex: number;
  /** How many pages the note has. */
  pageCount: number;
  /** Flush a pending save before a page flips. */
  flushSave: (force?: boolean) => void;
  /** The page index, set when the scroll reaches past a slot. */
  setPageIndex: (next: number) => void;
  /** The pane's width, kept by the host. */
  setContainerWidth: (width: number) => void;
  /** The scroller's box, kept by the host. */
  setView: (next: (was: { width: number; height: number }) => { width: number; height: number }) => void;
  /** The theme's palette, kept by the host. */
  setPalette: (palette: InkPalette) => void;
  /** Whether a stroke is in flight, so a flip never interrupts one. */
  sessionActive: () => boolean;
}

export function useInkLayout(deps: InkLayoutDeps) {
  const {
    send,
    backend,
    canvasRef,
    sheetRef,
    scrollRef,
    scale,
    view,
    pageSize,
    pageIndex,
    pageCount,
    flushSave,
    setPageIndex,
    setContainerWidth,
    setView,
    setPalette,
  } = deps;

  /**
   * The ink palette follows the theme. The swatches in the bar are painted with
   * the same CSS tokens, so what the bar shows is what the page draws — in
   * light, dark, and any theme the app grows. Read on mount and again whenever
   * the root's attributes change (that is how a theme is switched) or the OS
   * scheme flips; posted only when a value actually moved.
   */
  useEffect(() => {
    let last: InkPalette | null = null;
    const refresh = () => {
      const next = readThemePalette(document);
      if (last && samePalette(last, next)) return;
      last = next;
      setPalette(next);
      send({ type: "palette", colours: next });
    };
    refresh();
    const observer = new MutationObserver(refresh);
    observer.observe(document.documentElement, { attributes: true });
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", refresh);
    // A theme's stylesheet can land after the first paint.
    const late = window.setTimeout(refresh, 500);
    return () => {
      observer.disconnect();
      media.removeEventListener("change", refresh);
      window.clearTimeout(late);
    };
    // `backend` so a renderer that came up later is handed the palette too.
  }, [backend, send, setPalette]);

  /**
   * Keep the worker's viewport in step with the layout. The canvas is a
   * window onto the sheet, so the camera's offset is where the sheet's corner
   * sits relative to the canvas — it moves with every scroll, and a scroll
   * costs one message, not a page-sized re-raster.
   */
  useEffect(() => {
    const canvas = canvasRef.current;
    const sheet = sheetRef.current;
    const scroller = scrollRef.current;
    if (!canvas || !sheet || !scroller) return;
    const box = canvas.getBoundingClientRect();
    // The backing store is capped, so a deep zoom softens rather than vanishes.
    const dpr = backingRatio(
      box.width,
      box.height,
      window.devicePixelRatio || 1,
    );
    const camera = () => {
      const canvasBox = canvas.getBoundingClientRect();
      const sheetBox = sheet.getBoundingClientRect();
      send({
        type: "viewport",
        transform: {
          scale,
          offsetX: sheetBox.left - canvasBox.left,
          offsetY: sheetBox.top - canvasBox.top,
          devicePixelRatio: dpr,
        },
      });
    };
    send({ type: "resize", width: box.width, height: box.height, dpr });
    camera();
    scroller.addEventListener("scroll", camera, { passive: true });
    return () => scroller.removeEventListener("scroll", camera);
    // `backend` is in the list so a renderer that came up after the first
    // layout gets the layout again; `view` and `pageSize` because the canvas
    // was just resized to them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backend, scale, send, view, pageSize, pageIndex]);

  /**
   * The rail's scroll watcher: scrolling past the live page's own slot
   * reaches for the next or the previous page, which is what makes the note
   * one continuous scroll rather than a page that must be stepped.
   *
   * The trigger is the page's *centre*, not its edge: half a page of travel,
   * so a stroke that starts near the bottom of one page and continues onto
   * the next stays on this page until the pen is genuinely past the middle of
   * the next. And a mid-flight stroke is never interrupted: the worker is
   * drawing it, and a page change would commit half a word.
   *
   * The flip itself is cheap by construction (§ink-rail): the slots never
   * move, the layer just repositions over the new slot, and the worker loads
   * the new page's bytes into the canvas it already holds — no scroll offset
   * correction, no blank flash, no rebuild.
   */
  const scrollPageIndexRef = useRef<number | null>(null);
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || pageCount < 2) return;
    const onScroll = () => {
      if (deps.sessionActive()) return;
      const scrollerBox = scroller.getBoundingClientRect();
      const scrollerCenterY = scrollerBox.top + scrollerBox.height / 2;
      // Only the slots — direct children of the scroller. Static slots carry
      // `data-page`, placeholder slots carry `data-ghost`; both name their page
      // index. The live layer's own copy of the current page is a deeper
      // descendant, so `:scope >` skips it and no page is measured twice.
      const pageElements =
        scroller.querySelectorAll<HTMLElement>(":scope > .ink-page");
      if (pageElements.length === 0) return;

      let bestIndex = pageIndex;
      let minDistance = Infinity;

      pageElements.forEach((el) => {
        const box = el.getBoundingClientRect();
        const pageCenterY = (box.top + box.bottom) / 2;
        const dist = Math.abs(pageCenterY - scrollerCenterY);
        const attr =
          el.getAttribute("data-page") ?? el.getAttribute("data-ghost");
        const parsedIdx = attr !== null ? parseInt(attr, 10) : NaN;
        if (!isNaN(parsedIdx) && dist < minDistance) {
          minDistance = dist;
          bestIndex = parsedIdx;
        }
      });

      if (bestIndex !== pageIndex && bestIndex >= 0 && bestIndex < pageCount) {
        scrollPageIndexRef.current = bestIndex;
        flushSave();
        setPageIndex(bestIndex);
      }
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", onScroll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flushSave, pageCount, pageIndex, scrollRef, setPageIndex]);

  /**
   * When pageIndex changes programmatically (e.g. clicking Next/Prev page in
   * toolbar), scroll the target page into view smoothly. If the change was
   * triggered by continuous scrolling, no scroll adjustment is needed.
   *
   * The first run is skipped: a note opens on page 1, and scrolling "to" it
   * meant the rail jumped on the way in — with `behavior: "smooth"` the page
   * visibly slid down the pane the moment Ink mode was entered. The open
   * position is the top of the rail, which is where page 1 already is.
   */
  const centredOnceRef = useRef(false);
  useEffect(() => {
    if (!centredOnceRef.current) {
      centredOnceRef.current = true;
      scrollPageIndexRef.current = null;
      return;
    }
    if (scrollPageIndexRef.current === pageIndex) {
      scrollPageIndexRef.current = null;
      return;
    }
    const scroller = scrollRef.current;
    if (!scroller) return;
    // A slot, not the layer's copy: ghost slots carry `data-ghost`, so fall
    // back to it when the page being scrolled to has no static slot yet.
    const target =
      scroller.querySelector<HTMLElement>(
        `:scope > .ink-page[data-page="${pageIndex}"]`,
      ) ??
      scroller.querySelector<HTMLElement>(
        `:scope > .ink-page[data-ghost="${pageIndex}"]`,
      );
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageIndex, scrollRef]);

  /**
   * The page under a client point, by the slots: the one whose box holds
   * `clientY`, or — between pages — the nearer one. `null` off the rail.
   */
  const pageAt = useCallback(
    (clientY: number): number | null => {
      const scroller = scrollRef.current;
      if (!scroller) return null;
      const slots = scroller.querySelectorAll<HTMLElement>(":scope > .ink-page");
      let best: number | null = null;
      let minDistance = Infinity;
      slots.forEach((el) => {
        const attr = el.getAttribute("data-page") ?? el.getAttribute("data-ghost");
        const index = attr !== null ? parseInt(attr, 10) : NaN;
        if (Number.isNaN(index)) return;
        const box = el.getBoundingClientRect();
        const distance =
          clientY < box.top
            ? box.top - clientY
            : clientY > box.bottom
              ? clientY - box.bottom
              : 0;
        if (distance < minDistance) {
          minDistance = distance;
          best = index;
        }
      });
      return best;
    },
    [scrollRef],
  );

  /**
   * Make the page under the pointer the live one, *now*: the canvas covers
   * the whole pane, so a pen can come down on the next page's visible part.
   * The flip is flushed synchronously — the render, the rail's placement of
   * the sheet, and the `load-page` the lifecycle effect posts all land before
   * this returns — so the stroke that follows in the same handler projects
   * against the right sheet and reaches the worker after the page it belongs
   * to. No scroll: the reader put the pen where the page already is.
   */
  const ensurePageAt = useCallback(
    (_clientX: number, clientY: number): boolean => {
      const target = pageAt(clientY);
      if (target === null || target === pageIndex) return false;
      if (target < 0 || target >= pageCount) return false;
      if (deps.sessionActive()) return false;
      scrollPageIndexRef.current = target;
      // Forced: the half-stroke the split just ended is in the worker's
      // buffer but its commit has not come back yet, so nothing is scheduled.
      flushSave(true);
      flushSync(() => setPageIndex(target));
      return true;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [flushSave, pageAt, pageCount, pageIndex, setPageIndex],
  );

  /** Measure the pane, so the fit is the container's and not a guess. */
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const measure = () => {
      setContainerWidth(element.clientWidth);
      setView((was) =>
        was.width === element.clientWidth && was.height === element.clientHeight
          ? was
          : { width: element.clientWidth, height: element.clientHeight },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
    // The scroller is measured once, on mount; its own changes come through
    // the observer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { ensurePageAt };
}

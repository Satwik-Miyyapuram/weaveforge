"use client";

/**
 * The host's layout wiring: the worker told where the page is, the palette
 * kept in step with the theme, the pane measured, and the rail's scroll
 * watched for the flip that makes the note one continuous scroll.
 *
 * These are effects, not render work — the canvas is a window onto the sheet
 * and every scroll costs one message, not a page-sized re-raster (§6.2.1).
 */

import { useEffect, useRef } from "react";

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
  flushSave: () => void;
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
   * The trigger is the live sheet's *centre*, not its edge: half a page of
   * travel, so a stroke that starts near the bottom of one page and continues
   * onto the ghost below stays on this page until the pen is genuinely past
   * the middle of the next. And a mid-flight stroke is never interrupted: the
   * worker is drawing it, and a page change would commit half a word.
   */
  const flipAnchor = useRef<{ centerY: number } | null>(null);
  const flipping = useRef(false);
  useEffect(() => {
    const scroller = scrollRef.current;
    const sheet = sheetRef.current;
    if (!scroller || !sheet || pageCount < 2) return;
    const onScroll = () => {
      if (flipping.current) return;
      if (deps.sessionActive()) return;
      const scrollerBox = scroller.getBoundingClientRect();
      const sheetBox = sheet.getBoundingClientRect();
      // Where the sheet's middle sits in the pane, 0 at the pane's own top.
      const relative = (sheetBox.top + sheetBox.bottom) / 2 - scrollerBox.top;
      const towards = Math.sign(scrollerBox.height / 2 - relative);
      // Half the pane's height of travel before the page flips, and only
      // when there is a page to flip to.
      if (Math.abs(scrollerBox.height / 2 - relative) < scrollerBox.height / 2) return;
      const next = pageIndex + (towards > 0 ? 1 : -1);
      if (next < 0 || next >= pageCount) return;
      // The anchor keeps the live page where the scroll left it: the slot it
      // moves into is the one being looked at, and its own height may differ.
      flipAnchor.current = { centerY: relative };
      flipping.current = true;
      flushSave();
      setPageIndex(next);
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", onScroll);
    // `sessionActive` reads the session live, so the session itself is not one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flushSave, pageCount, pageIndex, setPageIndex, deps.sessionActive]);

  /**
   * After a scroll-triggered flip, put the newly-live sheet back where the
   * scroll was: its slot is the one being looked at, so the sheet's middle
   * returns to the same band of the pane and the scroll does not jump to the
   * top of the new page the way a stepped page change does.
   */
  useEffect(() => {
    if (!flipping.current) return;
    const anchor = flipAnchor.current;
    const scroller = scrollRef.current;
    const sheet = sheetRef.current;
    flipping.current = false;
    flipAnchor.current = null;
    if (!anchor || !scroller || !sheet) return;
    const scrollerBox = scroller.getBoundingClientRect();
    const sheetBox = sheet.getBoundingClientRect();
    const relative = (sheetBox.top + sheetBox.bottom) / 2 - scrollerBox.top;
    scroller.scrollTop += relative - anchor.centerY;
    // The refs are read live; the page index is what changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageIndex]);

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
}

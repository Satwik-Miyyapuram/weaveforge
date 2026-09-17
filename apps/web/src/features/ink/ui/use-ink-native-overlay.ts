"use client";

/**
 * The native shell's ink overlay (docs/internal/design/ink-native-bridges.md).
 *
 * Where the desktop app offers a platform ink surface — Windows' InkPresenter —
 * the shell inks over the page itself and hands each finished stroke back.
 * This keeps it told where the page is, what the pen looks like, and who is
 * writing, and replays its finished strokes through the pen's own session so
 * a native stroke is filtered, indexed and saved exactly as a web one is.
 *
 * Nothing here does anything where the bridge is absent (`nativeInkBridge()`
 * returns `null` in a plain browser); every effect checks and returns.
 */

import { useEffect, useMemo } from "react";
import type { InkColour, InkHand } from "@weaveforge/core";

import { trailStyle } from "../application/ink-trail";
import {
  installNativeStrokeHandler,
  nativeInkBridge,
  nativeStrokeEvents,
} from "../application/native-bridge";
import type { PenCaptureSession } from "../application/use-pen-capture";
import type { InkPalette } from "../render/ink-palette";

/** What the overlay needs from the host; the host owns the pen and the canvas. */
export interface InkNativeOverlayDeps {
  /** The canvas the overlay is clamped to. */
  canvasRef: { current: HTMLCanvasElement | null };
  /** The scroller the canvas moves inside. */
  scrollRef: { current: HTMLDivElement | null };
  /** The sheet, whose width turns a nib in page units into pixels. */
  sheetRef: { current: HTMLDivElement | null };
  /** `pen` / `highlighter`, the two things that put ink down. */
  tool: "pen" | "highlighter";
  colour: InkColour;
  /** The nib's width in page units. */
  nib: number;
  /** The ink palette the wet stroke is painted with. */
  palette: InkPalette;
  /** The scale between page units and CSS pixels. */
  scale: number;
  /** The pen's session, which a finished native stroke is replayed through. */
  session: PenCaptureSession;
  /** Whether only a pen may ink here. */
  penOnly: boolean;
  /** Which hand the pen writes with, so the overlay's palm guard agrees. */
  handedness: InkHand;
}

export function useInkNativeOverlay(deps: InkNativeOverlayDeps) {
  const { canvasRef, scrollRef, sheetRef, session, penOnly, handedness } = deps;
  const native = useMemo(() => nativeInkBridge(), []);

  /** The overlay inks only over the page: its box, kept current as it moves. */
  useEffect(() => {
    if (!native) return;
    const canvas = canvasRef.current;
    const scroller = scrollRef.current;
    if (!canvas || !scroller) return;
    const tell = () => {
      const box = canvas.getBoundingClientRect();
      native.setViewport({
        left: box.left,
        top: box.top,
        width: box.width,
        height: box.height,
      });
    };
    tell();
    const observer = new ResizeObserver(tell);
    observer.observe(canvas);
    scroller.addEventListener("scroll", tell, { passive: true });
    window.addEventListener("resize", tell);
    window.addEventListener("scroll", tell, { passive: true });
    return () => {
      observer.disconnect();
      scroller.removeEventListener("scroll", tell);
      window.removeEventListener("resize", tell);
      window.removeEventListener("scroll", tell);
      native.clearViewport();
    };
  }, [native, canvasRef, scrollRef, deps.scale]);

  /** The overlay's wet stroke looks like the ink it will become. */
  useEffect(() => {
    if (!native) return;
    const pageWidthPx = sheetRef.current?.getBoundingClientRect().width ?? 0;
    native.setTool({
      tool: deps.tool,
      colour: deps.colour,
      widthPx: trailStyle({
        colour: deps.colour,
        tool: deps.tool,
        width: deps.nib,
        pageWidthPx,
        palette: deps.palette,
      }).diameter,
    });
  }, [
    native,
    sheetRef,
    deps.tool,
    deps.colour,
    deps.nib,
    deps.scale,
    deps.palette,
  ]);

  useEffect(() => {
    native?.setPenOnly(penOnly);
  }, [native, penOnly]);

  useEffect(() => {
    native?.setHandedness(handedness);
  }, [native, handedness]);

  /**
   * A finished native stroke, through the same session the pointer events
   * use — the gate, the filter, the writer, the worker — so it is filtered,
   * indexed and saved exactly as a web stroke is. The overlay is cleared two
   * frames later, once the worker has had a frame to draw the committed one.
   */
  useEffect(() => {
    if (!native) return;
    return installNativeStrokeHandler((points) => {
      const events = nativeStrokeEvents(points, window.devicePixelRatio || 1);
      const first = events[0];
      if (!first) {
        native.clearOverlay();
        return;
      }
      const last = events.length > 1 ? events[events.length - 1]! : first;
      // Down, one raw update carrying the middle as its coalesced events, up.
      const middle = events.slice(1, -1);
      const dispatched = middle.pop();
      session.pointerDown(first);
      if (dispatched)
        session.pointerRawUpdate({
          ...dispatched,
          getCoalescedEvents: () => middle,
        });
      if (last !== first) session.pointerUp(last);
      else session.pointerUp({ ...first, t: first.t + 1 });
      requestAnimationFrame(() =>
        requestAnimationFrame(() => native.clearOverlay()),
      );
    });
  }, [native, session]);

  return native;
}

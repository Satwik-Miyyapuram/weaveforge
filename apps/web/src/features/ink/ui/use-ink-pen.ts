"use client";

/**
 * The pen itself (§6.2): capture, haptics, and the one worker door it owns.
 *
 * The pen hook owns the worker — a second one would double the geometry —
 * so the host's other asks go through the `send` it returns. The pen's
 * haptics follow the filtered sample, not the raw one, so the feel and the
 * line agree; the handlers here wrap the pen's own so the actuator is off
 * in the same handler that ends a stroke — nothing waits a frame.
 */

import { useEffect, useMemo, useRef } from "react";
import type { InkColour } from "@weaveforge/core";

import type { PenHaptics } from "../application/pen-haptics";
import { usePenCapture } from "../application/use-pen-capture";
import { trailStyle } from "../application/ink-trail";
import type { InkWorkerEvent } from "../application/capture-protocol";
import type { InkPalette } from "../render/ink-palette";
import { nibForTool, type InkBarTool } from "./ink-bar";

/** What the pen needs from the host. */
export interface InkPenDeps {
  /** The canvas the pen writes on. */
  canvasRef: { current: HTMLCanvasElement | null };
  /** The live sheet, for the trail's page width. */
  sheetRef: { current: HTMLDivElement | null };
  /** Client coordinates to page units. */
  project: (clientX: number, clientY: number) => { x: number; y: number } | null;
  /** 0-based: the page the strokes belong to. */
  pageIndex: number;
  /** The bar's tool. */
  tool: InkBarTool | "shape";
  /** The nib's width, in tool units. */
  width: number;
  /** The stroke's colour. */
  colour: InkColour;
  /** The writing hand, for palm rejection. */
  hand: "left" | "right";
  /** The theme's ink colours. */
  palette: InkPalette;
  /** The worker's answers, as the host's RPC keeps them. */
  onEvent: (event: InkWorkerEvent) => void;
  /** The pen came near the screen: choose a pen mode if one is not already up. */
  onPenApproach?: () => void;
  /** One state change per stroke, for the readout, and the late save's ask. */
  onStrokeEnd: () => void;
  /** The actuator, where the platform can drive one; `null` elsewhere. */
  haptics?: () => Promise<PenHaptics | null>;
}

export function useInkPen(deps: InkPenDeps) {
  const { canvasRef, sheetRef, project, pageIndex, tool, colour, hand, palette } =
    deps;
  const nib = nibForTool(tool, deps.width);

  /*
   * The pen's haptics (ink-native-bridges.md §4), where the platform has them.
   * Asked for once per mount; until the answer comes, and everywhere it is
   * `null`, the ref is empty and every call above is skipped.
   */
  const hapticsRef = useRef<PenHaptics | null>(null);
  const haptics = deps.haptics;
  useEffect(() => {
    let cancelled = false;
    void haptics?.().then((h) => {
      if (!cancelled) hapticsRef.current = h;
    });
    return () => {
      cancelled = true;
      hapticsRef.current?.stop();
      hapticsRef.current = null;
    };
  }, [haptics]);

  const pen = usePenCapture({
    element: () => canvasRef.current,
    project,
    bounds: () => {
      const box = canvasRef.current?.getBoundingClientRect();
      return box
        ? { left: box.left, top: box.top, width: box.width, height: box.height }
        : undefined;
    },
    pageIndex,
    // The eraser and the lasso do not draw, so the pen's tool is the pen's: a
    // highlighter is the only other thing that puts ink down.
    tool: tool === "highlighter" ? "highlighter" : "pen",
    width: nib,
    colour,
    handedness: hand,
    // The Delegated Ink Trail (§6.2.6): the hook asks for the presenter and
    // tells the worker which path it is on; this is only the style per sample.
    trail: {
      style: (liveWidth: number) =>
        trailStyle({
          colour,
          tool: tool === "highlighter" ? "highlighter" : "pen",
          width: liveWidth,
          pageWidthPx: sheetRef.current?.getBoundingClientRect().width ?? 0,
          palette,
        }),
    },
    // The pen's haptics follow the filtered sample, not the raw one: the same
    // pressure and speed the nib is drawn with, so the feel and the line agree.
    onLive: (sample) => hapticsRef.current?.update(sample),
    onStrokeEnd: deps.onStrokeEnd,
    onEvent: deps.onEvent,
    // The pen arriving selects a pen mode (see `toolOnPenApproach`). It has to be
    // wired here rather than to a tool-bar click, because ink is gated on the tool
    // in force: a stroke that began while the eraser or the lasso was up would be
    // swallowed, and the user would see a pen that "does not write".
    onPenApproach: deps.onPenApproach,
  });

  /** The waveform is the tool's: graphite, felt, rubber. */
  useEffect(() => {
    hapticsRef.current?.setTool(
      tool === "highlighter"
        ? "highlighter"
        : tool === "eraser"
          ? "eraser"
          : "pen",
    );
  }, [tool]);

  /** The pen up, and the actuator off in the same handler — nothing waits a frame. */
  const penHandlers = useMemo(
    () => ({
      ...pen.handlers,
      onPointerUp: (event: React.PointerEvent<HTMLCanvasElement>) => {
        hapticsRef.current?.stop();
        pen.handlers.onPointerUp(event);
      },
      onPointerCancel: (event: React.PointerEvent<HTMLCanvasElement>) => {
        hapticsRef.current?.stop();
        pen.handlers.onPointerCancel(event);
      },
    }),
    [pen.handlers],
  );

  return { pen, penHandlers, nib };
}

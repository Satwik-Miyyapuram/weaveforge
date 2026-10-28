"use client";

/**
 * The page's gestures and history (§ink-host): a one-finger pan, a pinch, the
 * eraser's sweep, undo and redo. Each edit is a save.
 */

import { useCallback, type Dispatch, type RefObject, type SetStateAction } from "react";

import { clampInkZoom, type FigureGeometry } from "@weaveforge/core";
import type { InkWorkerMessage } from "../application/capture-protocol";
import type { PageStep } from "../application/ink-page-history";
import { ERASER_SCREEN_RADIUS } from "./ink-page-pointer";

type Point = { x: number; y: number };

export function useInkEditActions({
  send,
  scheduleSave,
  scrollRef,
  setZoom,
  project,
  takeStep,
  restoreFigures,
}: {
  send: (message: InkWorkerMessage) => void;
  scheduleSave: () => void;
  scrollRef: RefObject<HTMLDivElement | null>;
  setZoom: Dispatch<SetStateAction<number>>;
  /** Client px to page units, the host's projection; sizes the eraser at this zoom. */
  project: (clientX: number, clientY: number) => Point | null;
  /** The next step off the page's undo log (§use-ink-page-history). */
  takeStep: (direction: "undo" | "redo") => PageStep | null;
  /** Put the page's figures back, without logging it. */
  restoreFigures: (figures: readonly FigureGeometry[]) => void;
}) {
  /** One finger dragged the page: scroll the other way, so the paper follows. */
  const onPan = useCallback((dx: number, dy: number) => {
    scrollRef.current?.scrollBy(-dx, -dy);
  }, [scrollRef]);

  /** Two fingers pinched: zoom, clamped like the wheel is. */
  const onPinch = useCallback((factor: number) => {
    setZoom((value) => clampInkZoom(value * factor));
  }, [setZoom]);

  const onErase = useCallback(
    (from: Point, to: Point) => {
      // The reach is fixed on screen: project a screen-sized step into page units.
      const a = project(0, 0);
      const b = project(ERASER_SCREEN_RADIUS, 0);
      const radius = a && b ? b.x - a.x : undefined;
      send({ type: "erase", from, to, radius });
      scheduleSave();
    },
    [project, scheduleSave, send],
  );

  /** A stroke step is the worker's to undo; a figure step is put back here. */
  const step = useCallback(
    (direction: "undo" | "redo") => {
      const next = takeStep(direction);
      if (!next) return;
      if (next === "stroke") {
        send({ type: direction });
        scheduleSave();
      } else {
        restoreFigures(direction === "undo" ? next.before : next.after);
      }
    },
    [restoreFigures, scheduleSave, send, takeStep],
  );
  const onUndo = useCallback(() => step("undo"), [step]);
  const onRedo = useCallback(() => step("redo"), [step]);

  return { onPan, onPinch, onErase, onUndo, onRedo };
}

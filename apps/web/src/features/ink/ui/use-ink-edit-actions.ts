"use client";

/**
 * The page's gestures and history (§ink-host): a one-finger pan, a pinch, the
 * eraser's sweep, undo and redo. Each edit is a save.
 */

import { useCallback, type Dispatch, type RefObject, type SetStateAction } from "react";

import type { InkWorkerMessage } from "../application/capture-protocol";

type Point = { x: number; y: number };

export function useInkEditActions({
  send,
  scheduleSave,
  scrollRef,
  setZoom,
}: {
  send: (message: InkWorkerMessage) => void;
  scheduleSave: () => void;
  scrollRef: RefObject<HTMLDivElement | null>;
  setZoom: Dispatch<SetStateAction<number>>;
}) {
  /** One finger dragged the page: scroll the other way, so the paper follows. */
  const onPan = useCallback((dx: number, dy: number) => {
    scrollRef.current?.scrollBy(-dx, -dy);
  }, [scrollRef]);

  /** Two fingers pinched: zoom, clamped like the wheel is. */
  const onPinch = useCallback((factor: number) => {
    setZoom((value) => Math.min(4, Math.max(0.5, value * factor)));
  }, [setZoom]);

  const onErase = useCallback(
    (from: Point, to: Point) => {
      send({ type: "erase", from, to });
      scheduleSave();
    },
    [scheduleSave, send],
  );

  const onUndo = useCallback(() => {
    send({ type: "undo" });
    scheduleSave();
  }, [scheduleSave, send]);
  const onRedo = useCallback(() => {
    send({ type: "redo" });
    scheduleSave();
  }, [scheduleSave, send]);

  return { onPan, onPinch, onErase, onUndo, onRedo };
}

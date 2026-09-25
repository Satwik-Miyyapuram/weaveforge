"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DraftShape } from "./types";

type MovePreview = { ids: string[]; dx: number; dy: number };

/**
 * What the page paints while a gesture is under way — the shape being drawn,
 * the marks being dragged, the lasso loop and what it caught — each published
 * at most once per frame. Split out of `use-page-pointer.ts`, which decides
 * what the gestures mean; this only holds what they look like mid-flight.
 */
export function usePointerPreviews() {
  /**
   * The stroke or region currently under the pointer, in PDF coordinates.
   *
   * `inkPath` and `dragRect` are refs, so mutating them during a drag never
   * re-rendered anything — the mark only appeared once pointer-up persisted the
   * annotation, with no feedback while drawing. This mirrors them into state so
   * the in-progress shape is painted, and is cleared when the drag ends.
   */
  const [draftShape, setDraftShape] = useState<DraftShape | null>(null);
  /**
   * Live offset of the ink marks being dragged. Held here rather than pushed
   * through `onAnnotationsChange` so a move repaints without writing to the
   * annotation list (and the server) on every frame. A lasso selection is
   * dragged as one, so this is a list: the sheet moves a whole selection, and so
   * does a paper.
   */
  const [movePreview, setMovePreview] = useState<MovePreview | null>(null);
  const moveFrame = useRef<number | null>(null);
  const pendingMove = useRef<MovePreview | null>(null);
  /**
   * The lasso loop being drawn, in PDF user space, and the marks the last one
   * caught. `lasso` is the ref the pointer appends to; `lassoPath` is the copy
   * the overlay paints, published once per frame like the draft stroke.
   */
  const lasso = useRef<number[]>([]);
  const lassoPointerId = useRef<number | null>(null);
  /** The page the loop is on: a lasso takes one page's marks. */
  const lassoPage = useRef<number | null>(null);
  const [lassoPath, setLassoPath] = useState<readonly number[] | null>(null);
  const lassoFrame = useRef<number | null>(null);
  const [lassoed, setLassoed] = useState<readonly string[]>([]);
  const pendingShape = useRef<DraftShape | null>(null);
  const shapeFrame = useRef<number | null>(null);

  /**
   * Publish the in-progress shape at most once per frame. Pointer-move fires far
   * more often than the display refreshes, and each publish re-renders a page.
   */
  const scheduleDraft = useCallback((shape: DraftShape | null) => {
    pendingShape.current = shape;
    if (shapeFrame.current != null) return;
    shapeFrame.current = window.requestAnimationFrame(() => {
      shapeFrame.current = null;
      setDraftShape(pendingShape.current);
    });
  }, []);

  const clearDraft = useCallback(() => {
    if (shapeFrame.current != null) {
      window.cancelAnimationFrame(shapeFrame.current);
      shapeFrame.current = null;
    }
    pendingShape.current = null;
    setDraftShape(null);
  }, []);

  /** The lasso loop, on the same frame budget as a stroke — see `scheduleDraft`. */
  const publishLasso = useCallback((next: readonly number[] | null) => {
    if (next == null) {
      if (lassoFrame.current != null) {
        window.cancelAnimationFrame(lassoFrame.current);
        lassoFrame.current = null;
      }
      setLassoPath(null);
      return;
    }
    if (lassoFrame.current != null) return;
    lassoFrame.current = window.requestAnimationFrame(() => {
      lassoFrame.current = null;
      setLassoPath(lasso.current.length >= 2 ? [...lasso.current] : null);
    });
  }, []);

  const clearLasso = useCallback(() => {
    lasso.current = [];
    lassoPointerId.current = null;
    lassoPage.current = null;
    publishLasso(null);
    setLassoed([]);
  }, [publishLasso]);

  /** Same frame budget for a move as for a stroke — see `scheduleDraft`. */
  const scheduleMove = useCallback((next: MovePreview | null) => {
    pendingMove.current = next;
    if (next == null) {
      if (moveFrame.current != null) {
        window.cancelAnimationFrame(moveFrame.current);
        moveFrame.current = null;
      }
      setMovePreview(null);
      return;
    }
    if (moveFrame.current != null) return;
    moveFrame.current = window.requestAnimationFrame(() => {
      moveFrame.current = null;
      setMovePreview(pendingMove.current);
    });
  }, []);

  useEffect(() => clearDraft, [clearDraft]);
  useEffect(
    () => () => {
      if (moveFrame.current != null) window.cancelAnimationFrame(moveFrame.current);
      if (lassoFrame.current != null) window.cancelAnimationFrame(lassoFrame.current);
    },
    [],
  );

  return {
    draftShape, scheduleDraft, clearDraft,
    movePreview, scheduleMove,
    lasso, lassoPointerId, lassoPage, lassoPath, publishLasso, lassoed, setLassoed, clearLasso,
  };
}

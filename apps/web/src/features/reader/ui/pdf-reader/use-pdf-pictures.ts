"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  reorderFigures,
  resizeFigureBox,
  type FigureGeometry,
  type FigureOrderStep,
  type PageTextGeometry,
  type ReaderAnnotation,
  type ReaderPageSize,
} from "@weaveforge/core";
import type { ReaderCreateTool } from "../../application/reader-annotation-helpers";
import {
  pagePictures,
  pictureComment,
  pictureMeta,
  pictureRect,
  type PagePicture,
} from "../../application/reader-picture";
import type { AnnotationActions } from "./use-annotation-actions";
import { pageBoxOf } from "./page-box";

/**
 * A placed picture on a paper, handled the way an ink note handles a figure.
 *
 * The picture is drawn by the note's own renderer (`InkFigures`) and edited by
 * its own editor (`InkFigureEditor`): the same frame, handles, crop and
 * stacking bar. The pen writes over a picture, as it does on a note; a mouse
 * press on one — or any press with the pointer tool — picks it up and drags
 * it, and opens the editor.
 *
 * Positions are PDF points from the page's top-left, which is what the editor
 * works in once it is given the reader's scale. Only an unrotated page is
 * edited; a turned page shows its pictures as marks, as it always did.
 */

export interface PdfPicturesDeps {
  canCreate: boolean;
  createTool: ReaderCreateTool;
  scale: number;
  rotation: number;
  pageSize: ReaderPageSize | null;
  pageGeometries: { current: Map<number, PageTextGeometry> };
  annotations: readonly ReaderAnnotation[];
  annotationsByPage: Map<number, ReaderAnnotation[]>;
  saveAnchor: AnnotationActions["saveAnchor"];
  updateLocal: AnnotationActions["updateLocal"];
  removeLocal: AnnotationActions["removeLocal"];
}

type Box = Pick<FigureGeometry, "x" | "y" | "w" | "h" | "crop">;
type Corner = "nw" | "ne" | "se" | "sw";

/** The picture being edited, and the placement it shows until it is written. */
export interface PictureEdit {
  id: string;
  pageNumber: number;
  preview: Box | null;
}

/** How long a run of editor changes waits before it is written. */
const COMMIT_DELAY_MS = 250;

export function usePdfPictures(deps: PdfPicturesDeps) {
  const {
    canCreate,
    createTool,
    scale,
    rotation,
    pageSize,
    pageGeometries,
    annotations,
    annotationsByPage,
    saveAnchor,
    updateLocal,
    removeLocal,
  } = deps;
  const [edit, setEdit] = useState<PictureEdit | null>(null);
  const editRef = useRef(edit);
  editRef.current = edit;
  const annotationsRef = useRef(annotations);
  annotationsRef.current = annotations;
  const enabled = canCreate && rotation % 360 === 0;

  const pageHeight = useCallback(
    (pageNumber: number) =>
      pageGeometries.current.get(pageNumber)?.pageHeight ?? pageSize?.height ?? 792,
    [pageGeometries, pageSize],
  );
  const pageWidth = useCallback(
    (pageNumber: number) =>
      pageGeometries.current.get(pageNumber)?.pageWidth ?? pageSize?.width ?? 612,
    [pageGeometries, pageSize],
  );
  const picturesOn = useCallback(
    (pageNumber: number): PagePicture[] =>
      pagePictures(annotationsByPage.get(pageNumber) ?? [], pageHeight(pageNumber)),
    [annotationsByPage, pageHeight],
  );

  /** Write a placement: the rectangle always, the comment when the crop moved. */
  const write = useCallback(
    (id: string, pageNumber: number, box: Box) => {
      const ann = annotationsRef.current.find((a) => a.id === id);
      const meta = ann ? pictureMeta(ann) : null;
      const position = ann?.anchor.zoteroPosition;
      if (!ann || !meta || !position) return;
      const rect = pictureRect(box, pageHeight(pageNumber));
      const was = position.rects?.[0];
      if (!was || rect.some((n, i) => Math.abs(n - (was[i] ?? 0)) > 0.01)) {
        void saveAnchor(ann, { ...ann.anchor, zoteroPosition: { ...position, rects: [rect] } });
      }
      if ((box.crop ?? []).join(",") !== (meta.crop ?? []).join(",")) {
        void updateLocal(id, { comment: pictureComment({ ...meta, crop: box.crop }) });
      }
    },
    [pageHeight, saveAnchor, updateLocal],
  );

  // The editor reports every frame of a drag and never its end, so a run of
  // changes is written once it settles, and at once when the editor closes.
  const pending = useRef<{ timer: ReturnType<typeof setTimeout>; flush: () => void } | null>(null);
  const flush = useCallback(() => {
    const held = pending.current;
    if (!held) return;
    clearTimeout(held.timer);
    pending.current = null;
    held.flush();
  }, []);
  useEffect(() => flush, [flush]);

  const change = useCallback(
    (box: Box) => {
      const current = editRef.current;
      if (!current) return;
      const { id, pageNumber } = current;
      setEdit({ id, pageNumber, preview: box });
      if (pending.current) clearTimeout(pending.current.timer);
      const run = () => {
        pending.current = null;
        write(id, pageNumber, box);
        setEdit((now) => (now?.id === id ? { ...now, preview: null } : now));
      };
      pending.current = { timer: setTimeout(run, COMMIT_DELAY_MS), flush: run };
    },
    [write],
  );

  const close = useCallback(() => {
    flush();
    setEdit(null);
  }, [flush]);

  const open = useCallback(
    (id: string, pageNumber: number) => {
      if (editRef.current?.id === id) return;
      flush();
      setEdit({ id, pageNumber, preview: null });
    },
    [flush],
  );

  const reorder = useCallback(
    (step: FigureOrderStep) => {
      const current = editRef.current;
      if (!current) return;
      flush();
      const list = picturesOn(current.pageNumber);
      const index = list.findIndex((one) => one.id === current.id);
      if (index < 0) return;
      const next = reorderFigures(list, index, step);
      next.forEach((one, z) => {
        if (one.z === z) return;
        const ann = annotationsRef.current.find((a) => a.id === one.id);
        const meta = ann ? pictureMeta(ann) : null;
        if (meta) void updateLocal(one.id, { comment: pictureComment({ ...meta, z }) });
      });
    },
    [flush, picturesOn, updateLocal],
  );

  const remove = useCallback(() => {
    const current = editRef.current;
    if (!current) return;
    if (pending.current) clearTimeout(pending.current.timer);
    pending.current = null;
    setEdit(null);
    void removeLocal(current.id);
  }, [removeLocal]);

  // A picture that goes away (undo, a delete from the list, a sync) takes
  // its editor with it; a turned page has no editor to show.
  useEffect(() => {
    if (!edit) return;
    if (!enabled || !annotations.some((a) => a.id === edit.id)) setEdit(null);
  }, [annotations, edit, enabled]);

  /** The picture a press is over, and which corner: the ink note's `figureAt`. */
  const pictureAt = useCallback(
    (pageNumber: number, at: { x: number; y: number }) => {
      const hit = (12 + 18) / scale;
      const list = picturesOn(pageNumber);
      for (let index = list.length - 1; index >= 0; index -= 1) {
        const one = list[index]!;
        const { x, y, w, h } = one.figure;
        const corners: [Corner, number, number][] = [
          ["nw", x, y],
          ["ne", x + w, y],
          ["se", x + w, y + h],
          ["sw", x, y + h],
        ];
        const corner = corners.find(([, cx, cy]) => Math.hypot(at.x - cx, at.y - cy) <= hit);
        if (corner) return { one, corner: corner[0] };
        if (at.x >= x && at.x <= x + w && at.y >= y && at.y <= y + h) return { one, corner: null };
      }
      return null;
    },
    [picturesOn, scale],
  );

  const drag = useRef<{
    pointerId: number;
    corner: Corner | null;
    from: { x: number; y: number };
    box: Box;
    pageNumber: number;
  } | null>(null);

  const at = (row: Element, event: React.PointerEvent) => {
    const rect = pageBoxOf(row).getBoundingClientRect();
    return { x: (event.clientX - rect.left) / scale, y: (event.clientY - rect.top) / scale };
  };

  /**
   * A press on a page. True when it was a picture's, and the page's own tools
   * must not see it. A press anywhere else lets the open editor go.
   */
  const pointerDown = useCallback(
    (pageNumber: number, event: React.PointerEvent<HTMLElement>): boolean => {
      if (!enabled) return false;
      const grabs =
        // A finger scrolls the paper, whatever it lands on.
        event.pointerType !== "touch" &&
        (event.pointerType === "mouse" || createTool === "select") &&
        createTool !== "lasso" &&
        event.button === 0 &&
        !event.altKey;
      const point = at(event.currentTarget, event);
      const hit = grabs ? pictureAt(pageNumber, point) : null;
      if (!hit) {
        if (editRef.current) close();
        return false;
      }
      event.preventDefault();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      open(hit.one.id, pageNumber);
      const { x, y, w, h, crop } = hit.one.figure;
      drag.current = {
        pointerId: event.pointerId,
        corner: hit.corner,
        from: point,
        box: { x, y, w, h, crop },
        pageNumber,
      };
      return true;
    },
    // `at` reads only `scale`, which is listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [close, createTool, enabled, open, pictureAt, scale],
  );

  const pointerMove = useCallback(
    (event: React.PointerEvent<HTMLElement>): boolean => {
      const held = drag.current;
      if (!held || held.pointerId !== event.pointerId) return false;
      event.preventDefault();
      const point = at(event.currentTarget, event);
      const dx = point.x - held.from.x;
      const dy = point.y - held.from.y;
      const { box } = held;
      if (held.corner === null) {
        // Clamped so at least half of it stays on the paper, as on a note.
        const width = pageWidth(held.pageNumber);
        const height = pageHeight(held.pageNumber);
        change({
          ...box,
          x: Math.round(Math.min(Math.max(box.x + dx, -box.w / 2), width - box.w / 2)),
          y: Math.round(Math.min(Math.max(box.y + dy, -box.h / 2), height - box.h / 2)),
        });
      } else {
        change({ ...resizeFigureBox(box, held.corner, dx, dy, { free: event.shiftKey }), crop: box.crop });
      }
      return true;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [change, pageHeight, pageWidth, scale],
  );

  const pointerUp = useCallback((event: React.PointerEvent<HTMLElement>): boolean => {
    const held = drag.current;
    if (!held || held.pointerId !== event.pointerId) return false;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    return true;
  }, []);

  return {
    /** The picture being edited, if any. Only on an unrotated page. */
    edit: enabled ? edit : null,
    change,
    reorder,
    remove,
    close,
    pointerDown,
    pointerMove,
    pointerUp,
  };
}

export type PdfPictures = ReturnType<typeof usePdfPictures>;

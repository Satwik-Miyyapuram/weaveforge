"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  canJoinInkGroup,
  inkPathsHitTest,
  inkWidthForPressure,
  meanPressure,
  screenPointToPdf,
  shouldAppendInkPoint,
  translateInkPaths,
  HIGHLIGHTER_WIDTH,
  INK_DEFAULT_WIDTH,
  type PageProjection,
  type PageTextGeometry,
  type ReaderAnnotation,
  type ReaderPageSize,
} from "@weaveforge/core";
import {
  appendInkStroke,
  draftImageRegion,
  draftInkAnnotation,
} from "../../application/draft-local-annotation";
import { isInkTool, type ReaderCreateTool } from "../../application/reader-annotation-helpers";
import {
  EMPTY_ANNOTATIONS,
  ERASER_RADIUS,
  INK_MOVE_THRESHOLD,
  MIN_TEXT_BOX_PDF_SIZE,
} from "./constants";
import type { AnnotationActions } from "./use-annotation-actions";
import type { DraftShape, InkGroup, InkMove, PendingTextBox } from "./types";

export interface PagePointerDeps {
  /** False when the reader cannot write; every gesture then does nothing. */
  canCreate: boolean;
  createTool: ReaderCreateTool;
  createColor: string;
  selectedAnnId: string | null;
  pageSize: ReaderPageSize | null;
  scale: number;
  rotation: number;
  pageGeometries: { current: Map<number, PageTextGeometry> };
  annotations: readonly ReaderAnnotation[];
  /** Annotations bucketed by page; the eraser reads one page, not the document. */
  annotationsByPage: Map<number, ReaderAnnotation[]>;
  persistDraft: AnnotationActions["persistDraft"];
  removeLocal: AnnotationActions["removeLocal"];
  saveAnchor: AnnotationActions["saveAnchor"];
}

export interface PagePointer {
  /** A stylus has been seen, so touch may scroll again. See `sawPen`. */
  penSeen: boolean;
  /** The stroke or region under the pointer right now, painted live. */
  draftShape: DraftShape | null;
  /** Live offset of the mark being dragged, before it is written. */
  movePreview: { id: string; dx: number; dy: number } | null;
  /** True while a drag is moving ink, which is not a text selection. */
  isMovingInk: () => boolean;
  /**
   * End the mark in progress, so the next stroke starts a new annotation.
   * Changing tool or colour mid-sentence must not merge into what came before.
   */
  endInkGroup: () => void;
  pendingTextBox: PendingTextBox | null;
  setPendingTextBox: (box: PendingTextBox | null) => void;
  pendingNote: { color: string } | null;
  setPendingNote: (note: { color: string } | null) => void;
  pageProjection: (pageNumber: number) => PageProjection;
  onPagePointerDown: (pageNumber: number, event: React.PointerEvent<HTMLDivElement>) => void;
  onPagePointerMove: (event: React.PointerEvent<HTMLDivElement>) => void;
  onPagePointerUp: (pageNumber: number, event: React.PointerEvent<HTMLDivElement>) => void;
}

/**
 * Everything the pointer does on a page: draw, erase, move a mark, drag out a
 * region for text or an image.
 *
 * They belong together because one gesture crosses all of them. Pointer-down
 * decides which of them owns the drag, and the refs holding that decision are
 * read again on move and on up; the live preview state exists only for the
 * length of that same gesture.
 */
export function usePagePointer({
  canCreate,
  createTool,
  createColor,
  selectedAnnId,
  pageSize,
  scale,
  rotation,
  pageGeometries,
  annotations,
  annotationsByPage,
  persistDraft,
  removeLocal,
  saveAnchor,
}: PagePointerDeps): PagePointer {
  const inkPath = useRef<number[]>([]);
  /** Pressure reported for the stroke being drawn; one width is derived on release. */
  const inkPressures = useRef<number[]>([]);
  /** Pointer that owns the stroke in progress, so a second contact cannot join it. */
  const inkPointerId = useRef<number | null>(null);
  /**
   * Whether a stylus has ever touched this reader.
   *
   * Palm rejection, without a device API for it: a tablet reports the hand
   * resting on the glass as an ordinary `touch` pointer, indistinguishable from
   * a fingertip, so drawing turned every resting palm into a stroke. Once a pen
   * has been seen, touch stops drawing and goes back to scrolling — which is
   * also what a pen user wants their finger to do. On a device with no pen this
   * never trips, and finger drawing keeps working.
   */
  const sawPen = useRef(false);
  /**
   * Mirrors `sawPen` into render, so the page can hand touch scrolling back
   * once a pen is in use. A drawing tool otherwise pins `touch-action: none`
   * on every page and the document cannot be scrolled by finger at all.
   */
  const [penSeen, setPenSeen] = useState(false);
  /** The ink annotation the last stroke went into, for stroke grouping. */
  const inkGroup = useRef<InkGroup | null>(null);
  const inkMove = useRef<InkMove | null>(null);
  /** Ink deleted by the current eraser drag, so one pass deletes each mark once. */
  const erasedIds = useRef<Set<string>>(new Set());
  const dragRect = useRef<{
    pageNumber: number;
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  } | null>(null);
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
   * Live offset of the ink mark being dragged. Held here rather than pushed
   * through `onAnnotationsChange` so a move repaints without writing to the
   * annotation list (and the server) on every frame.
   */
  const [movePreview, setMovePreview] = useState<{ id: string; dx: number; dy: number } | null>(
    null,
  );
  const moveFrame = useRef<number | null>(null);
  const pendingMove = useRef<{ id: string; dx: number; dy: number } | null>(null);
  /** Region a text annotation was drawn over, awaiting its text. */
  const [pendingTextBox, setPendingTextBox] = useState<PendingTextBox | null>(null);
  /** Sticky note awaiting its comment, with the colour chosen for it. */
  const [pendingNote, setPendingNote] = useState<{ color: string } | null>(null);
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

  /** Same frame budget for a move as for a stroke — see `scheduleDraft`. */
  const scheduleMove = useCallback((next: { id: string; dx: number; dy: number } | null) => {
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
    },
    [],
  );

  /** The projection for one rendered page: its size, the zoom, and the rotation. */
  function pageProjection(pageNumber: number): PageProjection {
    const geometry = pageGeometries.current.get(pageNumber);
    return {
      pageWidth: geometry?.pageWidth ?? pageSize?.width ?? 0,
      pageHeight: geometry?.pageHeight ?? pageSize?.height ?? 0,
      scale,
      rotation,
    };
  }

  function screenToPdf(pageHost: HTMLElement, clientX: number, clientY: number) {
    const rect = pageHost.getBoundingClientRect();
    const pageNumber = Number(pageHost.dataset.page);
    // Rotation is part of the mapping, not a reason to refuse to draw: the
    // create tools used to switch off entirely at 90/180/270, which is exactly
    // the orientation a scanned landscape page is read in.
    return screenPointToPdf(clientX - rect.left, clientY - rect.top, pageProjection(pageNumber));
  }

  /**
   * Whether this pointer is allowed to draw. See `sawPen` — a palm resting on a
   * tablet arrives as a `touch` pointer and would otherwise scribble.
   */
  function pointerMayDraw(event: React.PointerEvent): boolean {
    if (event.pointerType === "pen") {
      if (!sawPen.current) {
        sawPen.current = true;
        setPenSeen(true);
      }
      return true;
    }
    if (event.pointerType === "touch") return !sawPen.current;
    return true;
  }

  /**
   * Ink annotations on this page whose stroke passes within `radius` of a point.
   *
   * Reads the page's bucket rather than the whole document: the eraser runs this
   * on every pointer move, and scanning every annotation in a heavily marked-up
   * paper to find the handful on the page under the pen is work for nothing.
   */
  function inkAnnotationsAt(pageNumber: number, x: number, y: number, radius: number) {
    const onPage = annotationsByPage.get(pageNumber) ?? EMPTY_ANNOTATIONS;
    return onPage.filter((ann) => {
      if (ann.type !== "ink") return false;
      const position = ann.anchor.zoteroPosition;
      if (!position?.paths?.length || position.pageIndex !== pageNumber - 1) return false;
      const nib = typeof position.width === "number" ? position.width : INK_DEFAULT_WIDTH;
      return inkPathsHitTest(position.paths, x, y, radius + nib / 2);
    });
  }

  /** Delete every ink mark the eraser is touching, once per drag. */
  function eraseAt(pageNumber: number, x: number, y: number) {
    for (const ann of inkAnnotationsAt(pageNumber, x, y, ERASER_RADIUS)) {
      if (ann.origin !== "local") continue;
      if (erasedIds.current.has(ann.id)) continue;
      erasedIds.current.add(ann.id);
      // A stroke being erased must not also be the group the next stroke joins.
      if (inkGroup.current?.annotationId === ann.id) inkGroup.current = null;
      void removeLocal(ann.id, { confirm: false });
    }
  }

  /**
   * Save a finished stroke, joining the mark in progress when there is one.
   *
   * See `canJoinInkGroup`: strokes drawn in one breath, same nib, same colour,
   * same page are one annotation. That is what stops a handwritten sentence
   * becoming twenty rows in the table and twenty entries in the sidebar.
   */
  async function persistInkStroke(input: {
    pageNumber: number;
    pageHeight: number;
    path: number[];
    width: number;
  }) {
    const pageIndex = input.pageNumber - 1;
    const now = Date.now();
    const group = inkGroup.current;

    if (
      canJoinInkGroup(group, { pageIndex, color: createColor, width: input.width, at: now }) &&
      group
    ) {
      const existing = annotations.find((a) => a.id === group.annotationId);
      const merged = existing ? appendInkStroke(existing.anchor, input.path) : null;
      if (existing && merged) {
        inkGroup.current = {
          ...group,
          pathCount: merged.zoteroPosition?.paths?.length ?? group.pathCount + 1,
          lastAt: now,
        };
        await saveAnchor(existing, merged);
        return;
      }
      // The group's row is gone (erased, or still being created) — fall through
      // and start a fresh mark rather than dropping the stroke.
      inkGroup.current = null;
    }

    const draft = draftInkAnnotation({
      color: createColor,
      pageIndex,
      pageHeight: input.pageHeight,
      path: input.path,
      width: input.width,
    });
    if (!draft) return;
    const created = await persistDraft(draft);
    if (created) {
      inkGroup.current = {
        annotationId: created.id,
        pageIndex,
        color: createColor,
        width: input.width,
        pathCount: created.anchor.zoteroPosition?.paths?.length ?? 1,
        lastAt: Date.now(),
      };
    }
  }

  /** Write a finished move to the annotation's stored paths. */
  async function commitInkMove(move: InkMove) {
    if (Math.hypot(move.dx, move.dy) < INK_MOVE_THRESHOLD) return;
    const ann = annotations.find((a) => a.id === move.annotationId);
    const position = ann?.anchor.zoteroPosition;
    if (!ann || !position?.paths?.length) return;
    // A moved mark is no longer where the group left off; the next stroke is a
    // new mark rather than a jump back to the old position.
    if (inkGroup.current?.annotationId === ann.id) inkGroup.current = null;
    await saveAnchor(ann, {
      ...ann.anchor,
      zoteroPosition: {
        ...position,
        paths: translateInkPaths(position.paths, move.dx, move.dy),
      },
    });
  }

  /** Nib width for a fresh stroke: the tool's base, scaled by pen pressure. */
  function inkWidthForEvent(event: React.PointerEvent): number {
    const base = createTool === "highlighter" ? HIGHLIGHTER_WIDTH : INK_DEFAULT_WIDTH;
    return inkWidthForPressure(event.pressure, base);
  }

  function onPagePointerDown(pageNumber: number, event: React.PointerEvent<HTMLDivElement>) {
    if (!canCreate || !pageSize) return;
    const host = event.currentTarget;
    const pt = screenToPdf(host, event.clientX, event.clientY);

    // The select tool doubles as the move tool: pressing inside a selected ink
    // mark picks it up. Ink was previously fixed where it landed, so a stroke
    // drawn in the wrong place could only be deleted and redrawn.
    if (createTool === "select") {
      if (!selectedAnnId) return;
      const hit = inkAnnotationsAt(pageNumber, pt.x, pt.y, ERASER_RADIUS).some(
        (ann) => ann.id === selectedAnnId,
      );
      if (!hit) return;
      event.preventDefault();
      inkMove.current = {
        annotationId: selectedAnnId,
        pointerId: event.pointerId,
        pageNumber,
        fromX: pt.x,
        fromY: pt.y,
        dx: 0,
        dy: 0,
      };
      host.setPointerCapture(event.pointerId);
      return;
    }

    if (!pointerMayDraw(event)) return;
    event.preventDefault();

    if (createTool === "erase") {
      erasedIds.current = new Set();
      host.setPointerCapture(event.pointerId);
      eraseAt(pageNumber, pt.x, pt.y);
      return;
    }

    if (isInkTool(createTool)) {
      // One contact owns the stroke. Without this a palm landing mid-stroke on
      // a pen-less tablet would splice its own path into the same line.
      if (inkPointerId.current != null) return;
      inkPointerId.current = event.pointerId;
      inkPath.current = [pt.x, pt.y];
      inkPressures.current = [event.pressure];
      scheduleDraft({
        kind: "ink",
        pageNumber,
        path: [pt.x, pt.y],
        width: inkWidthForEvent(event),
        highlighter: createTool === "highlighter",
      });
      host.setPointerCapture(event.pointerId);
      return;
    }
    // Both tools drag out a region. Text used to place a fixed 120x24 box
    // wherever you clicked, with no way to say how big it should be.
    if (createTool === "image" || createTool === "text") {
      dragRect.current = {
        pageNumber,
        x0: pt.x,
        y0: pt.y,
        x1: pt.x,
        y1: pt.y,
      };
      scheduleDraft({ kind: "rect", pageNumber, x0: pt.x, y0: pt.y, x1: pt.x, y1: pt.y });
      host.setPointerCapture(event.pointerId);
    }
  }

  function onPagePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!canCreate) return;
    const host = event.currentTarget;
    const pageNumber = Number(host.dataset.page);
    const pt = screenToPdf(host, event.clientX, event.clientY);

    const move = inkMove.current;
    if (move && move.pointerId === event.pointerId) {
      move.dx = pt.x - move.fromX;
      move.dy = pt.y - move.fromY;
      scheduleMove({ id: move.annotationId, dx: move.dx, dy: move.dy });
      return;
    }

    if (createTool === "erase" && event.buttons !== 0) {
      eraseAt(pageNumber, pt.x, pt.y);
      return;
    }

    if (
      isInkTool(createTool) &&
      inkPointerId.current === event.pointerId &&
      inkPath.current.length >= 2
    ) {
      // Samples inside the pen's own jitter carry no shape and would be stored
      // forever; dropping them here also keeps the live preview cheap.
      if (!shouldAppendInkPoint(inkPath.current, pt.x, pt.y)) return;
      inkPath.current.push(pt.x, pt.y);
      inkPressures.current.push(event.pressure);
      scheduleDraft({
        kind: "ink",
        pageNumber,
        path: [...inkPath.current],
        width: inkWidthForEvent(event),
        highlighter: createTool === "highlighter",
      });
      return;
    }
    if ((createTool === "image" || createTool === "text") && dragRect.current) {
      dragRect.current.x1 = pt.x;
      dragRect.current.y1 = pt.y;
      scheduleDraft({ kind: "rect", ...dragRect.current });
    }
  }

  function onPagePointerUp(pageNumber: number, event: React.PointerEvent<HTMLDivElement>) {
    if (!canCreate || !pageSize) return;

    const move = inkMove.current;
    if (move && move.pointerId === event.pointerId) {
      inkMove.current = null;
      scheduleMove(null);
      void commitInkMove(move);
      return;
    }

    if (createTool === "erase") {
      erasedIds.current = new Set();
      return;
    }

    // The persisted annotation takes over from here; drop the live preview so
    // the two cannot both be painted for a frame.
    clearDraft();
    if (isInkTool(createTool) && inkPointerId.current === event.pointerId) {
      const path = [...inkPath.current];
      const pressures = [...inkPressures.current];
      inkPath.current = [];
      inkPressures.current = [];
      inkPointerId.current = null;
      if (path.length >= 4) {
        const pageHeight =
          pageGeometries.current.get(pageNumber)?.pageHeight ?? pageSize.height;
        void persistInkStroke({
          pageNumber,
          pageHeight,
          path,
          width: inkWidthForPressure(
            meanPressure(pressures),
            createTool === "highlighter" ? HIGHLIGHTER_WIDTH : INK_DEFAULT_WIDTH,
          ),
        });
      }
      return;
    }
    inkPath.current = [];
    inkPressures.current = [];
    inkPointerId.current = null;
    if (createTool === "text" && dragRect.current) {
      const d = dragRect.current;
      dragRect.current = null;
      if (d.pageNumber !== pageNumber) return;
      const pageHeight =
        pageGeometries.current.get(pageNumber)?.pageHeight ?? pageSize.height;
      const width = Math.abs(d.x1 - d.x0);
      const height = Math.abs(d.y1 - d.y0);
      // Hand off to the in-app composer rather than window.prompt, which is an
      // unstyled OS dialog and on mobile hides the page you are annotating.
      setPendingTextBox({
        pageIndex: pageNumber - 1,
        pageHeight,
        x: Math.min(d.x0, d.x1),
        y: Math.min(d.y0, d.y1),
        // A tap rather than a drag still works: fall back to the default box
        // size rather than creating something zero-sized and invisible.
        ...(width >= MIN_TEXT_BOX_PDF_SIZE && height >= MIN_TEXT_BOX_PDF_SIZE
          ? { width, height }
          : {}),
      });
      return;
    }
    if (createTool === "image" && dragRect.current) {
      const d = dragRect.current;
      dragRect.current = null;
      if (d.pageNumber !== pageNumber) return;
      const pageHeight =
        pageGeometries.current.get(pageNumber)?.pageHeight ?? pageSize.height;
      const draft = draftImageRegion({
        color: createColor,
        pageIndex: pageNumber - 1,
        pageHeight,
        rect: [
          Math.min(d.x0, d.x1),
          Math.min(d.y0, d.y1),
          Math.max(d.x0, d.x1),
          Math.max(d.y0, d.y1),
        ],
      });
      if (draft) void persistDraft(draft);
    }
    void event;
  }

  return {
    penSeen,
    draftShape,
    movePreview,
    isMovingInk: () => inkMove.current != null,
    endInkGroup: () => {
      inkGroup.current = null;
    },
    pendingTextBox,
    setPendingTextBox,
    pendingNote,
    setPendingNote,
    pageProjection,
    onPagePointerDown,
    onPagePointerMove,
    onPagePointerUp,
  };
}

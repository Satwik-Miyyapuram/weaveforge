"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  canJoinInkGroup,
  inkPathsHitTest,
  inkPathsInPolygon,
  inkWidthForPressure,
  inkNoteWidthToPdfPoints,
  meanPressure,
  screenPointToPdf,
  shouldAppendInkPoint,
  translateInkPaths,
  INK_HIGHLIGHTER_WIDTH,
  INK_DEFAULT_WIDTH,
  type PageProjection,
  type PageTextGeometry,
  type ReaderAnnotation,
  type ReaderPageSize,
} from "@weaveforge/core";
// The shared palm rules, through ink's public API: an ink note needs the same
// three layers this reader already had, so they live in one place rather than in
// two implementations that would drift.
import { InkPenGate } from "@/features/ink";
import {
  appendInkStroke,
  draftImageRegion,
  draftInkAnnotation,
} from "../../application/draft-local-annotation";
import { clipSegmentToArea, pointInArea } from "../../application/clip-to-area";
import { isInkTool, type ReaderCreateTool } from "../../application/reader-annotation-helpers";
import {
  EMPTY_ANNOTATIONS,
  ERASER_RADIUS,
  INK_MOVE_THRESHOLD,
  MIN_TEXT_BOX_PDF_SIZE,
} from "./constants";
import type { AnnotationActions } from "./use-annotation-actions";
import { usePointerPreviews } from "./use-pointer-previews";
import { drawArea, pageBoxOf } from "./page-box";
import type { DraftShape, InkGroup, InkMove, PendingTextBox } from "./types";

export interface PagePointerDeps {
  /** False when the reader cannot write; every gesture then does nothing. */
  canCreate: boolean;
  createTool: ReaderCreateTool;
  createColor: string;
  /**
   * Whether the page's ink can be written and picked up — the pen is out.
   *
   * With the pen away the ink is rendered and read-only: the pointer tool then
   * has one job, which is the page's own text, and a press that lands on a
   * stroke goes through it to the words underneath rather than picking the
   * stroke up.
   */
  inkEditable: boolean;
  /** Pen nib in PDF points, before pressure. Defaults to `INK_DEFAULT_WIDTH`. */
  inkWidth?: number;
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
  /** Live offset of the marks being dragged, before it is written. */
  movePreview: { ids: string[]; dx: number; dy: number } | null;
  /** True while a drag is moving ink, which is not a text selection. */
  isMovingInk: () => boolean;
  /**
   * The loop the pointer tool is drawing, in PDF user space, or null.
   *
   * The lasso is the sheet's gesture on a paper: drag a ring round the marks,
   * and what is inside is selected. It is drawn while it is being drawn, the
   * way the sheet draws it.
   */
  lassoPath: readonly number[] | null;
  /** The page the loop is on; the loop is one page's marks. */
  lassoPage: number | null;
  /** The ink marks the last loop caught, by annotation id. */
  lassoed: readonly string[];
  /** Let the selection go — on a tool change, a new page, or after a delete. */
  clearLasso: () => void;
  /**
   * End the mark in progress, so the next stroke starts a new annotation.
   * Changing tool or colour mid-sentence must not merge into what came before.
   */
  endInkGroup: () => void;
  /**
   * Throw away the mark in progress, without writing it.
   *
   * A second finger landing turns the first one's stroke into a pinch, and a
   * half-drawn stroke must not be saved — it was a hand resting on the glass,
   * not a line. The sheet does the same when a palm arrives.
   */
  cancelStroke: () => void;
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
  inkEditable,
  inkWidth = INK_DEFAULT_WIDTH,
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
   * Which pointer may draw, which is ink's palm handling and not the reader's.
   *
   * Palm rejection without a device API: a tablet reports the hand resting on the
   * glass as an ordinary `touch` pointer, indistinguishable from a fingertip, so
   * drawing turned every resting palm into a stroke. The rules live in
   * `features/ink` because an ink note needs exactly the same ones — and this is
   * the layer §3.1 says to keep *exactly* as it is, which is why the reader still
   * draws a touch immediately rather than deferring it (see `pointerMayDraw`).
   */
  const penGate = useRef<InkPenGate>(new InkPenGate({ handedness: "right" }));
  /**
   * Mirrors the gate's pen flag into render, so the page can hand touch scrolling
   * back once a pen is in use. A drawing tool otherwise pins `touch-action: none`
   * on every page and the document cannot be scrolled by finger at all.
   */
  const [penSeen, setPenSeen] = useState(false);
  /** The ink annotation the last stroke went into, for stroke grouping. */
  const inkGroup = useRef<InkGroup | null>(null);
  /**
   * Whether the pen is off the paper right now, and where it was last seen in
   * client pixels — the point the clip is measured from when it comes back.
   */
  const inkOutside = useRef(false);
  const lastInkPoint = useRef<{ x: number; y: number } | null>(null);
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
  const {
    draftShape, scheduleDraft, clearDraft,
    movePreview, scheduleMove,
    lasso, lassoPointerId, lassoPage, lassoPath, publishLasso, lassoed, setLassoed, clearLasso,
  } = usePointerPreviews();
  /** Region a text annotation was drawn over, awaiting its text. */
  const [pendingTextBox, setPendingTextBox] = useState<PendingTextBox | null>(null);
  /** Sticky note awaiting its comment, with the colour chosen for it. */
  const [pendingNote, setPendingNote] = useState<{ color: string } | null>(null);
  /**
   * Changing tool — or putting the pen down — lets the lasso go.
   *
   * A selection belongs to the tool that made it: leaving it up while the pen
   * is in hand would draw halos round marks nobody is pointing at, and the next
   * press over one of them would drag the selection instead of drawing. With
   * the pen away there is no selection to hold at all, because the ink is
   * read-only.
   */
  useEffect(() => {
    clearLasso();
  }, [createTool, inkEditable, clearLasso]);

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

  function screenToPdf(row: Element, clientX: number, clientY: number) {
    const rect = pageBoxOf(row).getBoundingClientRect();
    const pageNumber = Number((row as HTMLElement).dataset.page);
    // Rotation is part of the mapping, not a reason to refuse to draw: the
    // create tools used to switch off entirely at 90/180/270, which is exactly
    // the orientation a scanned landscape page is read in.
    return screenPointToPdf(clientX - rect.left, clientY - rect.top, pageProjection(pageNumber));
  }

  /**
   * Whether this pointer is allowed to draw.
   *
   * The palm rules are ink's (`InkPenGate`); what is the reader's is the answer to
   * a deferred touch. The plan's rule five holds a touch for 120 ms to see whether
   * it moves, and an ink note wants that because its surface has no scroll of its
   * own. A PDF page already scrolls by finger through `touch-action`, so deferring
   * here would add latency to finger drawing without buying anything — the
   * deferred verdict is therefore read as "draw", which is what this reader has
   * always done.
   */
  function pointerMayDraw(event: React.PointerEvent): boolean {
    const decision = penGate.current.decide({
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      pressure: event.pressure,
      width: event.nativeEvent.width,
      height: event.nativeEvent.height,
      clientX: event.clientX,
      clientY: event.clientY,
      // The quadrant rule asks where the writing hand rests, so its box must be
      // the page the hand is on — not the row, whose right half is the strip
      // that exists precisely to be written on.
      bounds: pageBoxOf(event.currentTarget).getBoundingClientRect(),
      t: event.timeStamp,
    });
    if (decision === "ignore") return false;
    if (event.pointerType === "pen" && !penSeen) setPenSeen(true);
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
      // No confirmation, and none offered: rubbing out a word is a dozen marks
      // in one drag, and a dialog per stroke would make the eraser unusable.
      // The gesture is already deliberate, and ink undo puts it back.
      void removeLocal(ann.id);
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

  /** Write a finished move to the stored paths of every mark it carried. */
  async function commitInkMove(move: InkMove) {
    if (Math.hypot(move.dx, move.dy) < INK_MOVE_THRESHOLD) return;
    for (const id of move.annotationIds) {
      const ann = annotations.find((a) => a.id === id);
      const position = ann?.anchor.zoteroPosition;
      if (!ann || !position?.paths?.length) continue;
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
  }

  /**
   * The ink the current selection holds: the lasso's marks, or the one the list
   * picked out. What a drag inside the selection moves, and what the bar's
   * Delete acts on.
   */
  function selectionIds(): string[] {
    if (lassoed.length > 0) return [...lassoed];
    return selectedAnnId ? [selectedAnnId] : [];
  }

  /**
   * The ink on a page the loop has caught.
   *
   * Judged per annotation, on all of its strokes together
   * (`inkPathsInPolygon`): a mark is one thing the hand wrote, and a loop round
   * most of it picks up the whole of it.
   */
  function inkAnnotationsInLoop(pageNumber: number, polygon: readonly number[]): string[] {
    const onPage = annotationsByPage.get(pageNumber) ?? EMPTY_ANNOTATIONS;
    return onPage
      .filter((ann) => {
        if (ann.type !== "ink") return false;
        const position = ann.anchor.zoteroPosition;
        if (!position?.paths?.length || position.pageIndex !== pageNumber - 1) return false;
        return inkPathsInPolygon(position.paths, polygon);
      })
      .map((ann) => ann.id);
  }

  /**
   * The nib before pressure: the highlighter's is fixed, the pen's is chosen.
   *
   * The highlighter's is the ink note's 6 mm, converted once — the reader
   * carries no nib set of its own any more, so a highlighter is the same band
   * on a paper as on a sheet of ruled paper.
   */
  const nibBase =
    createTool === "highlighter"
      ? inkNoteWidthToPdfPoints(INK_HIGHLIGHTER_WIDTH)
      : inkWidth;

  /** Nib width for a fresh stroke: the tool's base, scaled by pen pressure. */
  function inkWidthForEvent(event: React.PointerEvent): number {
    return inkWidthForPressure(event.pressure, nibBase);
  }

  function onPagePointerDown(pageNumber: number, event: React.PointerEvent<HTMLDivElement>) {
    if (!canCreate || !pageSize) return;
    const host = event.currentTarget;
    const pt = screenToPdf(host, event.clientX, event.clientY);

    // The lasso is the sheet's gesture on a paper, and the *only* thing its
    // tool does: a drag from anywhere draws a loop, and what is inside is
    // picked up. Anywhere, not only on a mark — a hand rings the marks it wants
    // and should not have to start exactly on one — and the page's text is not
    // in the way, because with this tool armed the text layer takes no pointer
    // (`.pdf-reader-page--draw`, reader.css). A press *inside* a selection
    // already made drags it instead, which is how a loop is moved.
    if (createTool === "lasso" && inkEditable) {
      const held = selectionIds();
      const hit = inkAnnotationsAt(pageNumber, pt.x, pt.y, ERASER_RADIUS);
      event.preventDefault();
      if (held.length > 0 && hit.some((ann) => held.includes(ann.id))) {
        inkMove.current = {
          annotationIds: held,
          pointerId: event.pointerId,
          pageNumber,
          fromX: pt.x,
          fromY: pt.y,
          dx: 0,
          dy: 0,
        };
      } else {
        lasso.current = [pt.x, pt.y];
        lassoPointerId.current = event.pointerId;
        lassoPage.current = pageNumber;
        setLassoed([]);
        publishLasso(lasso.current);
      }
      host.setPointerCapture(event.pointerId);
      return;
    }

    // The reader's own pointer: a press is the page's, so a stroke lying over a
    // paragraph does not stand between the pen and the words.
    if (createTool === "select") return;

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
      // A stroke begins on the paper: the press that started it landed here.
      inkOutside.current = false;
      lastInkPoint.current = { x: event.clientX, y: event.clientY };
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
      scheduleMove({ ids: move.annotationIds, dx: move.dx, dy: move.dy });
      return;
    }

    if (lassoPointerId.current === event.pointerId) {
      // A loop is a shape, and samples inside the pointer's own jitter carry
      // none of it: the rule the stroke path uses keeps the polygon short too.
      if (shouldAppendInkPoint(lasso.current, pt.x, pt.y)) {
        lasso.current.push(pt.x, pt.y);
        publishLasso(lasso.current);
      }
      return;
    }

    if (createTool === "erase" && event.buttons !== 0) {
      eraseAt(pageNumber, pt.x, pt.y);
      return;
    }

    if (
      isInkTool(createTool) &&
      inkPointerId.current === event.pointerId &&
      // A stroke in hand, *or* a pen that is off the paper: cutting the stroke at
      // the edge empties the path, and the return that starts the next one has
      // to be let in — it is the same gesture, and the contact is still ours.
      (inkPath.current.length >= 2 || inkOutside.current)
    ) {
      /*
       * The stroke is cut at the edge of the row — the page and the writing
       * margin beside it — and starts again as a *new* stroke where the pen
       * comes back. A hand does not stop at the edge of the paper, and a stroke
       * that collected points through everything it passed over would come back
       * with a line drawn across a gap the page does not own.
       *
       * Whether the point is in the area is asked of the point; *where* the pen
       * crossed is asked of the segment, so the ink reaches the edge exactly
       * rather than stopping a sample short of it — and the area is the page
       * inset by half the nib, so the ink's own edge is what lands on the page's.
       */
      const nibPx = inkWidthForEvent(event) * scale;
      const area = drawArea(host, nibPx / 2);
      const at = { x: event.clientX, y: event.clientY };
      const previous = lastInkPoint.current ?? at;
      const onPaper = !area || pointInArea(area, at.x, at.y);

      if (inkOutside.current) {
        if (!onPaper) {
          // Still outside: the pen's travel leaves no mark at all.
          lastInkPoint.current = at;
          return;
        }
        // Back on the paper: a new stroke, beginning where the pen crossed in.
        const crossing = area ? clipSegmentToArea(area, previous, at) : null;
        const entry = screenToPdf(host, crossing?.from.x ?? at.x, crossing?.from.y ?? at.y);
        inkPath.current = [entry.x, entry.y];
        inkPressures.current = [event.pressure];
        inkOutside.current = false;
        lastInkPoint.current = at;
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

      if (!onPaper) {
        // The pen has left: finish the stroke at the edge it crossed and wait.
        const crossing = area ? clipSegmentToArea(area, previous, at) : null;
        const cut = screenToPdf(host, crossing?.to.x ?? at.x, crossing?.to.y ?? at.y);
        if (shouldAppendInkPoint(inkPath.current, cut.x, cut.y)) {
          inkPath.current.push(cut.x, cut.y);
          inkPressures.current.push(event.pressure);
        }
        const height =
          pageGeometries.current.get(pageNumber)?.pageHeight ?? pageSize?.height;
        if (height) {
          void persistInkStroke({
            pageNumber,
            pageHeight: height,
            path: [...inkPath.current],
            width: inkWidthForPressure(meanPressure([...inkPressures.current]), nibBase),
          });
        }
        inkPath.current = [];
        inkPressures.current = [];
        inkOutside.current = true;
        clearDraft();
        lastInkPoint.current = at;
        return;
      }

      lastInkPoint.current = at;
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

    if (lassoPointerId.current === event.pointerId) {
      lassoPointerId.current = null;
      const loop = lasso.current;
      const loopPage = lassoPage.current ?? pageNumber;
      lasso.current = [];
      lassoPage.current = null;
      publishLasso(null);
      // A loop needs an area, not a line: a tap or a flick is not a lasso, and
      // reading one as an empty selection would drop the marks the last loop
      // caught every time a hand brushed the page.
      if (loop.length >= 6) setLassoed(inkAnnotationsInLoop(loopPage, loop));
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
      // A pen that lifted off the paper has already been cut and written at the
      // edge it crossed; there is nothing left in hand to save.
      const cutAtEdge = inkOutside.current;
      inkOutside.current = false;
      lastInkPoint.current = null;
      if (!cutAtEdge && path.length >= 4) {
        const pageHeight =
          pageGeometries.current.get(pageNumber)?.pageHeight ?? pageSize.height;
        void persistInkStroke({
          pageNumber,
          pageHeight,
          path,
          width: inkWidthForPressure(meanPressure(pressures), nibBase),
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
    lassoPath,
    lassoPage: lassoPath ? lassoPage.current : null,
    lassoed,
    clearLasso,
    endInkGroup: () => {
      inkGroup.current = null;
    },
    cancelStroke: () => {
      inkPath.current = [];
      inkPressures.current = [];
      inkPointerId.current = null;
      dragRect.current = null;
      inkMove.current = null;
      lassoPointerId.current = null;
      lasso.current = [];
      lassoPage.current = null;
      clearDraft();
      publishLasso(null);
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

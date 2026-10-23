"use client";

import { useEffect, useRef, useState } from "react";
import {
  canJoinInkGroup,
  inkPathsHitTest,
  inkPathsInPolygon,
  inkNoteWidthToPdfPoints,
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
import { ERASER_CURSOR, ERASER_SCREEN_RADIUS, InkGesture, InkPenGate, StrokeEdgeSplit, type InkToolKind } from "@/features/ink";
import {
  appendInkStroke,
  draftImageRegion,
  eraseInkPaths,
  draftInkAnnotation,
} from "../../application/draft-local-annotation";
import { PdfInkSampler, coalescedSamples } from "../../application/pdf-ink-sampler";
import { isInkTool, type ReaderCreateTool } from "../../application/reader-annotation-helpers";
import {
  EMPTY_ANNOTATIONS,
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
  /** Highlighter nib in the note's 0.1 mm. Defaults to `INK_HIGHLIGHTER_WIDTH`. */
  highlighterWidth?: number;
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
  pageProjection: (pageNumber: number) => PageProjection;
  onPagePointerDown: (pageNumber: number, event: React.PointerEvent<HTMLDivElement>) => void;
  onPagePointerMove: (event: React.PointerEvent<HTMLDivElement>) => void;
  onPagePointerUp: (pageNumber: number, event: React.PointerEvent<HTMLDivElement>) => void;
  onPagePointerLeave: (event: React.PointerEvent<HTMLDivElement>) => void;
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
  highlighterWidth = INK_HIGHLIGHTER_WIDTH,
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
  /** The stroke being drawn, filtered the way a note's pen is. */
  const ink = useRef(new PdfInkSampler());
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
  /** The stroke against the page's edge; shared with Notes. */
  const edge = useRef(new StrokeEdgeSplit());
  const inkMove = useRef<InkMove | null>(null);
  /**
   * What the current eraser drag has left of each mark it touched: the trimmed
   * anchor, or null once the mark is gone. A save lands after the next pointer
   * move, so the drag works from this rather than the stale annotation.
   */
  const erased = useRef<Map<string, ReaderAnnotation["anchor"] | null>>(new Map());
  /** Each pointer's route from down to up; shared with Notes. */
  const gesture = useRef(new InkGesture(ERASER_CURSOR));
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

  /** Rub out the strokes the eraser is touching; a mark goes once none are left. */
  function eraseAt(pageNumber: number, x: number, y: number) {
    // The reach is fixed on screen; `scale` is CSS px per PDF unit at this zoom.
    const radius = ERASER_SCREEN_RADIUS / scale;
    for (const ann of inkAnnotationsAt(pageNumber, x, y, radius)) {
      if (ann.origin !== "local") continue;
      const current = erased.current.has(ann.id) ? erased.current.get(ann.id) : ann.anchor;
      if (!current) continue;
      const nib = current.zoteroPosition?.width ?? INK_DEFAULT_WIDTH;
      const next = eraseInkPaths(current, x, y, radius + nib / 2);
      if (next === current) continue;
      erased.current.set(ann.id, next);
      // A mark being erased must not also be the group the next stroke joins.
      if (inkGroup.current?.annotationId === ann.id) inkGroup.current = null;
      // No confirmation, and none offered: rubbing out a word is a dozen marks
      // in one drag, and a dialog per stroke would make the eraser unusable.
      // The gesture is already deliberate, and ink undo puts it back.
      if (next) void saveAnchor({ ...ann, anchor: current }, next);
      else void removeLocal(ann.id);
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
   * The nib, constant along the stroke as on a note: the highlighter's is fixed, the pen's is chosen.
   *
   * The highlighter's is the ink note's 6 mm, converted once — the reader
   * carries no nib set of its own any more, so a highlighter is the same band
   * on a paper as on a sheet of ruled paper.
   */
  const nibBase =
    createTool === "highlighter"
      ? inkNoteWidthToPdfPoints(highlighterWidth)
      : inkWidth;

  function startErase(pageNumber: number, event: React.PointerEvent<HTMLDivElement>, pt: { x: number; y: number }) {
    event.preventDefault();
    erased.current = new Map();
    event.currentTarget.setPointerCapture(event.pointerId);
    eraseAt(pageNumber, pt.x, pt.y);
  }

  /** The armed tool as the shared gesture sees it; the lasso needs editable ink. */
  function toolKind(): InkToolKind {
    if (createTool === "select") return "none";
    if (createTool === "lasso") return inkEditable ? "lasso" : "none";
    if (createTool === "erase") return "eraser";
    if (isInkTool(createTool)) return "draw";
    return "region";
  }

  function onPagePointerDown(pageNumber: number, event: React.PointerEvent<HTMLDivElement>) {
    if (!canCreate || !pageSize) return;
    const host = event.currentTarget;
    const pt = screenToPdf(host, event.clientX, event.clientY);

    const route = gesture.current.down(event, {
      tool: toolKind(),
      // The pen's back tip erases whatever tool is armed, as on a sheet of Notes.
      tipErases: inkEditable && createTool !== "lasso",
      admit: () => pointerMayDraw(event),
      hitSelection: () => {
        const held = selectionIds();
        return held.length > 0 && inkAnnotationsAt(pageNumber, pt.x, pt.y, ERASER_SCREEN_RADIUS / scale).some((ann) => held.includes(ann.id));
      },
    });
    // No tool, or a pointer the palm rules refuse: a press is the page's, so a
    // stroke lying over a paragraph does not stand between the pen and the words.
    if (!route) return;
    event.preventDefault();

    if (route === "erase") {
      startErase(pageNumber, event, pt);
      return;
    }

    // The lasso is the sheet's gesture on a paper: a drag from anywhere draws a
    // loop and picks up what is inside, and a press inside a selection drags it.
    // The text layer takes no pointer with it armed (`.pdf-reader-page--draw`).
    if (route === "drag") {
      inkMove.current = {
        annotationIds: selectionIds(),
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
    if (route === "lasso") {
      lasso.current = [pt.x, pt.y];
      lassoPointerId.current = event.pointerId;
      lassoPage.current = pageNumber;
      setLassoed([]);
      publishLasso(lasso.current);
      host.setPointerCapture(event.pointerId);
      return;
    }

    if (isInkTool(createTool)) {
      // One contact owns the stroke. Without this a palm landing mid-stroke on
      // a pen-less tablet would splice its own path into the same line.
      if (inkPointerId.current != null) return;
      inkPointerId.current = event.pointerId;
      ink.current.begin(pt.x, pt.y, event.timeStamp);
      // A stroke begins on the paper: the press that started it landed here.
      edge.current.begin({ x: event.clientX, y: event.clientY });
      scheduleDraft({
        kind: "ink",
        pageNumber,
        path: [pt.x, pt.y],
        width: nibBase,
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
    gesture.current.hover(event);
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

    if (gesture.current.route(event.pointerId) === "erase") {
      eraseAt(pageNumber, pt.x, pt.y);
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

    if (
      isInkTool(createTool) &&
      inkPointerId.current === event.pointerId &&
      // A stroke in hand, *or* a pen that is off the paper: cutting the stroke at
      // the edge empties the path, and the return that starts the next one has
      // to be let in — it is the same gesture, and the contact is still ours.
      (ink.current.path.length >= 2 || edge.current.outside)
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
      const nibPx = nibBase * scale;
      const area = drawArea(host, nibPx / 2);
      const step = edge.current.move({ x: event.clientX, y: event.clientY }, area);

      // Still outside: the pen's travel leaves no mark at all.
      if (step.kind === "outside") return;

      if (step.kind === "enter") {
        // Back on the paper: a new stroke, beginning where the pen crossed in.
        const entry = screenToPdf(host, step.at.x, step.at.y);
        ink.current.begin(entry.x, entry.y, event.timeStamp);
        if (!ink.current.push(pt.x, pt.y, event.timeStamp)) return;
        scheduleDraft({
          kind: "ink",
          pageNumber,
          path: [...ink.current.path],
          width: nibBase,
          highlighter: createTool === "highlighter",
        });
        return;
      }

      if (step.kind === "exit") {
        // The pen has left: finish the stroke at the edge it crossed and wait.
        const cut = screenToPdf(host, step.at.x, step.at.y);
        ink.current.pushExact(cut.x, cut.y);
        const height =
          pageGeometries.current.get(pageNumber)?.pageHeight ?? pageSize?.height;
        if (height) {
          void persistInkStroke({
            pageNumber,
            pageHeight: height,
            path: [...ink.current.path],
            width: nibBase,
          });
        }
        ink.current.clear();
        clearDraft();
        return;
      }

      // Every sample the frame merged, through the notes' filter.
      let grew = false;
      for (const sample of coalescedSamples(event.nativeEvent ?? (event as unknown as PointerEvent))) {
        const at = screenToPdf(host, sample.clientX, sample.clientY);
        if (ink.current.push(at.x, at.y, sample.timeStamp)) grew = true;
      }
      if (!grew) return;
      scheduleDraft({
        kind: "ink",
        pageNumber,
        path: [...ink.current.path],
        width: nibBase,
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

  function onPagePointerLeave(event: React.PointerEvent<HTMLDivElement>) {
    gesture.current.leave(event.pointerId);
  }

  function onPagePointerUp(pageNumber: number, event: React.PointerEvent<HTMLDivElement>) {
    const route = gesture.current.up(event.pointerId);
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

    if (route === "erase" || createTool === "erase") {
      erased.current = new Map();
      return;
    }

    // The persisted annotation takes over from here; drop the live preview so
    // the two cannot both be painted for a frame.
    clearDraft();
    if (isInkTool(createTool) && inkPointerId.current === event.pointerId) {
      const path = [...ink.current.path];
      ink.current.clear();
      inkPointerId.current = null;
      // A pen that lifted off the paper has already been cut and written at the
      // edge it crossed; there is nothing left in hand to save.
      const cutAtEdge = edge.current.end();
      if (!cutAtEdge && path.length >= 4) {
        const pageHeight =
          pageGeometries.current.get(pageNumber)?.pageHeight ?? pageSize.height;
        void persistInkStroke({
          pageNumber,
          pageHeight,
          path,
          width: nibBase,
        });
      }
      return;
    }
    ink.current.clear();
    inkPointerId.current = null;
    if (createTool === "text" && dragRect.current) {
      const d = dragRect.current;
      dragRect.current = null;
      if (d.pageNumber !== pageNumber) return;
      const pageHeight =
        pageGeometries.current.get(pageNumber)?.pageHeight ?? pageSize.height;
      const width = Math.abs(d.x1 - d.x0);
      const height = Math.abs(d.y1 - d.y0);
      // Opens the box for typing on the page itself.
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
      ink.current.clear();
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
    pageProjection,
    onPagePointerDown,
    onPagePointerMove,
    onPagePointerUp,
    onPagePointerLeave,
  };
}

"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  clampScale,
  readerKeyboardCommand,
  resolveTextAnchor,
  canJoinInkGroup,
  inkPathsHitTest,
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
  type AnchorConfidence,
  type ReaderContainerSize,
  type ReaderPageSize,
  type DocumentPageText,
  type DocumentSearchMatch,
  type ReaderAnnotationType,
  type FigureTarget,
} from "@weaveforge/core";
import type { TextSelectionRange } from "@weaveforge/core";
// The ink note's own bar, palette and nibs: the reader draws no toolbar of its
// own. See `use-pen-prefs.ts` for how the two tool vocabularies line up.
import {
  InkBar,
  INK_RENDER_COLOURS,
  paletteHex,
  readThemePalette,
  type InkPalette,
} from "@/features/ink";
import { getContainer } from "@/bootstrap";
import { sanitizePdfUrl, originalUrlFromProxy, isAllowedPdfProxyUrl, isReaderObjectUrl } from "../../application/sanitize-reader-url";
import { pageNumberFromSelection, selectionRangeFromDom } from "../../application/dom-selection-range";
import {
  appendInkStroke,
  draftFromTextSelection,
  draftImageRegion,
  draftInkAnnotation,
  draftTextBox,
} from "../../application/draft-local-annotation";
import {
  annotationPinKey,
  applyAnnotationPatch,
  isInkTool,
  optimisticAnnotationFromDraft,
  PENDING_ANNOTATION_PREFIX,
  READER_ANNOTATION_COLORS,
  toolOwnsThePage,
  type ReaderCreateTool,
} from "../../application/reader-annotation-helpers";
import { useReaderViewport } from "../use-reader-viewport";
import { ReaderToolbar } from "../reader-toolbar";
import { ReaderSearchBar } from "../reader-search-bar";
import { ReaderOutline, type ReaderOutlineItem } from "../reader-outline";
import { AnnotationOverlay } from "../annotation-overlay";
import { bucketAnnotationsByPage } from "../../application/project-annotation-geometry";
import { AnnotationSidebar, type ReportSectionOption } from "../annotation-sidebar";
import { SelectionCreateBar } from "../selection-create-bar";
import type { ReaderAnnotation } from "@weaveforge/core";
import { darkPdfCanvasFilter } from "../../application/reader-pdf-theme";
import { backlinksForAnnotation } from "../../application/annotation-backlinks";
import { desktop } from "@/lib/desktop/desktop-bridge";
import { ColourMenu } from "@/components/colour-menu";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DraftShapeOverlay, PageMargin, SafeExternalLink, TextBoxComposer } from "./overlays";
import { layoutMarginNotes } from "../../application/margin-notes";
import { useAnnotationContext } from "./use-annotation-context";
import { useDarkPdf } from "./use-dark-pdf";
import { useAnnotationActions } from "./use-annotation-actions";
import { usePdfRendering } from "./use-pdf-rendering";
import { usePagePointer } from "./use-page-pointer";
import { useReaderGestures } from "../use-reader-gestures";
import { useInkUndo } from "./use-ink-undo";
import { usePenPrefs, barToolFor, inkCursorFor, readerToolFor } from "./use-pen-prefs";
import { useReaderReferences } from "./use-reader-references";
import { ReferencePopoverHost } from "./reference-popover-host";
import { CitationTextLayer } from "./citation-text-layer";
import { FindMarks, FindOverlay } from "../find-overlay";
import { findMarks } from "../../application/find-marks";
import { ReferencesPanel } from "../references-panel";
import { buildLocusLink } from "../../application/build-locus-link";

import type {
  DraftShape,
  InkGroup,
  InkMove,
  JumpState,
  PdfDocument,
  PdfLib,
  PdfReaderProps,
  RenderTask,
  PendingTextBox,
} from "./types";
import {
  CREATE_TOOL_HINTS,
  EMPTY_ANNOTATIONS,
  ERASER_RADIUS,
  INK_MOVE_THRESHOLD,
  MIN_TEXT_BOX_PDF_SIZE,
} from "./constants";
import {
  buildPageText,
  isEditableTarget,
  loadPdfLib,
  mapOutline,
  pageScopedLocus,
  textItemsFromContent,
} from "./pdf-document";

/** The workspace's focus glyph: corners pointing in (on) or out (off). */
function FocusGlyph({ on }: { on: boolean }) {
  const d = on
    ? "M9 3H4v5M15 3h5v5M9 21H4v-5M15 21h5v-5"
    : "M4 8V3h5M20 8V3h-5M4 16v5h5M20 16v5h-5";
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

export function PdfReader({
  url,
  originalUrl,
  locus,
  page,
  annotations = [],
  contentHash = "",
  paperTitle = "Paper",
  quotationTypes,
  paperId,
  onAnnotationsChange,
  onActivity,
  onSourceFailure,
  inkRail = false,
  toolbarExtra,
}: PdfReaderProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [jump, setJump] = useState<JumpState>({ status: locus ? "searching" : "idle" });
  const [showOutline, setShowOutline] = useState(false);
  /**
   * Phones: which folded part of the chrome is open. The two rows used to
   * scroll sideways to reach a dozen controls; now the row holds the page,
   * zoom and the annotation tools, and find and the rest open on demand.
   */
  const [phonePanel, setPhonePanel] = useState<"none" | "search" | "more">("none");
  const [showReferences, setShowReferences] = useState(false);
  // Narrow screens stack the side column under the page, where an always-open
  // annotation list took 40% of a phone's height. There it waits behind this.
  const [showAnnotationList, setShowAnnotationList] = useState(false);
  const [find, setFind] = useState<{ matches: DocumentSearchMatch[]; active: number }>({ matches: [], active: -1 });
  const [flashPage, setFlashPage] = useState<number | null>(null);
  const [captionTarget, setCaptionTarget] = useState<FigureTarget | null>(null);
  const [selectedAnnId, setSelectedAnnId] = useState<string | null>(null);
  const [pickedTool, setCreateTool] = useState<ReaderCreateTool>("select");
  const [pickedColor, setCreateColor] = useState<string>(READER_ANNOTATION_COLORS[0]);
  // The pen bar, once up, is the tool picker: what it holds is what draws. Its
  // choices persist per user (`usePenPrefs`), the PDF toolbar's do not.
  const [penOpen, setPenOpen] = useState(inkRail);
  const [sideCollapsed, setSideCollapsed] = useState(readSideCollapsed);
  const toggleSide = () =>
    setSideCollapsed((v) => {
      writeSideCollapsed(!v);
      return !v;
    });
  useEffect(() => setPenOpen(inkRail), [inkRail]);
  const pen = usePenPrefs();
  const createTool: ReaderCreateTool = penOpen ? pen.prefs.tool : pickedTool;
  /**
   * The ink colour, as the literal a stored annotation takes.
   *
   * The bar's swatches are the ink note's colour *names* (`INK_COLOURS`), so
   * the paper's ink is written in the same vocabulary the note is; this is the
   * one place a name becomes the hex a `ReaderAnnotation` carries. The palette
   * is read off the document once, after mount — reading it during render would
   * both touch the DOM there and paint a different colour on the client's first
   * pass than the static export's.
   */
  const [inkPalette, setInkPalette] = useState<InkPalette>(INK_RENDER_COLOURS);
  useEffect(() => setInkPalette(readThemePalette(document)), []);
  const penColor = paletteHex(inkPalette, pen.prefs.colour);
  const createColor = penOpen ? penColor : pickedColor;
  /** The nib in PDF points, from the note's 0.1 mm — one nib set for both surfaces. */
  const penWidth = inkNoteWidthToPdfPoints(pen.prefs.width);
  // Focus, the workspace's way (`⌘⇧F`): the paper and nothing else. Per
  // session, not persisted — a reader that reopens with every control hidden
  // looks broken, not focused.
  const [focus, setFocus] = useState(false);
  const toggleFocus = useCallback(() => setFocus((current) => !current), []);
  useEffect(() => {
    const root = document.documentElement;
    if (focus) root.dataset.readerFocus = "";
    else delete root.dataset.readerFocus;
    // The desktop shell's own chrome — menu bar, title bar — goes with it.
    desktop()?.setWindowFocus?.(focus);
    return () => {
      delete root.dataset.readerFocus;
      desktop()?.setWindowFocus?.(false);
    };
  }, [focus]);
  const [pendingCreate, setPendingCreate] = useState<{
    pageNumber: number;
    quote: string;
    selection: TextSelectionRange;
  } | null>(null);
  const clearPendingCreate = useCallback(() => setPendingCreate(null), []);
  const { reportSections, pinsByKey, applyPin, backlinkHits } = useAnnotationContext(
    paperId,
    annotations,
  );
  const darkPdf = useDarkPdf();
  const actions = useAnnotationActions({
    paperId,
    onAnnotationsChange,
    onActivity,
    applyPin,
    selectedAnnId,
    setSelectedAnnId,
    clearPendingCreate,
  });
  const {
    annError,
    setAnnError,
    createBusy,
    updateLocal,
    pinLocal,
    askRemove,
    pendingRemove,
    clearPendingRemove,
  } = actions;
  // Stroke writes go through the undo stack while the rail is up; the
  // wrapped writes are the raw ones otherwise, so nothing else changes.
  const inkUndo = useInkUndo(actions, annotations, penOpen);
  const { persistDraft, removeLocal, saveAnchor, reset: resetInkUndo } = inkUndo;
  useEffect(() => resetInkUndo(), [url, resetInkUndo]);
  // Undo and redo belong to the pen: with the rail up, Ctrl+Z takes back the
  // last stroke, and Ctrl+Shift+Z or Ctrl+Y puts it back. Listened for on the
  // window, the ink note's way, so it answers wherever focus went after the
  // last tap — a rail button, the page, nowhere — and not only while the
  // reader's root holds it.
  const inkUndoRef = useRef(inkUndo);
  inkUndoRef.current = inkUndo;
  useEffect(() => {
    if (!penOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      if (isEditableTarget(event.target)) return;
      const key = event.key.toLowerCase();
      if (key !== "z" && key !== "y") return;
      event.preventDefault();
      void (key === "y" || event.shiftKey ? inkUndoRef.current.redo() : inkUndoRef.current.undo());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [penOpen]);

  /** Stable identity so a memoised page overlay is not re-rendered by a new closure. */
  const selectAnnotation = useCallback((id: string) => setSelectedAnnId(id), []);
  const canCreate = Boolean(paperId && onAnnotationsChange);
  // Bucket once per annotation change rather than rescanning the whole list in
  // every page's overlay on every zoom, scroll, and rotation.
  const annotationsByPage = useMemo(() => bucketAnnotationsByPage(annotations), [annotations]);

  /**
   * The annotations to paint on one page, with the mark being dragged shifted
   * to where the pointer has it. Applying the offset at paint time keeps a move
   * at display rate without rewriting the annotation list on every frame.
   */
  /** The writing margin is as wide as the page it sits beside, on screen. */
  function marginWidth(pageNumber: number): number {
    const p = pageProjection(pageNumber);
    const across = p.rotation % 180 === 0 ? p.pageWidth : p.pageHeight;
    return Math.floor(across * p.scale);
  }

  function pageAnnotations(pageNumber: number): ReaderAnnotation[] {
    const list = annotationsByPage.get(pageNumber) ?? EMPTY_ANNOTATIONS;
    if (!movePreview) return list;
    const moving = new Set(movePreview.ids);
    return list.map((ann) => {
      if (!moving.has(ann.id)) return ann;
      const position = ann.anchor.zoteroPosition;
      if (!position?.paths?.length) return ann;
      return {
        ...ann,
        anchor: {
          ...ann.anchor,
          zoteroPosition: {
            ...position,
            paths: translateInkPaths(position.paths, movePreview.dx, movePreview.dy),
          },
        },
      };
    });
  }

  const {
    viewport,
    containerRef,
    pdf,
    numPages,
    pageSize,
    containerSize,
    pageTexts,
    pageItems,
    pageLinks,
    outline,
    error,
    openUrl,
    pageGeometries,
    suppressPageScroll,
    renderPage,
    clearHighlights,
  } = usePdfRendering({
    url,
    originalUrl,
    locus,
    paperId,
    paperTitle,
    contentHash,
    initialPage: typeof page === "number" ? page + 1 : 1,
    onSourceFailure,
    setJump,
    pageShare: penOpen ? 0.5 : 1,
  });
  const scale = viewport.renderScale;
  const rotation = viewport.rotation;

  /**
   * How many pen strokes the page under the pen carries, for the bar's
   * readout: the note counts strokes because that is what it holds, and a
   * paper's ink annotations are its strokes.
   */
  const pageInkStrokes = useMemo(
    () =>
      (annotationsByPage.get(viewport.page) ?? EMPTY_ANNOTATIONS).filter(
        (ann) => ann.type === "ink",
      ).length,
    [annotationsByPage, viewport.page],
  );

  /**
   * The pointer the page shows, from the one table both surfaces read
   * (`inkCursorFor`, `features/ink`): the crosshair a nib is aimed with, the
   * eraser's ring. The pointer tool is left alone — it is the arrow and the
   * text I-beam the page already gives it.
   */
  const pageCursor = canCreate ? inkCursorFor(createTool) : undefined;

  /**
   * Ink is the ink mode's.
   *
   * With the pen away the reader is reading: the paper's marks are still drawn
   * — they are what the page says — but nothing on it takes the pointer, so a
   * pen or a finger goes to the page's own text instead of to a stroke lying
   * over it, and a drag across a paragraph is a selection rather than a lasso.
   */
  const inkEditable = penOpen;

  /** What the armed tool will do on release. */
  const toolHint = CREATE_TOOL_HINTS[createTool];

  const {
    penSeen,
    draftShape,
    movePreview,
    isMovingInk,
    lassoPath,
    lassoPage,
    lassoed,
    clearLasso,
    cancelStroke,
    endInkGroup,
    pendingTextBox,
    setPendingTextBox,
    pendingNote,
    setPendingNote,
    pageProjection,
    onPagePointerDown,
    onPagePointerMove,
    onPagePointerUp,
  } = usePagePointer({
    canCreate,
    createTool,
    createColor,
    inkEditable,
    inkWidth: penWidth,
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
  });

  /**
   * The pinch, previewed and then committed.
   *
   * While the fingers are down the zoom is a **transform** on the pages: paint
   * only, no layout, no pdf.js — which is what keeps it at the display's rate.
   * The commit is one change of scale afterwards, so every page is rendered once
   * at the size it was dragged to instead of once per frame of the drag.
   */
  const [zoomPreview, setZoomPreview] = useState<{
    factor: number;
    x: number;
    y: number;
  } | null>(null);
  /**
   * The pages' boxes as they were before the pinch scaled anything, by page.
   *
   * The transform origins are measured against these for the whole gesture —
   * see the preview effect below for why measuring them again would make the
   * page drift while it zooms.
   */
  const pinchBoxes = useRef(new Map<string, { left: number; top: number }>());

  /**
   * Give every page the size a scale means, at once.
   *
   * A page's box and its canvas are sized by pdf.js as it repaints — which is
   * fine for one page at a time and wrong for a zoom, where every page changes
   * size at the same moment: until each one is repainted its box has no size at
   * all, so the document goes blank, reflows in pieces and drags the scroll with
   * it. That is the flashing a pinch ended with.
   *
   * Doing it here instead takes the new layout in one step. The **bitmap is left
   * alone**: the browser stretches the old one to the new size, so the page is
   * never blank, and pdf.js repaints it sharp a moment later. Landscape is the
   * rotation the reader already turns the page by, so the width and the height
   * swap exactly as they do everywhere else.
   */
  const resizePagesFor = useCallback(
    (at: number) => {
      const scroller = containerRef.current;
      if (!scroller) return;
      for (const row of scroller.querySelectorAll<HTMLElement>(".pdf-reader-page-row")) {
        const pageNumber = Number(row.dataset.page);
        // The text geometry carries the page's own size under other names; the
        // document's page size stands in for a page not measured yet.
        const geometry = pageGeometries.current.get(pageNumber);
        const size: ReaderPageSize | null = geometry
          ? { width: geometry.pageWidth, height: geometry.pageHeight }
          : pageSize;
        const box = row.querySelector<HTMLElement>(".pdf-reader-page");
        if (!size || !box) continue;
        const { width, height } = pageRenderSize(size, at, rotation);
        box.style.width = `${width}px`;
        box.style.height = `${height}px`;
        const canvas = box.querySelector("canvas");
        if (canvas) {
          canvas.style.width = `${width}px`;
          canvas.style.height = `${height}px`;
        }
      }
    },
    [containerRef, pageGeometries, pageSize, rotation],
  );

  /**
   * Take a pinch: the real scale, and the scroll that keeps the point the pinch
   * was about exactly where it is on screen.
   *
   * The layout takes its new size *before* the scale changes, so the frame the
   * browser paints is the one the fingers were already looking at — the preview
   * transform comes off at the same instant the pages become that size — and the
   * scroll is then set against a layout that is already right, rather than
   * waiting for pdf.js to grow the pages one by one.
   *
   * The anchor is **measured, not calculated**. Scaling the scroll offset is the
   * obvious arithmetic and it is wrong here: the pages are centred in the
   * scroller, so the content's own origin is not the scroller's, and a scaled
   * offset drifts the page sideways every zoom. Instead the point's position
   * *within the page under it* is taken before the resize and looked up again
   * after — whatever centring, zoom or rotation did to the layout, the page
   * moves by exactly the difference.
   */
  const commitZoom = useCallback(
    (factor: number, focusX: number, focusY: number) => {
      const scroller = containerRef.current;
      const before = viewport.renderScale;
      const applied = clampScale(before * factor) / before;
      if (!Number.isFinite(applied) || applied === 1) {
        setZoomPreview(null);
        return;
      }
      /*
       * The reader is placing the view itself here. A zoom moves the scroll to
       * keep the fingers' point still, which can land on another page — and the
       * reader's own rule is to scroll the page being read to the top, smoothly.
       * Left alone, that rule smooth-scrolls the whole zoom back out over half a
       * second of frames: the anchor is set and then animated away from. The
       * flag is the one the reader already uses when *it* moves the view; the
       * timeout is only so a zoom that happens not to change the page cannot
       * leave the next page change unscrolled.
       */
      suppressPageScroll.current = true;
      window.setTimeout(() => {
        suppressPageScroll.current = false;
      }, 400);

      /*
       * The preview comes off *first*, and by hand. Its transform is still on
       * the pages, and a bounding rect reports the transformed box — so a
       * measurement taken now would be in scaled coordinates and then scaled
       * again by the resize, which is how a zoom ended up offset from the point
       * it was about. Clearing it here also means the frame the browser paints
       * next is the one the hand was looking at: the pages are already the size
       * the transform was showing.
       */
      for (const row of scroller?.querySelectorAll<HTMLElement>(".pdf-reader-page-row") ?? []) {
        row.style.transform = "";
        row.style.transformOrigin = "";
      }
      pinchBoxes.current.clear();

      const scrollerRect = scroller?.getBoundingClientRect();
      const focusClientX = (scrollerRect?.left ?? 0) + focusX;
      const focusClientY = (scrollerRect?.top ?? 0) + focusY;
      const page = scrollerRect
        ? (document
            .elementFromPoint(focusClientX, focusClientY)
            ?.closest(".pdf-reader-page-row") as HTMLElement | null)
        : null;
      const before_ = page?.getBoundingClientRect();
      const withinPageX = before_ ? focusClientX - before_.left : 0;
      const withinPageY = before_ ? focusClientY - before_.top : 0;

      resizePagesFor(before * applied);
      setZoomPreview(null);
      viewport.zoomBy(factor);

      if (!scroller || !page || !before_) return;
      const now = page.getBoundingClientRect();
      // Where that same point sits on screen now, and the scroll that puts it
      // back where the hand left it.
      const landedX = now.left + withinPageX * applied;
      const landedY = now.top + withinPageY * applied;
      scroller.scrollLeft += landedX - focusClientX;
      scroller.scrollTop += landedY - focusClientY;
    },
    [viewport, containerRef, resizePagesFor, suppressPageScroll],
  );

  /**
   * Show the pinch: the pages, scaled about the point the pinch is about.
   *
   * A transform moves nothing and re-renders nothing, so the gesture runs at the
   * display's rate however many pages are on screen, and the pages off screen
   * are left alone — there is nothing of theirs to repaint.
   *
   * The boxes the origins are measured from are **captured once, before any
   * transform is applied**, and that is not a micro-optimisation: a bounding
   * rect reports the *transformed* box, so measuring afresh each frame takes the
   * origin from an already-scaled rectangle, and the anchor then walks a little
   * further every frame — which is exactly what "the page drifts while I zoom"
   * looks like. Nothing rescales the layout for the length of the gesture, so
   * one measurement of it is the right one.
   */
  useLayoutEffect(() => {
    const scroller = containerRef.current;
    if (!scroller) return;
    const rows = scroller.querySelectorAll<HTMLElement>(".pdf-reader-page-row");

    if (!zoomPreview) {
      for (const row of rows) {
        row.style.transform = "";
        row.style.transformOrigin = "";
      }
      pinchBoxes.current.clear();
      return;
    }

    if (pinchBoxes.current.size === 0) {
      const scrollerBox = scroller.getBoundingClientRect();
      for (const row of rows) {
        const box = row.getBoundingClientRect();
        if (box.bottom < scrollerBox.top - 400 || box.top > scrollerBox.bottom + 400) continue;
        pinchBoxes.current.set(row.dataset.page ?? "", { left: box.left, top: box.top });
      }
    }

    const scrollerBox = scroller.getBoundingClientRect();
    const originX = scrollerBox.left + zoomPreview.x;
    const originY = scrollerBox.top + zoomPreview.y;
    for (const row of rows) {
      const box = pinchBoxes.current.get(row.dataset.page ?? "");
      if (!box) {
        row.style.transform = "";
        continue;
      }
      row.style.transformOrigin = `${originX - box.left}px ${originY - box.top}px`;
      row.style.transform = `scale(${zoomPreview.factor})`;
    }
  }, [zoomPreview, containerRef]);

  /** Two fingers pan and pinch, whatever the tool — and one finger pans too,
   * because on a paper the stylus draws and the hand moves the page. Asked first
   * on every pointer event, and it takes the first finger's work away when the
   * second lands. */
  const gestures = useReaderGestures({
    scrollRef: containerRef,
    onGestureStart: cancelStroke,
    onZoomPreview: (factor, x, y) => setZoomPreview({ factor, x, y }),
    onZoomCommit: (factor, x, y) => commitZoom(factor, x, y),
  });

  /**
   * The size a page takes at a scale, rotation included.
   *
   * A page turned a quarter turn is as wide as it is tall and the other way
   * about; the placeholder for a page not yet painted and the resize a zoom does
   * both read their size from here, so a landscape page zooms as the same shape.
   */
  function pageRenderSize(size: ReaderPageSize, at: number, turn: number) {
    const sideways = turn % 180 !== 0;
    return {
      width: Math.floor((sideways ? size.height : size.width) * at),
      height: Math.floor((sideways ? size.width : size.height) * at),
    };
  }

  const unpaintedPageSize = (size: ReaderPageSize, at: number, turn: number) => {
    const { width, height } = pageRenderSize(size, at, turn);
    return { minWidth: `${width}px`, minHeight: `${height}px` };
  };

  const onFigureTarget = useCallback((target: FigureTarget) => {
    setCaptionTarget(target);
    setFlashPage(target.page);
    const host = containerRef.current?.querySelector<HTMLDivElement>(`[data-page="${target.page}"]`);
    if (host && containerRef.current) {
      if (typeof target.y === "number") {
        const pageHeight = pageGeometries.current.get(target.page)?.pageHeight ?? pageSize?.height ?? 792;
        const screenY = (pageHeight - target.y) * scale;
        const container = containerRef.current;
        container.scrollTo({
          top: host.offsetTop + screenY - container.clientHeight / 3,
          behavior: "smooth",
        });
      } else {
        host.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
    window.setTimeout(() => {
      setCaptionTarget((cur) => (cur === target ? null : cur));
      setFlashPage((p) => (p === target.page ? null : p));
    }, 2200);
  }, [scale, pageSize, containerRef, pageGeometries]);
  const refs = useReaderReferences({
    pageItems,
    pageLinks,
    outline,
    contentHash,
    paperId,
    setPage: viewport.setPage,
    onFigureTarget,
  });
  useEffect(() => {
    if (showReferences) {
      refs.startPrefetch();
    } else {
      refs.stopPrefetch();
    }
  }, [showReferences, refs]);


  const matchOnPage = useCallback(
    async (pageNumber: number): Promise<AnchorConfidence | null> => {
      if (!pdf || !locus) return null;
      const pdfPage = await pdf.getPage(pageNumber);
      const content = await pdfPage.getTextContent();
      const items = textItemsFromContent(content);
      const pageText = buildPageText(items);
      const anchor = resolveTextAnchor(pageText.text, pageScopedLocus(locus));
      return anchor?.confidence ?? null;
    },
    [pdf, locus],
  );

  const highlightOnPage = useCallback(
    async (pageNumber: number): Promise<void> => {
      if (!pdf || !locus) return;
      const lib = await loadPdfLib();
      const pdfPage = await pdf.getPage(pageNumber);
      const pageViewport = pdfPage.getViewport({ scale, rotation });
      const content = await pdfPage.getTextContent();
      const items = textItemsFromContent(content);
      const pageText = buildPageText(items);
      const anchor = resolveTextAnchor(pageText.text, pageScopedLocus(locus));
      if (!anchor) return;

      const host = containerRef.current?.querySelector<HTMLDivElement>(
        `[data-page="${pageNumber}"]`,
      );
      if (!host) return;

      for (const range of pageText.items) {
        if (range.end <= anchor.start || range.start >= anchor.end) continue;
        const item = items[range.index]!;
        const tx = lib.Util.transform(pageViewport.transform, item.transform);
        const fontHeight = Math.hypot(tx[2]!, tx[3]!) || item.height * scale;
        const width = (item.width || 0) * scale;
        const left = tx[4]!;
        const top = tx[5]! - fontHeight;
        const hl = document.createElement("div");
        hl.className = "pdf-reader-hl";
        hl.style.left = `${left}px`;
        hl.style.top = `${top}px`;
        hl.style.width = `${Math.max(width, 2)}px`;
        hl.style.height = `${Math.max(fontHeight, 2)}px`;
        host.appendChild(hl);
      }
    },
    [pdf, locus, scale, rotation, containerRef],
  );

  useEffect(() => {
    if (!pdf || numPages === 0) return;
    const root = containerRef.current;
    if (!root) return;
    const ratios = new Map<number, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const n = Number((entry.target as HTMLElement).dataset.page);
          if (!n) continue;
          if (entry.isIntersecting) void renderPage(n);
          ratios.set(n, entry.intersectionRatio);
        }
        let bestPage = 0;
        let bestRatio = 0;
        for (const [n, ratio] of ratios) {
          if (ratio > bestRatio) {
            bestRatio = ratio;
            bestPage = n;
          }
        }
        if (bestPage > 0 && bestRatio >= 0.35 && bestPage !== viewport.page) {
          suppressPageScroll.current = true;
          viewport.setPage(bestPage);
        }
      },
      { root, rootMargin: "600px 0px", threshold: [0, 0.25, 0.35, 0.5, 0.75, 1] },
    );
    root.querySelectorAll("[data-page]").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
    // viewport.page / setPage intentionally used inside; omit viewport object
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdf, numPages, renderPage, viewport.page, viewport.setPage]);

  // Scroll when the toolbar / keyboard changes the current page.
  useEffect(() => {
    if (!pdf || numPages === 0) return;
    if (suppressPageScroll.current) {
      suppressPageScroll.current = false;
      void renderPage(viewport.page);
      return;
    }
    const host = containerRef.current?.querySelector<HTMLElement>(
      `[data-page="${viewport.page}"]`,
    );
    host?.scrollIntoView({ behavior: "smooth", block: "start" });
    void renderPage(viewport.page);
  }, [viewport.page, pdf, numPages, renderPage, containerRef, suppressPageScroll]);

  useEffect(() => {
    if (!pdf || !locus) {
      clearHighlights();
      setJump({ status: "idle" });
      return;
    }
    let cancelled = false;
    clearHighlights();
    setJump({ status: "searching" });
    void (async () => {
      let firstMatch: { pageNumber: number; confidence: AnchorConfidence } | null = null;
      try {
        const order: number[] = [];
        const hinted = typeof page === "number" ? page + 1 : undefined;
        const hintedOk = hinted != null && hinted >= 1 && hinted <= pdf.numPages;
        if (hintedOk) order.push(hinted!);
        for (let n = 1; n <= pdf.numPages; n++) if (n !== hinted) order.push(n);

        let extraMatches = 0;
        let painted = false;

        const paintMatch = async (
          match: { pageNumber: number; confidence: AnchorConfidence },
          confidence: AnchorConfidence,
        ) => {
          await renderPage(match.pageNumber);
          if (cancelled) return;
          clearHighlights();
          await highlightOnPage(match.pageNumber);
          if (cancelled) {
            clearHighlights();
            return;
          }
          const host = containerRef.current?.querySelector<HTMLElement>(
            `[data-page="${match.pageNumber}"]`,
          );
          host?.scrollIntoView({ behavior: "smooth", block: "center" });
          viewport.setPage(match.pageNumber);
          setJump({
            status: confidence === "high" ? "found" : "low",
            pageNumber: match.pageNumber,
            confidence,
          });
        };

        for (const pageNumber of order) {
          if (cancelled) return;
          let confidence: AnchorConfidence | null = null;
          try {
            confidence = await matchOnPage(pageNumber);
          } catch {
            continue;
          }
          if (!confidence) continue;
          if (!firstMatch) {
            firstMatch = { pageNumber, confidence };
            await paintMatch(firstMatch, confidence);
            painted = true;
            continue;
          }
          extraMatches += 1;
          break;
        }

        if (cancelled) return;
        if (!firstMatch) {
          setJump({ status: "missed" });
          return;
        }

        const finalConfidence: AnchorConfidence =
          extraMatches > 0 || firstMatch.confidence === "low" ? "low" : firstMatch.confidence;

        if (!painted || finalConfidence !== firstMatch.confidence || extraMatches > 0) {
          await paintMatch(firstMatch, finalConfidence);
        }
      } catch {
        if (!cancelled && !firstMatch) setJump({ status: "missed" });
      }
    })();
    return () => {
      cancelled = true;
      clearHighlights();
    };
    // viewport.setPage is stable enough; omit viewport object to avoid re-jumps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdf, locus, page, matchOnPage, highlightOnPage, renderPage, clearHighlights]);

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    // Focus toggles on the workspace's chord, and Escape is always the way
    // out: a mode with every control hidden must answer the key everyone tries.
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "f") {
      event.preventDefault();
      toggleFocus();
      return;
    }
    if (event.key === "Escape" && focus && !isEditableTarget(event.target)) {
      event.preventDefault();
      setFocus(false);
      return;
    }
    // Delete the selected annotation from the page itself. Deleting was only
    // reachable by finding the same annotation again in the sidebar list.
    if (
      (event.key === "Delete" || event.key === "Backspace") &&
      selectedAnnId &&
      canCreate &&
      !isEditableTarget(event.target)
    ) {
      const selected = annotations.find((a) => a.id === selectedAnnId);
      if (selected?.origin === "local") {
        event.preventDefault();
        // Ask first, and let the reader draw the question: a keypress is easy
        // to make by accident, and `ConfirmDialog` is the app's own dialog
        // rather than the OS one this used to raise.
        askRemove(selectedAnnId);
        return;
      }
    }
    const command = readerKeyboardCommand({
      key: event.key,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      altKey: event.altKey,
      fromEditable: isEditableTarget(event.target),
    });
    if (!command) return;
    event.preventDefault();
    switch (command.type) {
      case "zoom_in":
        viewport.zoomIn();
        break;
      case "zoom_out":
        viewport.zoomOut();
        break;
      case "fit_width":
        viewport.fitWidth();
        break;
      case "rotate":
        viewport.rotateClockwise();
        break;
      case "page_home":
        viewport.setPage(1);
        break;
      case "page_end":
        viewport.setPage(numPages);
        break;
      case "page_delta":
        viewport.setPage(viewport.page + command.delta);
        break;
    }
  }


  function onSelectionMouseUp() {
    if (!canCreate || createTool !== "select") return;
    // A drag that moved an ink mark is not a text selection.
    if (isMovingInk()) return;
    const root = containerRef.current;
    if (!root) return;
    const sel = window.getSelection();
    const pageNumber = pageNumberFromSelection(sel, root);
    if (!pageNumber) {
      setPendingCreate(null);
      return;
    }
    const layer = root.querySelector(`[data-page="${pageNumber}"] .pdf-reader-textlayer`);
    if (!layer) {
      setPendingCreate(null);
      return;
    }
    const range = selectionRangeFromDom(sel, layer);
    const geometry = pageGeometries.current.get(pageNumber);
    if (!range || !geometry) {
      setPendingCreate(null);
      return;
    }
    const draft = draftFromTextSelection({
      type: "highlight",
      color: createColor,
      selection: range,
      page: geometry,
    });
    if (!draft) {
      setPendingCreate(null);
      return;
    }
    setPendingCreate({
      pageNumber,
      quote: draft.text ?? "",
      selection: range,
    });
  }

  async function createFromPending(
    type: Extract<ReaderAnnotationType, "highlight" | "underline" | "note">,
    color: string,
  ) {
    if (!pendingCreate) return;
    const geometry = pageGeometries.current.get(pendingCreate.pageNumber);
    if (!geometry) return;
    // A sticky note needs its text first. Collect it in the app rather than an
    // OS prompt, then finish through the same path.
    if (type === "note") {
      setPendingNote({ color });
      return;
    }
    const draft = draftFromTextSelection({
      type,
      color,
      selection: pendingCreate.selection,
      page: geometry,
      comment: "",
    });
    if (!draft) return;
    await persistDraft(draft);
  }

  async function createNoteWithComment(color: string, comment: string) {
    if (!pendingCreate) return;
    const geometry = pageGeometries.current.get(pendingCreate.pageNumber);
    if (!geometry) return;
    const draft = draftFromTextSelection({
      type: "note",
      color,
      selection: pendingCreate.selection,
      page: geometry,
      comment,
    });
    if (!draft) return;
    await persistDraft(draft);
  }



  if (error) {
    return (
      <div className="pdf-reader-error card">
        <p>{error}</p>
        {openUrl && <SafeExternalLink href={openUrl}>Open the original PDF</SafeExternalLink>}
      </div>
    );
  }

  /**
   * The mark the delete dialog is asking about, so the question can name it.
   * Looked up rather than stored: the list is the truth about what exists, and
   * a copy in state could describe a mark that has already gone.
   */
  const removeTarget = pendingRemove
    ? annotations.find((a) => a.id === pendingRemove)
    : undefined;

  return (
    <div
      className={`pdf-reader${darkPdf ? " pdf-reader--dark" : ""}${focus ? " is-focus" : ""}`}
      ref={rootRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      aria-label="PDF reader"
      style={
        {
          // Tint the live text selection with the colour the highlight will
          // actually be, so dragging over text previews the result instead of
          // showing the browser's default blue until you confirm.
          ["--reader-select-color" as string]: createColor,
          ...(darkPdf ? { ["--pdf-dark-filter" as string]: darkPdfCanvasFilter() } : {}),
        } as CSSProperties
      }
    >
      {focus && (
        <button
          type="button"
          className="focus-exit"
          title="Exit focus (⌘⇧F)"
          aria-label="Exit focus"
          onClick={toggleFocus}
        >
          <FocusGlyph on />
        </button>
      )}
      {locus && jump.status !== "idle" && (
        <div className={`pdf-reader-banner pdf-reader-banner--${jump.status}`} role="status">
          {jump.status === "searching" && "Locating the cited passage…"}
          {jump.status === "found" && `Jumped to the cited passage (page ${jump.pageNumber}).`}
          {jump.status === "low" &&
            `Best match on page ${jump.pageNumber} — the source may have changed, so verify the highlight.`}
          {jump.status === "missed" && (
            <>
              Could not locate the exact passage.{" "}
              {openUrl && <SafeExternalLink href={openUrl}>Open the original PDF</SafeExternalLink>}
              .
            </>
          )}
        </div>
      )}
      {/* One panel, two rows: viewport controls above, find/view/annotate below.
          Two free-floating wrapping bars read as scattered chrome. */}
      <div className="pdf-reader-chrome" data-phone-panel={phonePanel}>
        <ReaderToolbar viewport={viewport} numPages={numPages} hideFit={penOpen}>
          <div className="pdf-reader-phone-toggles pdf-reader-group">
            <button
              type="button"
              className={`btn-secondary btn-sm pdf-reader-icon-btn${phonePanel === "search" ? " is-active" : ""}`}
              aria-pressed={phonePanel === "search"}
              aria-label="Find in document"
              title="Find"
              onClick={() => setPhonePanel((v) => (v === "search" ? "none" : "search"))}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                <path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4.2-4.2" />
              </svg>
            </button>
            <button
              type="button"
              className={`btn-secondary btn-sm pdf-reader-icon-btn${phonePanel === "more" ? " is-active" : ""}`}
              aria-pressed={phonePanel === "more"}
              aria-expanded={phonePanel === "more"}
              aria-label="More reader controls"
              title="More"
              onClick={() => setPhonePanel((v) => (v === "more" ? "none" : "more"))}
            >
              ⋯
            </button>
          </div>
        </ReaderToolbar>
        <div className="pdf-reader-tools">
        <ReaderSearchBar
          pages={pageTexts}
          onJump={(match) => {
            viewport.setPage(match.pageIndex + 1);
          }}
          onMatches={(matches, active) => setFind({ matches, active })}
        />
        <div className="pdf-reader-group pdf-reader-more">
          {/* Outline, citations and references all live in the side column the
              pen hides, so their toggles stand down with it rather than offering
              a switch that would appear to do nothing. The search bar stays: it
              is the page's own control. */}
          {!penOpen && (
            <button
              type="button"
              className={`btn-secondary btn-sm${showOutline ? " is-active" : ""}`}
              aria-pressed={showOutline}
              onClick={() => setShowOutline((v) => !v)}
            >
              {outline.some((item) => item.y !== undefined) ? "Sections (detected)" : "Outline"}
            </button>
          )}
          {!penOpen && (
            <button
              type="button"
              className={`btn-secondary btn-sm${refs.enabled ? " is-active" : ""}`}
              aria-pressed={refs.enabled}
              onClick={refs.toggle}
            >
              Link citations
            </button>
          )}
          {!penOpen && (
            <button
              type="button"
              className={`btn-secondary btn-sm${showReferences ? " is-active" : ""}`}
              aria-pressed={showReferences}
              onClick={() => setShowReferences((v) => !v)}
            >
              References{refs.index.references.length ? ` (${refs.index.references.length})` : ""}
            </button>
          )}
          {!penOpen && (annotations.length > 0 || canCreate) && (
            <button
              type="button"
              className={`btn-secondary btn-sm pdf-reader-narrow-only pdf-reader-wide-only${showAnnotationList ? " is-active" : ""}`}
              aria-pressed={showAnnotationList}
              onClick={() => setShowAnnotationList((v) => !v)}
            >
              Annotations{annotations.length ? ` (${annotations.length})` : ""}
            </button>
          )}
          {toolbarExtra}
        </div>
        <button
          type="button"
          className="btn-secondary btn-sm pdf-reader-focus-btn pdf-reader-more"
          title="Focus (⌘⇧F)"
          aria-label="Focus"
          onClick={toggleFocus}
        >
          <FocusGlyph on={false} />
        </button>
        {canCreate && (
          <button
            type="button"
            className={`btn-secondary btn-sm pdf-reader-wide-only${penOpen ? " is-active" : ""}`}
            aria-pressed={penOpen}
            onClick={() => {
              endInkGroup();
              const next = !penOpen;
              setPenOpen(next);
              syncPenParam(next);
            }}
          >
            Ink mode
          </button>
        )}
        {canCreate && !penOpen && (
          <div className="pdf-reader-group pdf-reader-annotate">
            {/* Named by what each does. The three ink tools are deliberately
                absent: ink is the ink mode's, with the note's nibs and renderer.
                What is left is what a reader does *to* a paper. A segmented
                group, not a menu, so the armed tool is always visible. */}
            <div className="seg pdf-reader-tool-seg" role="radiogroup" aria-label="Annotation tool">
              {READER_TOOL_CHOICES.map((choice) => (
                <button
                  key={choice.value}
                  type="button"
                  role="radio"
                  aria-checked={createTool === choice.value}
                  className={createTool === choice.value ? "seg-on" : undefined}
                  title={choice.hint}
                  onClick={() => {
                    // Switching tool ends the mark in progress, so the next stroke
                    // never merges into one drawn with a different nib.
                    endInkGroup();
                    setCreateTool(choice.value);
                  }}
                >
                  {choice.label}
                </button>
              ))}
            </div>
            <span className="pdf-reader-wide-only">
            <ColourMenu
              value={createColor}
              palette={READER_ANNOTATION_COLORS}
              recent={READER_ANNOTATION_COLORS.slice(0, 4)}
              ariaLabel="Annotation colour"
              onChange={(colour) => {
                endInkGroup();
                setCreateColor(colour);
              }}
            />
            </span>
          </div>
        )}
        </div>
        {/* The ink note's own bar, not a copy of it: same tools, same swatches,
            same nibs, same fold and move handles. The reader hands it the
            pen's state only — it owns no pages of its own to offer, and a
            paper has no paper menu, print dialog or recogniser to show. */}
        {canCreate && penOpen && (
          <InkBar
            tool={barToolFor(pen.prefs.tool)}
            colour={pen.prefs.colour}
            width={pen.prefs.width}
            canUndo={inkUndo.canUndo}
            canRedo={inkUndo.canRedo}
            page={viewport.page}
            pages={numPages}
            strokes={pageInkStrokes}
            penSeen={penSeen}
            // What the lasso caught: the bar's two selection actions appear
            // only then, and Delete takes the whole selection.
            selected={lassoed.length}
            onDeleteSelection={() => {
              const doomed = [...lassoed];
              clearLasso();
              for (const id of doomed) void removeLocal(id);
            }}
            onTool={(tool) => {
              endInkGroup();
              pen.setTool(readerToolFor(tool));
            }}
            onColour={(colour) => {
              endInkGroup();
              pen.setColour(colour);
            }}
            onWidth={(width) => {
              endInkGroup();
              pen.setWidth(width);
            }}
            onUndo={() => void inkUndo.undo()}
            onRedo={() => void inkUndo.redo()}
          />
        )}
      </div>
      {/* Both rectangle tools look identical while dragging, so say which one
          is armed and what releasing will do. The pointer tool says more with
          the pen out than without it: with the pen away the ink is read-only,
          so it highlights text and nothing else. */}
      {canCreate && toolHint && <p className="pdf-reader-tool-hint muted">{toolHint}</p>}
      {/* Phone only (PhoneReader mock): the colour, ink and annotation list sit
          in one pill above the tab bar, in thumb reach. The wide toolbar's own
          copies of these hide at the same width. */}
      {canCreate && (
        <div className="pdf-reader-pill" role="toolbar" aria-label="Annotate">
          {!penOpen && (
            <div className="pdf-reader-pill-colours" role="radiogroup" aria-label="Annotation colour">
              {READER_ANNOTATION_COLORS.slice(0, 4).map((colour) => (
                <button
                  key={colour}
                  type="button"
                  role="radio"
                  aria-checked={createColor === colour}
                  aria-label={`Colour ${colour}`}
                  className="pdf-reader-pill-swatch"
                  style={{ background: colour }}
                  onClick={() => {
                    endInkGroup();
                    setCreateColor(colour);
                  }}
                />
              ))}
            </div>
          )}
          {!penOpen && <span className="pdf-reader-pill-sep" aria-hidden="true" />}
          <button
            type="button"
            className={`btn-secondary btn-sm pdf-reader-icon-btn${penOpen ? " is-active" : ""}`}
            aria-pressed={penOpen}
            aria-label="Ink mode"
            title="Ink mode"
            onClick={() => {
              endInkGroup();
              const next = !penOpen;
              setPenOpen(next);
              syncPenParam(next);
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 20h4L19 9l-4-4L4 16z" />
            </svg>
          </button>
          {!penOpen && (
            <button
              type="button"
              className={`btn-secondary btn-sm pdf-reader-icon-btn${showAnnotationList ? " is-active" : ""}`}
              aria-pressed={showAnnotationList}
              aria-label={`Annotations${annotations.length ? ` (${annotations.length})` : ""}`}
              title="Annotations"
              onClick={() => setShowAnnotationList((v) => !v)}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M5 6h14M5 12h14M5 18h9" />
              </svg>
            </button>
          )}
        </div>
      )}
      {annError && (
        <div className="pdf-reader-banner pdf-reader-banner--low" role="alert">
          {annError}{" "}
          <button type="button" className="link-btn" onClick={() => setAnnError(null)}>
            Dismiss
          </button>
        </div>
      )}
      {pendingCreate && canCreate && (
        <SelectionCreateBar
          pending={pendingCreate}
          busy={createBusy}
          color={createColor}
          onCreate={(type, color) => {
            setCreateColor(color);
            void createFromPending(type, color);
          }}
          onCancel={() => setPendingCreate(null)}
        />
      )}
      <div
        className={`pdf-reader-body${
          !penOpen && (showOutline || annotations.length > 0 || canCreate)
            ? sideCollapsed
              ? " pdf-reader-body--rail"
              : " pdf-reader-body--outline"
            : ""
        }`}
      >
        {/* Writing is a full-width activity: with the pen bar up — whatever tool
            it holds, the lasso included — the outline, the references and the
            annotation list all stand down and the paper gets the room. Nothing
            on a paper is picked up *from* the list; it is picked up on the page,
            by drawing a loop round it. */}
        {/* Collapsed, the whole column folds to one vertical tab that still
            says how many annotations wait behind it. */}
        {!penOpen && sideCollapsed && (showOutline || showReferences || annotations.length > 0 || canCreate) && (
          <button
            type="button"
            className="pdf-reader-side-rail"
            aria-expanded={false}
            title="Show the side panel"
            onClick={toggleSide}
          >
            <span>Annotations{annotations.length ? ` ${annotations.length}` : ""}</span>
          </button>
        )}
        {!penOpen && !sideCollapsed && (showOutline || showReferences || annotations.length > 0 || canCreate) && (
          <div className={`pdf-reader-side${showAnnotationList ? " is-list-open" : ""}`}>
            <button
              type="button"
              className="btn-ghost btn-sm pdf-reader-side-collapse"
              aria-expanded
              title="Hide the side panel"
              onClick={toggleSide}
            >
              Collapse
            </button>
            {showOutline && (
              <ReaderOutline items={outline} onNavigate={(n) => viewport.setPage(n)} />
            )}
            {showReferences && (
              <ReferencesPanel
                references={refs.index.references}
                resolutions={refs.resolutions}
                pageNumber={viewport.page}
                loading={pageItems.size < numPages}
                parseFailed={pageItems.size >= numPages && refs.index.references.length === 0}
                onJumpToMention={(ref) => {
                  // Land on the first mention itself, not just its page: the
                  // page-only jump did nothing when the mention was on the
                  // page already shown, and left the reader hunting otherwise.
                  for (const [n, hits] of refs.index.mentionsByPage) {
                    const hit = hits.find((candidate) => candidate.refIndexes.includes(ref.index));
                    if (!hit) continue;
                    const [x1, y1, , y2] = hit.rects?.[0] ?? [];
                    if (x1 != null && y1 != null && y2 != null) {
                      onFigureTarget({ page: n, x: x1, y: y2, height: y2 - y1 });
                    } else {
                      onFigureTarget({ page: n, y: 0 });
                    }
                    return;
                  }
                  onFigureTarget({ page: ref.page, x: ref.x, y: ref.y });
                }}
              />
            )}
            {(annotations.length > 0 || canCreate) && (
              <AnnotationSidebar
                annotations={annotations}
                quotationTypes={quotationTypes}
                paperTitle={paperTitle}
                selectedId={selectedAnnId}
                canEditLocal={canCreate}
                reportSections={reportSections}
                pinsByKey={pinsByKey}
                backlinks={
                  selectedAnnId ? backlinksForAnnotation(backlinkHits, selectedAnnId) : []
                }
                onUpdateLocal={updateLocal}
                onRemoveLocal={askRemove}
                onPinLocal={pinLocal}
                onSelect={(id) => {
                  setSelectedAnnId(id);
                  const ann = annotations.find((a) => a.id === id);
                  const pageIdx = ann?.anchor.zoteroPosition?.pageIndex;
                  if (typeof pageIdx === "number") viewport.setPage(pageIdx + 1);
                }}
              />
            )}
          </div>
        )}
        {/* The scrollbar ticks sit on a wrapper, not inside the scroller, so
            they stay put while the pages move. */}
        <div className="pdf-reader-scroll-wrap">
        <FindMarks
          marks={findMarks(
            find.matches,
            numPages,
            (n) => pageItems.get(n),
            (n) => pageGeometries.current.get(n)?.pageHeight ?? pageSize?.height ?? 0,
          )}
          active={find.active}
        />
        <div
          className="pdf-reader-scroll"
          ref={containerRef}
          onMouseUp={onSelectionMouseUp}
        >
          {!pdf && <div className="pdf-reader-loading">Loading PDF…</div>}
          {Array.from({ length: numPages }, (_, i) => i + 1).map((n) => (
            // One row per page: the page itself, plus the blank strip the pen
            // writes beside it. The row — not the page box — is the drawing
            // surface. The strip is a sibling of the page, and the page box
            // ends where it begins, so a pointerdown in the strip never reached
            // the page's own `onPointerDown`: a stroke that began there was
            // never captured, saved or painted, while the same stroke starting
            // on the page worked. `screenToPdf` still measures the page box, so
            // the coordinates land where they always did.
            <div
              className="pdf-reader-page-row"
              data-page={n}
              key={n}
              // The tool's own pointer, from the one table both surfaces read
              // (`INK_TOOL_CURSORS`): a crosshair for a nib that is aimed, the
              // eraser's ring for the tip that rubs out. Set here rather than in
              // CSS because the page's class list cannot carry a data URL.
              style={canCreate && pageCursor ? { cursor: pageCursor } : undefined}
              // Two fingers are the page's own gesture, so they are asked for
              // first: a pinch that the tool also saw would draw a stroke and
              // zoom the paper at once.
              onPointerDown={(e) => {
                if (gestures.begin(e)) return;
                onPagePointerDown(n, e);
              }}
              onPointerMove={(e) => {
                if (gestures.move(e)) return;
                onPagePointerMove(e);
              }}
              onPointerUp={(e) => {
                if (gestures.end(e)) return;
                onPagePointerUp(n, e);
              }}
              onPointerCancel={(e) => {
                if (gestures.end(e)) return;
                onPagePointerUp(n, e);
              }}
            >
              <div
                className={`pdf-reader-page${
                  toolOwnsThePage(createTool) && canCreate ? " pdf-reader-page--draw" : ""
                }${createTool === "erase" && canCreate ? " pdf-reader-page--erase" : ""}${
                  penSeen ? " pdf-reader-page--pen" : ""
                }${flashPage === n ? " pdf-reader-flash" : ""}`}
                // A page not yet painted takes the document's page size, so a
                // jump to page 11 lands on page 11: with the CSS placeholder,
                // every unpainted page between here and there was a short
                // strip that grew as it scrolled into view, and the scroll
                // came up pages short of its target.
                style={pageSize && !pageGeometries.current.has(n) ? unpaintedPageSize(pageSize, scale, rotation) : undefined}
              >
                <canvas />
                {pageSize && (
                  <AnnotationOverlay
                    annotations={pageAnnotations(n)}
                    contentHash={contentHash}
                    pageNumber={n}
                    scale={scale}
                    rotation={rotation}
                    pageHeight={pageGeometries.current.get(n)?.pageHeight ?? pageSize.height}
                    pageWidth={pageGeometries.current.get(n)?.pageWidth ?? pageSize.width}
                    selectedId={selectedAnnId}
                    // No lasso selection survives the pen being put down, and
                    // `undefined` is a stable prop where a fresh `[]` would
                    // re-render every page's overlay on every frame.
                    inkSelectedIds={inkEditable ? lassoed : undefined}
                  />
                )}
                {/* Inside the page, because it decorates the page's own text
                    layer rather than painting a sibling layer over it. */}
                {pageSize && refs.enabled && refs.index.mentionsByPage.has(n) && pageItems.has(n) && (
                  <CitationTextLayer
                    mentions={refs.index.mentionsByPage.get(n)!}
                    items={pageItems.get(n)!}
                    onOpen={refs.openMention}
                    onPrefetch={refs.prefetchMention}
                    selectedKey={refs.open?.hit.key ?? null}
                  />
                )}
              </div>
              {penOpen && pageSize && (
                <PageMargin
                  notes={layoutMarginNotes(pageAnnotations(n), pageProjection(n))}
                  width={marginWidth(n)}
                  selectedId={selectedAnnId}
                  onSelect={selectAnnotation}
                />
              )}
              {pageSize && find.matches.length > 0 && pageItems.has(n) && (
                <FindOverlay
                  matches={find.matches}
                  active={find.active}
                  pageIndex={n - 1}
                  items={pageItems.get(n)!}
                  projection={pageProjection(n)}
                />
              )}
              {captionTarget?.page === n && typeof captionTarget.y === "number" && (
                <div
                  className="pdf-reader-caption-target"
                  style={{
                    left: typeof captionTarget.x === "number" ? `${captionTarget.x * scale}px` : "5%",
                    top: `${((pageGeometries.current.get(n)?.pageHeight ?? pageSize?.height ?? 792) - captionTarget.y) * scale}px`,
                    width: typeof captionTarget.x === "number" ? "90%" : "90%",
                    height: `${Math.max((captionTarget.height ?? 18) * scale, 24)}px`,
                  }}
                />
              )}
              {pageSize && draftShape?.pageNumber === n && (
                <DraftShapeOverlay
                  shape={draftShape}
                  color={createColor}
                  projection={pageProjection(n)}
                />
              )}
              {/* The lasso loop, on the page it is being drawn on. */}
              {pageSize && lassoPath && lassoPage === n && (
                <DraftShapeOverlay
                  shape={{ kind: "lasso", pageNumber: n, path: lassoPath }}
                  color={createColor}
                  projection={pageProjection(n)}
                />
              )}
            </div>
          ))}
        </div>
        </div>
      </div>
      <ReferencePopoverHost
        refs={refs}
        onOpenInReader={(id) => { window.location.assign(buildLocusLink({ paperId: id })); }}
      />
      {pendingNote && (
        <TextBoxComposer
          title="Sticky note"
          label="Comment"
          submitLabel="Add note"
          placeholder="What do you want to remember about this passage?"
          onCancel={() => setPendingNote(null)}
          onSubmit={(comment) => {
            const { color } = pendingNote;
            setPendingNote(null);
            void createNoteWithComment(color, comment);
          }}
        />
      )}
      {pendingTextBox && (
        <TextBoxComposer
          title="Text annotation"
          label="Note"
          submitLabel="Add note"
          placeholder="What does this part of the page say?"
          onCancel={() => setPendingTextBox(null)}
          onSubmit={(text) => {
            const { pageIndex, pageHeight, x, y, width, height } = pendingTextBox;
            setPendingTextBox(null);
            void persistDraft(
              draftTextBox({
                color: createColor,
                pageIndex,
                pageHeight,
                text,
                x,
                y,
                ...(width != null && height != null ? { width, height } : {}),
              }),
            );
          }}
        />
      )}
      {/* The delete the app draws, in place of the `window.confirm` the write
          hook used to raise. Only the paths a person chooses arrive here — the
          sidebar's Delete and the Delete key on a selected mark. The eraser and
          ink undo call `removeLocal` directly: a dialog per stroke would make
          rubbing out a word unusable, and both are already deliberate. */}
      {pendingRemove ? (
        <ConfirmDialog
          title="Delete this annotation?"
          body={
            removeTarget
              ? `This ${removeTarget.type} mark${
                  removeTarget.comment ? " and the note on it" : ""
                } will be deleted from this paper.`
              : "This mark will be deleted from this paper."
          }
          confirmLabel="Delete"
          danger
          onConfirm={() => {
            const id = pendingRemove;
            clearPendingRemove();
            void removeLocal(id);
          }}
          onClose={clearPendingRemove}
        />
      ) : null}
    </div>
  );
}

/** What a reader does *to* a paper, in the order the top bar shows it. */
const READER_TOOL_CHOICES: ReadonlyArray<{
  value: ReaderCreateTool;
  label: string;
  hint: string;
}> = [
  { value: "select", label: "Highlight", hint: "Highlight text" },
  { value: "image", label: "Clip", hint: "Clip a region" },
  { value: "text", label: "Comment", hint: "Write a note on the page" },
];

/** Mirror the ink mode into `?pen=1` so a reload or a shared link lands in it. */
function syncPenParam(on: boolean) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (on) url.searchParams.set("pen", "1");
  else url.searchParams.delete("pen");
  window.history.replaceState(window.history.state, "", url);
}

const SIDE_COLLAPSED_KEY = "wf.reader.sideCollapsed";

function readSideCollapsed(): boolean {
  try {
    return window.localStorage.getItem(SIDE_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function writeSideCollapsed(collapsed: boolean) {
  try {
    window.localStorage.setItem(SIDE_COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch {
    // Private mode or blocked storage: the panel simply forgets.
  }
}

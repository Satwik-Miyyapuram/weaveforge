"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  readerKeyboardCommand,
  resolveTextAnchor,
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
  type AnchorConfidence,
  type ReaderContainerSize,
  type ReaderPageSize,
  type DocumentPageText,
  type DocumentSearchMatch,
  type ReaderAnnotationType,
  type FigureTarget,
} from "@weaveforge/core";
import type { TextSelectionRange } from "@weaveforge/core";
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
import { Select } from "@/components/select";
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
import { useInkUndo } from "./use-ink-undo";
import { usePenPrefs } from "./use-pen-prefs";
import { PenRail } from "./pen-rail";
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
}: PdfReaderProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [jump, setJump] = useState<JumpState>({ status: locus ? "searching" : "idle" });
  const [showOutline, setShowOutline] = useState(false);
  const [showReferences, setShowReferences] = useState(false);
  const [find, setFind] = useState<{ matches: DocumentSearchMatch[]; active: number }>({ matches: [], active: -1 });
  const [flashPage, setFlashPage] = useState<number | null>(null);
  const [captionTarget, setCaptionTarget] = useState<FigureTarget | null>(null);
  const [spread, setSpread] = useState(false);
  const [selectedAnnId, setSelectedAnnId] = useState<string | null>(null);
  const [pickedTool, setCreateTool] = useState<ReaderCreateTool>("select");
  const [pickedColor, setCreateColor] = useState<string>(READER_ANNOTATION_COLORS[0]);
  // The pen rail, once up, is the tool picker: what it holds is what draws.
  // Its choices persist per user (`usePenPrefs`), the toolbar's do not.
  const [penOpen, setPenOpen] = useState(inkRail);
  useEffect(() => setPenOpen(inkRail), [inkRail]);
  const pen = usePenPrefs();
  const createTool: ReaderCreateTool = penOpen ? pen.prefs.tool : pickedTool;
  const createColor = penOpen ? pen.prefs.color : pickedColor;
  /**
   * Writing is a full-width activity, so a drawing tool puts the reader in
   * focus: the outline, the references and the annotation list all stand down
   * and the paper gets the room. Select is the exception — it is the tool you
   * pick things *with*, so the list it picks from has to stay.
   */
  const penFocused = penOpen && pen.prefs.tool !== "select";
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
    return list.map((ann) => {
      if (ann.id !== movePreview.id) return ann;
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

  const {
    penSeen,
    draftShape,
    movePreview,
    isMovingInk,
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
    inkWidth: pen.prefs.nib,
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

  const unpaintedPageSize = (size: ReaderPageSize, at: number, turn: number) => {
    const sideways = turn % 180 !== 0;
    return {
      minWidth: `${Math.floor((sideways ? size.height : size.width) * at)}px`,
      minHeight: `${Math.floor((sideways ? size.width : size.height) * at)}px`,
    };
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
      <div className="pdf-reader-chrome">
        <ReaderToolbar viewport={viewport} numPages={numPages} />
        <div className="pdf-reader-tools">
        <ReaderSearchBar
          pages={pageTexts}
          onJump={(match) => {
            viewport.setPage(match.pageIndex + 1);
          }}
          onMatches={(matches, active) => setFind({ matches, active })}
        />
        <div className="pdf-reader-group">
          {/* Outline, citations and references all live in the side column the
              pen's focus hides, so their toggles stand down with it rather than
              offering a switch that would appear to do nothing. Two-page and
              the search bar stay: they are the page's own controls. */}
          {!penFocused && (
            <button
              type="button"
              className={`btn-secondary btn-sm${showOutline ? " is-active" : ""}`}
              aria-pressed={showOutline}
              onClick={() => setShowOutline((v) => !v)}
            >
              {outline.some((item) => item.y !== undefined) ? "Sections (detected)" : "Outline"}
            </button>
          )}
          <button
            type="button"
            className={`btn-secondary btn-sm${spread ? " is-active" : ""}`}
            aria-pressed={spread}
            onClick={() => setSpread((v) => !v)}
          >
            Two-page
          </button>
          {!penFocused && (
            <button
              type="button"
              className={`btn-secondary btn-sm${refs.enabled ? " is-active" : ""}`}
              aria-pressed={refs.enabled}
              onClick={refs.toggle}
            >
              Link citations
            </button>
          )}
          {!penFocused && (
            <button
              type="button"
              className={`btn-secondary btn-sm${showReferences ? " is-active" : ""}`}
              aria-pressed={showReferences}
              onClick={() => setShowReferences((v) => !v)}
            >
              References{refs.index.references.length ? ` (${refs.index.references.length})` : ""}
            </button>
          )}
        </div>
        <button
          type="button"
          className="btn-secondary btn-sm pdf-reader-focus-btn"
          title="Focus (⌘⇧F)"
          aria-label="Focus"
          onClick={toggleFocus}
        >
          <FocusGlyph on={false} />
        </button>
        {canCreate && (
          <button
            type="button"
            className={`btn-secondary btn-sm${penOpen ? " is-active" : ""}`}
            aria-pressed={penOpen}
            onClick={() => {
              endInkGroup();
              setPenOpen((v) => !v);
            }}
          >
            Pen
          </button>
        )}
        {canCreate && !penOpen && (
          <div className="pdf-reader-group">
            <Select
              className="pdf-reader-tool-select"
              aria-label="Annotation tool"
              value={createTool}
              onChange={(e) => {
                // Switching tool ends the mark in progress, so the next stroke
                // never merges into one drawn with a different nib.
                endInkGroup();
                setCreateTool(e.target.value as ReaderCreateTool);
              }}
            >
              {/* Named by what each does, not by what it is. "Image region"
                  and "Text box" both drag out a rectangle, so the old labels
                  gave no way to tell them apart. */}
              <option value="select">Highlight text</option>
              <option value="ink">Draw freehand</option>
              <option value="highlighter">Highlighter pen</option>
              <option value="erase">Erase ink</option>
              <option value="image">Clip a region</option>
              <option value="text">Write a note</option>
            </Select>
            <ColourMenu
              value={createColor}
              palette={READER_ANNOTATION_COLORS}
              recent={pen.prefs.recent}
              ariaLabel="Annotation colour"
              onChange={(colour) => {
                endInkGroup();
                setCreateColor(colour);
              }}
            />
          </div>
        )}
        </div>
        {canCreate && penOpen && (
          <PenRail
            tool={pen.prefs.tool}
            color={pen.prefs.color}
            nib={pen.prefs.nib}
            recent={pen.prefs.recent}
            canUndo={inkUndo.canUndo}
            canRedo={inkUndo.canRedo}
            onTool={(tool) => {
              endInkGroup();
              pen.setTool(tool);
            }}
            onColor={(color) => {
              endInkGroup();
              pen.setColor(color);
            }}
            onNib={(nib) => {
              endInkGroup();
              pen.setNib(nib);
            }}
            onUndo={() => void inkUndo.undo()}
            onRedo={() => void inkUndo.redo()}
            onClose={() => {
              endInkGroup();
              setPenOpen(false);
            }}
          />
        )}
      </div>
      {/* Both rectangle tools look identical while dragging, so say which one
          is armed and what releasing will do. */}
      {canCreate && CREATE_TOOL_HINTS[createTool] && (
        <p className="pdf-reader-tool-hint muted">{CREATE_TOOL_HINTS[createTool]}</p>
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
          !penFocused && (showOutline || annotations.length > 0 || canCreate)
            ? " pdf-reader-body--outline"
            : ""
        }`}
      >
        {!penFocused && (showOutline || showReferences || annotations.length > 0 || canCreate) && (
          <div className="pdf-reader-side">
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
          className={`pdf-reader-scroll${spread ? " pdf-reader-scroll--spread" : ""}`}
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
              onPointerDown={(e) => onPagePointerDown(n, e)}
              onPointerMove={onPagePointerMove}
              onPointerUp={(e) => onPagePointerUp(n, e)}
              onPointerCancel={(e) => onPagePointerUp(n, e)}
            >
              <div
                className={`pdf-reader-page${
                  createTool !== "select" && canCreate ? " pdf-reader-page--draw" : ""
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
                    onSelect={selectAnnotation}
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

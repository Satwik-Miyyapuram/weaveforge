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
  type ReaderAnnotationType,
} from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { savePdfText } from "@/features/search/infrastructure/pdf-text-store";
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
import { DraftShapeOverlay, SafeExternalLink, TextBoxComposer } from "./overlays";
import { useAnnotationContext } from "./use-annotation-context";
import { useDarkPdf } from "./use-dark-pdf";
import { useAnnotationActions } from "./use-annotation-actions";
import { usePdfRendering } from "./use-pdf-rendering";
import { usePagePointer } from "./use-page-pointer";

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
}: PdfReaderProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [jump, setJump] = useState<JumpState>({ status: locus ? "searching" : "idle" });
  const [showOutline, setShowOutline] = useState(false);
  const [spread, setSpread] = useState(false);
  const [selectedAnnId, setSelectedAnnId] = useState<string | null>(null);
  const [createTool, setCreateTool] = useState<ReaderCreateTool>("select");
  const [createColor, setCreateColor] = useState<string>(READER_ANNOTATION_COLORS[0]);
  const [pendingCreate, setPendingCreate] = useState<{
    pageNumber: number;
    quote: string;
    selection: import("@weaveforge/core").TextSelectionRange;
  } | null>(null);
  const clearPendingCreate = useCallback(() => setPendingCreate(null), []);
  const { reportSections, pinsByKey, applyPin, backlinkHits } = useAnnotationContext(
    paperId,
    annotations,
  );
  const darkPdf = useDarkPdf();
  const {
    annError,
    setAnnError,
    createBusy,
    persistDraft,
    updateLocal,
    removeLocal,
    pinLocal,
    saveAnchor,
  } = useAnnotationActions({
    paperId,
    onAnnotationsChange,
    onActivity,
    applyPin,
    selectedAnnId,
    setSelectedAnnId,
    clearPendingCreate,
  });

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
        void removeLocal(selectedAnnId);
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

  return (
    <div
      className={`pdf-reader${darkPdf ? " pdf-reader--dark" : ""}`}
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
        />
        <div className="pdf-reader-group">
          <button
            type="button"
            className={`btn-secondary btn-sm${showOutline ? " is-active" : ""}`}
            aria-pressed={showOutline}
            onClick={() => setShowOutline((v) => !v)}
          >
            Outline
          </button>
          <button
            type="button"
            className={`btn-secondary btn-sm${spread ? " is-active" : ""}`}
            aria-pressed={spread}
            onClick={() => setSpread((v) => !v)}
          >
            Two-page
          </button>
        </div>
        {canCreate && (
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
            <input
              type="color"
              className="pdf-reader-color-input"
              aria-label="Annotation colour"
              value={createColor}
              onChange={(e) => {
                endInkGroup();
                setCreateColor(e.target.value);
              }}
            />
          </div>
        )}
        </div>
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
          showOutline || annotations.length > 0 || canCreate ? " pdf-reader-body--outline" : ""
        }`}
      >
        {(showOutline || annotations.length > 0 || canCreate) && (
          <div className="pdf-reader-side">
            {showOutline && (
              <ReaderOutline items={outline} onNavigate={(n) => viewport.setPage(n)} />
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
                onRemoveLocal={removeLocal}
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
        <div
          className={`pdf-reader-scroll${spread ? " pdf-reader-scroll--spread" : ""}`}
          ref={containerRef}
          onMouseUp={onSelectionMouseUp}
        >
          {!pdf && <div className="pdf-reader-loading">Loading PDF…</div>}
          {Array.from({ length: numPages }, (_, i) => i + 1).map((n) => (
            <div
              className={`pdf-reader-page${
                createTool !== "select" && canCreate ? " pdf-reader-page--draw" : ""
              }${createTool === "erase" && canCreate ? " pdf-reader-page--erase" : ""}${
                penSeen ? " pdf-reader-page--pen" : ""
              }`}
              data-page={n}
              key={n}
              onPointerDown={(e) => onPagePointerDown(n, e)}
              onPointerMove={onPagePointerMove}
              onPointerUp={(e) => onPagePointerUp(n, e)}
              onPointerCancel={(e) => onPagePointerUp(n, e)}
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
    </div>
  );
}

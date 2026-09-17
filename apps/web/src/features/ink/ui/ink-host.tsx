"use client";

/**
 * The ink host: what `document-host.tsx` mounts for `kind === "ink_page"`.
 *
 * Everything the ink view is, in one component that the kind table can point
 * at (§6.1). It owns the tool state, the canvas, the pen hook and the
 * worker's non-pen traffic; {@link InkBar}, {@link InkPage} and
 * {@link InkTextLayer} are the presentational parts, and the wiring it used
 * to hold inline is now the hooks it names: the saves and the sidecar
 * (§use-ink-note-store), the pen (§use-ink-pen), the worker's answers
 * (§use-ink-worker-rpc), the layout (§use-ink-layout), page media
 * (§use-ink-page-media), what a page change does (§use-ink-page-lifecycle),
 * recognition (§use-ink-recognition), the ghosts (§use-ghost-images), the
 * keyboard (§use-ink-shortcuts) and the rail (§ink-rail).
 *
 * Three things about *this* layer are load-bearing:
 *
 * - **Stacking.** The canvas is the topmost element of the page area and the
 *   bar and the text column are siblings *outside* the page container. A
 *   translucent `desynchronized` canvas with DOM above it silently loses the
 *   low-latency path (§6.1, §6.2.8); the CSS and this markup are the two
 *   halves of that rule.
 * - **The live stroke is not in React.** The hook hands samples straight to
 *   the worker; the only state that changes during a stroke is the committed
 *   count, which the worker reports once per stroke.
 * - **One worker, one door.** Loading a page, resizing, the viewport
 *   transform, erase, undo, lasso, save and export all go through `pen.send`,
 *   because the pen path owns the worker and a second one would double the
 *   geometry.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PromptDialog } from "@/components/prompt-dialog";
import {
  INK_A4_HEIGHT,
  INK_A4_WIDTH,
  INK_PEN_WIDTH,
  blankInkPage,
  clampInkPageSize,
  encodeInkChunk,
  inkAttachmentIndex,
  inkPageBackground,
  inkPageFigures,
  reorderFigures,
  joinInkTextLayer,
  newInkChunkId,
  readInkNoteBody,
  splitInkTextLayer,
  withInkPageBackground,
  withInkPageFigures,
  writeInkNoteBody,
  type FigureGeometry,
  type InkColour,
  type InkHand,
  type InkPaper,
  type InkNoteMeta,
  type InkPage as InkPageModel,
  type InkRecogniser,
  type InkRecognitionHints,
  type RecognisedLine,
} from "@weaveforge/core";

import { usePenCapture } from "../application/use-pen-capture";
import type { PenHaptics } from "../application/pen-haptics";
import { trailStyle } from "../application/ink-trail";
import {
  INK_RENDER_COLOURS,
  readThemePalette,
  samePalette,
  type InkPalette,
} from "../render/ink-palette";
import { backingRatio } from "../render/ink-renderer";
import type {
  InkWorkerEvent,
  InkWorkerMessage,
} from "../application/capture-protocol";
import {
  loadInkPages,
  type InkChunkStore,
  type InkStoredPage,
} from "../application/ink-chunk-store";
import { availableInkChunkCodec } from "../application/ink-chunk-codec";
import { pageListProblem, selectedPdfPages } from "../application/pdf-pages";
import { InkBar, type InkBarTool } from "./ink-bar";
import { InkFigures, InkFigureEditor } from "./ink-figures";
import { fitScale } from "./ink-page-math";
import { InkSheetTextUnderlay, pureInkPageText } from "./ink-sheet-underlay";
import { useInkSelection } from "./use-ink-selection";
import { InkPage } from "./ink-page";
import { InkRail } from "./ink-rail";
import { InkTextLayer } from "./ink-text-layer";
import { useFlowedTextPages } from "./ink-text-flow";
import { useDecodedStrokes } from "./use-decoded-strokes";
import { useGhostImages } from "./use-ghost-images";
import { useInkFigureUrls } from "./use-ink-figure-urls";
import { useInkLayout } from "./use-ink-layout";
import { useInkNativeOverlay } from "./use-ink-native-overlay";
import { useInkNoteStore } from "./use-ink-note-store";
import { useInkPageLifecycle } from "./use-ink-page-lifecycle";
import { useInkPageMedia } from "./use-ink-page-media";
import { useInkPen } from "./use-ink-pen";
import { useInkPrefs } from "./use-ink-prefs";
import { useInkShortcuts } from "./use-ink-shortcuts";
import { useInkWorkerRpc } from "./use-ink-worker-rpc";
import { useInkRecognition } from "./use-ink-recognition";
import { usePageExport } from "./use-page-export";
import type {
  InkHostDeps,
  InkHostPage,
  InkHostProps,
} from "./ink-host-types";

export type { InkHostDeps, InkHostPage, InkHostProps } from "./ink-host-types";

export function InkHost({
  noteId,
  body,
  deps,
  initialPage = 0,
  onSave,
}: InkHostProps) {
  const [pageIndex, setPageIndex] = useState(initialPage);
  /**
   * The page on screen, for a flow that takes several awaits to finish.
   *
   * Putting an image on a page means uploading it first, and by the time the
   * upload resolves the reader may be looking at the page the flow just made —
   * so a callback that finished later cannot ask the `pageIndex` it closed over.
   * This is that question with a live answer: it decides whether the page the
   * work was for is still the one in front of the user.
   */
  const pageIndexRef = useRef(pageIndex);
  useEffect(() => {
    pageIndexRef.current = pageIndex;
  }, [pageIndex]);
  const [showTextLayer, setShowTextLayer] = useState<boolean>(false);
  /**
   * The bar's choices (§use-ink-prefs): the tool in force, and the colour
   * each tool remembers — a return from the highlighter hands the pen back
   * its own colour, not a fluorescent yellow.
   */
  const { tool, setTool, colour, onColourChange } = useInkPrefs();
  const [width, setWidth] = useState<number>(INK_PEN_WIDTH);
  const [zoom, setZoom] = useState(1);
  const [containerWidth, setContainerWidth] = useState(0);
  /** The scroller's visible box: the canvas is never larger than this. */
  const [view, setView] = useState({ width: 0, height: 0 });
  const sheetRef = useRef<HTMLDivElement>(null);
  /** The pages, once the sidecar has answered; `pageCount` is what React renders from. */
  const pagesRef = useRef<InkStoredPage[] | null>(null);
  const [pageCount, setPageCount] = useState(0);
  /** What the file input is for: a PDF whose page becomes a new page here. */
  const pdfInputRef = useRef<HTMLInputElement>(null);
  /** What the second file input is for: an image for this page, as a figure. */
  const imageInputRef = useRef<HTMLInputElement>(null);
  /**
   * The pane, focused on a pointer-down. A `paste` goes to the focused element
   * and a canvas is not one, so the wrap takes focus itself — which is also
   * what keeps a screenshot pasted into the note editor out of here.
   */
  const wrapRef = useRef<HTMLDivElement>(null);
  /** The header, as it will be written back. */
  const metaRef = useRef<InkNoteMeta>(readInkNoteBody(body).meta);
  /** The writing hand, mirrored into state so the bar and the gate follow it. */
  const [hand, setHandState] = useState<InkHand>(metaRef.current.hand);
  const [paper, setPaperState] = useState<InkPaper>(metaRef.current.paper);
  /** The text layer's pages, for the body (§4.2). */
  const textPagesRef = useRef<string[]>(
    splitInkTextLayer(readInkNoteBody(body).text),
  );
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  /**
   * The theme's ink colours, read off the document. State rather than a ref
   * because the trail's style and the native overlay's tool depend on it.
   */
  const [palette, setPalette] = useState<InkPalette>(INK_RENDER_COLOURS);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * The worker's answers, by request id (§use-ink-worker-rpc): history counts,
   * the page's size, the lasso's selection, and the three asks. The door is a
   * ref because the pen hook — which owns it — takes this hook's answer
   * handler as one of its own inputs.
   */
  const sendRef = useRef<((message: InkWorkerMessage, transfer?: Transferable[]) => void) | null>(null);
  const rpc = useInkWorkerRpc({
    sendRef,
    initialPageSize: {
      width: INK_A4_WIDTH,
      height: INK_A4_HEIGHT,
    },
  });
  const {
    history,
    strokes,
    setStrokes,
    selection,
    setSelection,
    selectionBounds,
    setSelectionBounds,
    pageSize,
    onEvent,
    requestModel,
    requestSave,
    requestExport,
  } = rpc;

  const scale = useMemo(
    () => fitScale(containerWidth) * zoom,
    [containerWidth, zoom],
  );
  const page: InkStoredPage = pagesRef.current?.[pageIndex] ?? {
    chunkId: "",
    chunk: null,
    paper: metaRef.current.paper,
  };

  /** The rail's ghosts, fetched once per page (§use-ghost-images). */
  const ghostImages = useGhostImages({
    fetchBlob: deps.assets.fetchBlob,
    textPagesRef,
    pageCount,
    pageIndex,
  });
  /**
   * Client coordinates to page units. The one projection everything shares.
   * Against the sheet, not the canvas: the canvas is only the visible part.
   */
  const project = useCallback((clientX: number, clientY: number) => {
    const sheet = sheetRef.current;
    if (!sheet) return null;
    const box = sheet.getBoundingClientRect();
    return {
      x: ((clientX - box.left) / Math.max(box.width, 1)) * pageSize.width,
      y: ((clientY - box.top) / Math.max(box.height, 1)) * pageSize.height,
    };
  }, [pageSize.height, pageSize.width]);

  /**
   * The note's own saves (§use-ink-note-store): the header and body written
   * late, the sidecar loaded once, a blank page appended on ask. Placed here
   * because the pen below needs `scheduleSave` and the store needs the RPC's
   * `requestSave` above.
   */
  const {
    noteBody,
    saveBody,
    scheduleSave,
    flushSave,
    chunkVersion,
    ensurePageCount,
    onAddPage,
    goToPage,
  } = useInkNoteStore({
      noteId,
      onSave,
      chunks: deps.chunks,
      metaRef,
      pagesRef,
      textPagesRef,
      requestSave,
      pageIndex,
      pageCount,
      setPageCount,
      setPageIndex,
    });

  /**
   * The rail's static slots draw from the chunks; `chunkVersion` is what
   * tells them a page just written has new ink, since the list is a ref.
   */
  const strokesMap = useDecodedStrokes({
    pages: pagesRef.current,
    version: chunkVersion,
    activePageIndex: pageIndex,
    strokesCount: strokes,
  });

  /**
   * The pen (§use-ink-pen): capture, haptics, and the one worker door it
   * owns. The RPC's asks ride on the ref because the answer handler is one
   * of the pen's own inputs.
   */
  const { pen, penHandlers, nib } = useInkPen({
    canvasRef,
    sheetRef,
    project,
    pageIndex,
    tool,
    width,
    colour,
    hand,
    palette,
    onEvent,
    onStrokeEnd: () => {
      // One state change per stroke, which is the contract the hook's doc comment
      // makes: the live stroke never entered React, so there is nothing to batch.
      setStrokes((count) => count + 1);
      scheduleSave();
    },
    haptics: deps.haptics?.bind(deps),
  });

  const { send } = pen;
  // The worker's door, handed to the RPC hook's asks: the pen exists now, and
  // every ask runs after this render.
  sendRef.current = (message, transfer) => send(message, transfer);

  /**
   * Whether a stroke is in flight, by ref: the scroll watcher asks this
   * rather than closing over the session, so a stable answer can be one of
   * its dependencies.
   */
  const penSessionRef = useRef(pen.session);
  penSessionRef.current = pen.session;
  const penSessionActive = useCallback(
    () => penSessionRef.current.active,
    [],
  );

  /**
   * The paper is the note's too (§6.2.12): every stored page carries a copy,
   * so the pages already loaded take the new one before the sheet re-renders.
   */
  const setPaper = useCallback(
    (next: InkPaper) => {
      metaRef.current = { ...metaRef.current, paper: next };
      for (const stored of pagesRef.current ?? []) stored.paper = next;
      setPaperState(next);
      scheduleSave();
    },
    [scheduleSave],
  );

  /** The hand is the note's (§4.1), so changing it is a save. */
  const setHand = useCallback(
    (next: InkHand) => {
      metaRef.current = { ...metaRef.current, hand: next };
      setHandState(next);
      scheduleSave();
    },
    [scheduleSave],
  );

  /**
   * The current page's recognition, for the column and for corrections
   * (§use-ink-recognition). Asked for here rather than at the top of the
   * component because the flow needs `requestModel`, which needs the worker
   * the pen hook owns.
   */
  const recognition = useInkRecognition({
    recogniser: deps.recogniser.bind(deps),
    hints: deps.hints.bind(deps),
    requestModel,
    sendReplace: (page) => send({ type: "replace-page", page }),
    metaRef,
    textPagesRef,
    pageIndex,
    scheduleSave,
  });
  const { recognised, recognising, progress, unavailable, setUnavailable } =
    recognition;

  /**
   * The figures on the page being looked at (§figure): images placed on the
   * paper, as many as wanted, moved and resized by hand. The text layer is
   * the model — `withInkPageFigures` reads and writes the block — and this
   * state is only its mirror for rendering, kept in step on every page change
   * and every drag's end.
   */
  const [figures, setFigures] = useState<readonly FigureGeometry[]>([]);
  const figuresRef = useRef<readonly FigureGeometry[]>([]);
  figuresRef.current = figures;
  /**
   * The figure whose controls are open, by index into `figures` — `null`
   * when none are. The controls are the only figure DOM above the canvas,
   * because they are the only part that takes its own pointer events.
   */
  const [figureControls, setFigureControls] = useState<number | null>(null);

  /** A figure's placement changed: write the block back and save. */
  const onFiguresChange = useCallback(
    (next: readonly FigureGeometry[]) => {
      setFigures(next);
      const text = textPagesRef.current[pageIndexRef.current] ?? "";
      textPagesRef.current[pageIndexRef.current] = withInkPageFigures(text, next);
      scheduleSave();
    },
    [scheduleSave],
  );

  /**
   * Page media (§use-ink-page-media): a page's background and its figures,
   * by the three doors they arrive through — the bar's buttons, a drop, a
   * paste. The flows own their uploads and their dialogs; the host owns the
   * worker they tell and the page count they grow.
   */
  const media = useInkPageMedia({
    noteId,
    chunks: deps.chunks,
    assets: deps.assets,
    pagesRef,
    metaRef,
    textPagesRef,
    pageIndexRef,
    pageSize,
    noteBody: () => noteBody().body,
    saveBody,
    flushSave,
    scheduleSave,
    onFiguresChange,
    figuresRef,
    setUnavailable,
    onBackgroundReady: (image, index) =>
      send({ type: "set-background", image, index }, [image]),
    onBackgroundCleared: () => send({ type: "set-background", image: null, index: 0 }),
    onPageAppended: (count) => {
      setPageCount(count);
      setPageIndex(count - 1);
    },
    wrapRef,
  });
  const {
    inserting,
    backgroundPath,
    setBackgroundPath,
    pageAsk,
    answerPdfPages,
    onSetPageBackground,
    onRemovePageBackground,
    onAddFigure,
    onInsertPage,
  } = media;

  /**
   * What happens when the page changes (§use-ink-page-lifecycle): the
   * background and the figures the render reads out of the text layer, and
   * the page the worker is told to load.
   */
  useInkPageLifecycle({
    send,
    fetchBlob: deps.assets.fetchBlob,
    noteBody: () => noteBody().body,
    pageIndex,
    pageCount,
    pagesRef,
    metaRef,
    textPagesRef,
    setStrokes,
    setSelection,
    setBackgroundPath,
    setFigures,
    setFigureControls,
    requestModel,
    recognitionReset: recognition.reset,
    // The recognition hook's own `useCallback`s, stable by contract, so the
    // load effect does not re-run on a fresh render's wrapper identity.
    recognitionOnModelLoaded: recognition.onModelLoaded,
  });

  /**
   * The host's layout wiring (§use-ink-layout): the palette kept in step with
   * the theme, the worker's viewport told where the page is, the pane
   * measured, and the rail's scroll watched for a page flip.
   */
  const { ensurePageAt } = useInkLayout({
    send,
    backend: pen.backend,
    canvasRef,
    sheetRef,
    scrollRef,
    scale,
    view,
    pageSize,
    pageIndex,
    pageCount,
    flushSave,
    setPageIndex,
    setContainerWidth,
    setView,
    setPalette,
    sessionActive: penSessionActive,
  });

  /*
   * The native shell's ink overlay, when there is one (§use-ink-native-overlay):
   * the bridge that inks over the page itself and hands each finished stroke
   * back, kept told where the page is and what the pen looks like.
   */
  const native = useInkNativeOverlay({
    canvasRef,
    scrollRef,
    sheetRef,
    tool: tool === "highlighter" ? "highlighter" : "pen",
    colour,
    nib,
    palette,
    scale,
    session: pen.session,
    penOnly: pen.penOnly,
    handedness: hand,
  });

  /** A recognised page becomes the worker's page, the column's lines and the body's text. */
  const { recognise, onAccept } = recognition;

  /**
   * The page as a PNG download, the page on paper, and the page as vectors.
   *
   * The blob comes back from the worker's offscreen target, never from a
   * readback of the live canvas (§6.2.12). Printing goes through the same
   * raster rather than through the DOM, because what the user sees is a
   * *window* onto the sheet — the canvas is the size of the viewport, not the
   * page (§6.2.14) — so printing the screen would crop the page to whatever
   * happened to be scrolled into view.
   */
  const { onExportPng, onPrint, onExportSvg } = usePageExport({
    requestExport,
    requestModel,
    noteId,
    pageIndex,
    textPages: textPagesRef,
    pageSize,
    palette,
    fetchBlob: deps.assets.fetchBlob,
  });

  /**
   * The figures' images, fetched once per path (§use-ink-figure-urls): a
   * blob URL per figure path, kept for the page being looked at.
   */
  const figureUrls = useInkFigureUrls({
    fetchBlob: deps.assets.fetchBlob,
    figures,
  });

  /** The bar's image button: a figure, of which a page may hold any number. */
  const onAddImageToCurrentPage = useCallback(() => {
    imageInputRef.current?.click();
  }, []);

  /** The file the image picker produced: a figure on the page it was picked for. */
  const onImageFile = useCallback(
    (file: File) => {
      void onAddFigure(file);
    },
    [onAddFigure],
  );

  const {
    onLasso,
    onMoveSelection,
    onDragSelection,
    onDeleteSelection,
    onCopyAsText,
  } = useInkSelection({
    send,
    scheduleSave,
    selection,
    setSelection,
    setSelectionBounds,
    requestModel,
  });

  /**
   * The keyboard and the wheel (§use-ink-shortcuts): tools, undo, recognise,
   * print and export, the selection, and the zoom a ⌘/Ctrl wheel asks for.
   */
  useInkShortcuts({
    send,
    scheduleSave,
    setTool,
    onColourChange,
    selectionCount: selection.length,
    clearSelection: () => setSelection([]),
    onDeleteSelection,
    recognise: () => void recognise(),
    onPrint: () => void onPrint(),
    onExportPng: () => void onExportPng(),
    onExportSvg: () => void onExportSvg(),
    scrollRef,
    setZoom,
  });

  /** One finger dragged the page: scroll the other way, so the paper follows. */
  const onPan = useCallback((dx: number, dy: number) => {
    scrollRef.current?.scrollBy(-dx, -dy);
  }, []);

  /** Two fingers pinched: zoom, clamped like the wheel is. */
  const onPinch = useCallback((factor: number) => {
    setZoom((value) => Math.min(4, Math.max(0.5, value * factor)));
  }, []);

  const onErase = useCallback(
    (from: { x: number; y: number }, to: { x: number; y: number }) => {
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

  // The text as shown: each page's own text, flowed on to the next where it
  // does not fit (§ink-text-flow). Pages it runs past are made real, so the
  // pen can land on them.
  const pureTextPages = useMemo(
    () => textPagesRef.current.map((text) => pureInkPageText(text)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [textPagesRef.current.join("␞"), pageCount],
  );
  const flowedText = useFlowedTextPages(pureTextPages, pageSize, scale);
  useEffect(() => {
    if (flowedText.length > pageCount) ensurePageCount(flowedText.length);
  }, [ensurePageCount, flowedText.length, pageCount]);
  const pureText = flowedText[pageIndex] ?? "";

  const lines: readonly RecognisedLine[] = recognised?.lines ?? [];
  const confidence = recognised?.confidence ?? 0;

  return (
    <div
      ref={wrapRef}
      className={`ink-wrap${showTextLayer ? "" : " ink-text-hidden"}`}
      // Focusable but not a tab stop: the pane takes focus when it is clicked,
      // which is what a paste is aimed at and what the keyboard shortcuts above
      // already assume.
      tabIndex={-1}
      onPointerDownCapture={() => wrapRef.current?.focus({ preventScroll: true })}
    >
      <input
        ref={pdfInputRef}
        type="file"
        accept="application/pdf,.pdf,image/*"
        hidden
        data-ink-page-input=""
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void onInsertPage(file);
        }}
      />
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*,application/pdf,.pdf"
        hidden
        data-ink-image-input=""
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) onImageFile(file);
        }}
      />
      <InkBar
        tool={tool}
        colour={colour}
        width={width}
        page={pageIndex + 1}
        pages={Math.max(pageCount, 1)}
        strokes={strokes}
        recognised={confidence}
        penOnly={pen.penOnly}
        hand={hand}
        delegating={pen.delegating}
        penSeen={pen.penSeen}
        backend={pen.backend}
        busy={recognising}
        progress={progress}
        canUndo={history.undo > 0}
        canRedo={history.redo > 0}
        selected={selection.length}
        showTextLayer={showTextLayer}
        onToggleTextLayer={() => setShowTextLayer((prev) => !prev)}
        onTool={(next) => {
          if (next !== "lasso" && selection.length > 0) {
            send({ type: "select-clear" });
            setSelection([]);
          }
          setTool(next);
        }}
        onColour={onColourChange}
        onWidth={(next) => {
          setWidth(next);
          setTool("pen");
        }}
        onPenOnly={pen.setPenOnly}
        onHand={setHand}
        paper={paper}
        onPaper={setPaper}
        onRecognise={() => void recognise()}
        onPrint={() => void onPrint()}
        onExportPng={() => void onExportPng()}
        onExportSvg={() => void onExportSvg()}
        onUndo={onUndo}
        onRedo={onRedo}
        onAddPage={onAddPage}
        onAddImage={onAddImageToCurrentPage}
        hasPageBackground={Boolean(backgroundPath)}
        onRemovePageBackground={() => void onRemovePageBackground()}
        onInsertPage={() => pdfInputRef.current?.click()}
        onPrevPage={() => goToPage(pageIndex - 1)}
        onNextPage={() => goToPage(pageIndex + 1)}
        onDeleteSelection={onDeleteSelection}
        onCopyAsText={() => void onCopyAsText()}
      />
      {/* The rail: continuous multi-page scroll with background active page switching. */}
      <InkRail
        scrollRef={scrollRef}
        pageIndex={pageIndex}
        pageCount={pageCount}
        pageSize={pageSize}
        scale={scale}
        paper={page.paper}
        pages={pagesRef.current}
        ghosts={ghostImages}
        strokesMap={strokesMap}
        textPages={textPagesRef.current}
        flowedText={flowedText}
        figureUrls={figureUrls}
        palette={palette}
      >
        <InkPage
          pageIndex={pageIndex}
          pageSize={pageSize}
          sheetRef={sheetRef}
          view={view}
          scale={scale}
          paper={page.paper}
          tool={tool}
          project={project}
          penHandlers={penHandlers}
          canvasRef={canvasRef}
          onErase={onErase}
          onLasso={onLasso}
          selectionBounds={selectionBounds}
          onMoveSelection={onMoveSelection}
          onDragSelection={onDragSelection}
          penOnly={pen.penOnly}
          penSeen={pen.penSeen}
          onPan={onPan}
          onPinch={onPinch}
          // A file dropped on the sheet lands where it was dropped: an image
          // becomes a figure at the pointer, a PDF still becomes the page's
          // background, because its raster is a page.
          onDropFile={(file, at) => void onAddFigure(file, at ?? undefined)}
          figures={figures}
          editingFigure={figureControls}
          onFigureChange={(index, geometry) => {
            // The surface reports a placement; the text layer is the model.
            const next = figuresRef.current.map((one, i) =>
              i === index ? { ...one, ...geometry } : one,
            );
            onFiguresChange(next);
          }}
          onFigureActivate={(index) => setFigureControls(index)}
          ensurePage={ensurePageAt}
          penActive={penSessionActive}
          below={
            <>
              <InkSheetTextUnderlay text={pureText} scale={scale} />
              <InkFigures
                figures={figures}
                scale={scale}
                imageUrls={figureUrls}
                activeIndex={figureControls}
              />
            </>
          }
          above={
            figureControls !== null && figures[figureControls] ? (
              <InkFigureEditor
                figure={figures[figureControls]}
                index={figureControls}
                count={figures.length}
                scale={scale}
                pageSize={pageSize}
                imageUrl={figureUrls.get(figures[figureControls].path)}
                onChange={(next) => {
                  const next_ = figuresRef.current.map((one, i) => {
                    if (i !== figureControls) return one;
                    const { crop, ...box } = next;
                    return crop ? { ...one, ...box, crop } : { path: one.path, ...box };
                  });
                  onFiguresChange(next_);
                }}
                onReorder={(step) => {
                  // The block's order is the paint order: moving the line
                  // moves the picture, and the editor follows it to its new
                  // index.
                  const next = reorderFigures(figuresRef.current, figureControls, step);
                  const moved = next.indexOf(figuresRef.current[figureControls]!);
                  onFiguresChange(next);
                  setFigureControls(moved);
                }}
                onRemove={() => {
                  onFiguresChange(
                    figuresRef.current.filter((_, i) => i !== figureControls),
                  );
                  setFigureControls(null);
                }}
                onClose={() => setFigureControls(null)}
              />
            ) : null
          }
        />
      </InkRail>
      <InkTextLayer
        lines={lines}
        confidence={confidence}
        progress={progress}
        unavailable={unavailable}
        onAccept={onAccept}
        rawText={pureText}
      />
      {/* The page-list question is the only one left standing at the pane's
          edge: an image is a figure now, of which a page may hold any number,
          so there is no replace-or-new-page question to ask about one. */}
      {pageAsk ? (
        <PromptDialog
          title="Which pages?"
          body={`This PDF has ${pageAsk.count} pages. Each one imported becomes a page of its own.`}
          label="Pages (a number, a list like 1,3-5, or all)"
          initialValue="all"
          confirmLabel="Import these pages"
          validate={(value) => pageListProblem(value, pageAsk.count)}
          onConfirm={(value) => answerPdfPages(selectedPdfPages(value, pageAsk.count))}
          onClose={() => answerPdfPages(null)}
        />
      ) : null}
    </div>
  );
}

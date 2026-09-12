"use client";

/**
 * The ink host: what `document-host.tsx` mounts for `kind === "ink_page"`.
 *
 * Everything the ink view is, in one component that the kind table can point at
 * (§6.1). It owns the tool state, the canvas, the pen hook and the worker's
 * non-pen traffic; {@link InkBar}, {@link InkPage} and {@link InkTextLayer} are
 * the presentational parts.
 *
 * What it is handed is a note id, the note's body and a way to save the body;
 * what it does with them is the whole of §4 and §5 as the user sees it:
 *
 * - **Pages come from the sidecar.** The host asks the chunk store for the
 *   note's pages itself (`loadInkPages`), so the pane never learns the format.
 * - **Every stroke is saved, late.** A stroke ends, a timer starts, and when it
 *   fires the worker hands back the page's chunk, which goes to the store, and
 *   the body's header goes to `onSave` with the page count and order. Nothing
 *   is written mid-stroke.
 * - **Recognition is on demand and per line.** The page model comes from the
 *   worker, `recognisePage` runs it through the session's engine with the
 *   workspace's vocabulary, the segmented page goes back to the worker with
 *   `replace-page`, and the text layer gets the lines. A correction in the text
 *   column marks a line certain and is saved the same way.
 *
 * Three things about *this* layer are load-bearing:
 *
 * - **Stacking.** The canvas is the topmost element of the page area and the bar
 *   and the text column are siblings *outside* the page container. A translucent
 *   `desynchronized` canvas with DOM above it silently loses the low-latency path
 *   (§6.1, §6.2.8); the CSS and this markup are the two halves of that rule.
 * - **The live stroke is not in React.** The hook hands samples straight to the
 *   worker; the only state that changes during a stroke is the committed count,
 *   which the worker reports once per stroke.
 * - **One worker, one door.** Loading a page, resizing, the viewport transform,
 *   erase, undo, lasso, save and export all go through `pen.send`, because the
 *   pen path owns the worker and a second one would double the geometry.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  INK_A4_HEIGHT,
  INK_A4_WIDTH,
  INK_PEN_WIDTH,
  blankInkPage,
  clampInkPageSize,
  encodeInkChunk,
  inkAttachmentIndex,
  inkPageBackground,
  joinInkTextLayer,
  newInkChunkId,
  readInkNoteBody,
  splitInkTextLayer,
  withInkPageBackground,
  writeInkNoteBody,
  type InkColour,
  type InkHand,
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
import {
  installNativeStrokeHandler,
  nativeInkBridge,
  nativeStrokeEvents,
} from "../application/native-bridge";
import type {
  InkStrokeHeader,
  InkWorkerEvent,
} from "../application/capture-protocol";
import {
  loadInkPages,
  type InkChunkStore,
  type InkStoredPage,
} from "../application/ink-chunk-store";
import { pdfPageCount, rasterisePdfPage } from "../application/pdf-page-raster";
import {
  acceptLine,
  recognisePage,
  recognisedPageFromModel,
  type RecognisedPage,
} from "../application/recognise-page";
import { InkBar, nibForTool, type InkBarTool } from "./ink-bar";
import { InkPage } from "./ink-page";
import { InkTextLayer } from "./ink-text-layer";

/** A page as the host holds it: the sidecar's view of it. */
export type InkHostPage = InkStoredPage;

/** What the host needs from the container; the ink facade satisfies it. */
export interface InkHostDeps {
  chunks: InkChunkStore;
  /** Where a page background lives (§4.8): the vault's attachments. */
  assets: {
    upload(ownerId: string, blob: Blob, ext: string): Promise<string>;
    fetchBlob(path: string): Promise<Blob>;
  };
  recogniser: () => Promise<InkRecogniser | null>;
  hints: () => Promise<InkRecognitionHints>;
  /** The pen's actuator, where the platform can drive one; `null` elsewhere. */
  haptics?: () => Promise<PenHaptics | null>;
}

export interface InkHostProps {
  /** The note whose sidecar holds the pages. */
  noteId: string;
  /** The note's body: the ink header and the recognised text layer. */
  body: string;
  deps: InkHostDeps;
  /** The page the note opens on, 0-based. */
  initialPage?: number;
  /** Where the body goes when a page, the order or the text layer changes. */
  onSave?: (body: string) => Promise<void>;
}

/** How long after the last stroke the page is written. */
export const INK_SAVE_DELAY_MS = 1200;

/** The message the text column shows where no engine can run. */
export const INK_NO_ENGINE_MESSAGE =
  "No handwriting engine is available here. On Windows the desktop app recognises offline; a MyScript key in Settings enables recognition elsewhere.";

/**
 * The fit: how many CSS pixels one 0.1 mm unit is worth.
 *
 * A page is A4 at 0.1 mm and the pane is whatever width it is, so the default view
 * is fit-width and vertical scrolling is the vertical navigation — a page, not an
 * infinite canvas (§1). Zoom is a multiplier on that fit, which keeps "reset" a
 * number rather than a rect, and the worker's transform is one `postMessage` away
 * (§6.2.1: pan and zoom are uniform updates, so neither needs machinery).
 */
export function fitScale(
  containerWidth: number,
  pageWidth = INK_A4_WIDTH,
): number {
  if (!(containerWidth > 0)) return 1;
  return containerWidth / pageWidth;
}

/** The lines the lasso's strokes belong to, as text, one per line. */
export function selectedText(
  page: InkPageModel,
  indices: readonly number[],
): string {
  const chosen = new Set(indices);
  const out: string[] = [];
  for (const line of page.lines) {
    if (!line.text) continue;
    for (
      let i = line.strokeStart;
      i < line.strokeStart + line.strokeCount;
      i += 1
    ) {
      if (chosen.has(i)) {
        out.push(line.text);
        break;
      }
    }
  }
  return out.join("\n");
}

export function InkHost({
  noteId,
  body,
  deps,
  initialPage = 0,
  onSave,
}: InkHostProps) {
  const [pageIndex, setPageIndex] = useState(initialPage);
  const [tool, setTool] = useState<InkBarTool | "shape">("pen");
  const [penColour, setPenColour] = useState<InkColour>("text");
  const [highlighterColour, setHighlighterColour] = useState<InkColour>("warn");
  const [showTextLayer, setShowTextLayer] = useState<boolean>(false);
  const colour = tool === "highlighter" ? highlighterColour : penColour;

  const onColourChange = useCallback(
    (c: InkColour) => {
      if (tool === "highlighter") {
        setHighlighterColour(c);
      } else {
        setPenColour(c);
        if (tool !== "pen") setTool("pen");
      }
    },
    [tool],
  );
  const [width, setWidth] = useState<number>(INK_PEN_WIDTH);
  const [zoom, setZoom] = useState(1);
  const [strokes, setStrokes] = useState(0);
  const [containerWidth, setContainerWidth] = useState(0);
  const [history, setHistory] = useState({ undo: 0, redo: 0 });
  const [selection, setSelection] = useState<number[]>([]);
  /** The selection's box in page units, for the page to offer a drag inside it. */
  const [selectionBounds, setSelectionBounds] = useState<
    readonly [number, number, number, number] | null
  >(null);
  const [recognising, setRecognising] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  /** The pages, once the sidecar has answered; `pageCount` is what React renders from. */
  const pagesRef = useRef<InkStoredPage[] | null>(null);
  const [pageCount, setPageCount] = useState(0);
  /** The current page's size in page units; an inserted PDF page keeps its aspect. */
  const [pageSize, setPageSize] = useState({
    width: INK_A4_WIDTH,
    height: INK_A4_HEIGHT,
  });
  /** What the file input is for: a PDF whose page becomes a new page here. */
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const [inserting, setInserting] = useState(false);
  /** The header, as it will be written back. */
  const metaRef = useRef<InkNoteMeta>(readInkNoteBody(body).meta);
  /** The writing hand, mirrored into state so the bar and the gate follow it. */
  const [hand, setHandState] = useState<InkHand>(metaRef.current.hand);
  /** The text layer's pages, for the body (§4.2). */
  const textPagesRef = useRef<string[]>(
    splitInkTextLayer(readInkNoteBody(body).text),
  );
  /** The current page's recognition, for the column and for corrections. */
  const [recognised, setRecognised] = useState<RecognisedPage | null>(null);
  const recognisedRef = useRef<RecognisedPage | null>(null);
  recognisedRef.current = recognised;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  /**
   * The theme's ink colours, read off the document. State rather than a ref
   * because the trail's style and the native overlay's tool depend on it.
   */
  const [palette, setPalette] = useState<InkPalette>(INK_RENDER_COLOURS);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestSeq = useRef(0);
  const pendingModel = useRef(new Map<number, (page: InkPageModel) => void>());
  const pendingSave = useRef(
    new Map<number, (bytes: Uint8Array | null) => void>(),
  );
  const pendingExport = useRef(new Map<number, (png: Blob | null) => void>());

  const scale = useMemo(
    () => fitScale(containerWidth) * zoom,
    [containerWidth, zoom],
  );
  const page: InkStoredPage = pagesRef.current?.[pageIndex] ?? {
    chunkId: "",
    chunk: null,
    paper: metaRef.current.paper,
  };

  /** Client coordinates to page units. The one projection everything shares. */
  const project = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const box = canvas.getBoundingClientRect();
    return {
      x: ((clientX - box.left) / Math.max(box.width, 1)) * INK_A4_WIDTH,
      y: ((clientY - box.top) / Math.max(box.height, 1)) * INK_A4_HEIGHT,
    };
  }, []);

  const nib = nibForTool(tool, width);

  /** The save is late and coalesced: one write after the last stroke settles. */
  const persistRef = useRef<() => Promise<void>>(async () => {});
  const scheduleSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      void persistRef.current();
    }, INK_SAVE_DELAY_MS);
  }, []);

  /** The worker's non-pen replies, matched to what asked for them. */
  const onEvent = useCallback((event: InkWorkerEvent) => {
    switch (event.type) {
      case "history":
        setHistory({ undo: event.undo, redo: event.redo });
        break;
      case "page-state":
        setStrokes(event.strokes);
        setPageSize((size) =>
          size.width === event.width && size.height === event.height
            ? size
            : { width: event.width, height: event.height },
        );
        break;
      case "page-model":
        pendingModel.current.get(event.requestId)?.(event.page);
        pendingModel.current.delete(event.requestId);
        break;
      case "page-saved":
        pendingSave.current.get(event.requestId)?.(event.bytes);
        pendingSave.current.delete(event.requestId);
        break;
      case "exported":
        pendingExport.current.get(event.requestId)?.(event.png);
        pendingExport.current.delete(event.requestId);
        break;
      case "selected":
        setSelection(event.indices);
        setSelectionBounds(event.bounds);
        break;
      case "error":
        // The worker keeps the strokes when it cannot draw them; the readout
        // says "none" for the backend, and this says why, where a developer
        // tools console will show it. Nothing else in the app hears it.
        console.error(`ink: the renderer failed — ${event.message}`);
        break;
      default:
        break;
    }
  }, []);

  const pen = usePenCapture({
    element: () => canvasRef.current,
    project,
    bounds: () => {
      const box = canvasRef.current?.getBoundingClientRect();
      return box
        ? { left: box.left, top: box.top, width: box.width, height: box.height }
        : undefined;
    },
    pageIndex,
    // The eraser and the lasso do not draw, so the pen's tool is the pen's: a
    // highlighter is the only other thing that puts ink down.
    tool: tool === "highlighter" ? "highlighter" : "pen",
    width: nib,
    colour,
    handedness: hand,
    // The Delegated Ink Trail (§6.2.6): the hook asks for the presenter and
    // tells the worker which path it is on; this is only the style per sample.
    trail: {
      style: (liveWidth) =>
        trailStyle({
          colour,
          tool: tool === "highlighter" ? "highlighter" : "pen",
          width: liveWidth,
          pageWidthPx: canvasRef.current?.getBoundingClientRect().width ?? 0,
          palette,
        }),
    },
    // The pen's haptics follow the filtered sample, not the raw one: the same
    // pressure and speed the nib is drawn with, so the feel and the line agree.
    onLive: (sample) => hapticsRef.current?.update(sample),
    onStrokeEnd: () => {
      // One state change per stroke, which is the contract the hook's doc comment
      // makes: the live stroke never entered React, so there is nothing to batch.
      setStrokes((count) => count + 1);
      scheduleSave();
    },
    onEvent,
  });

  const { send } = pen;

  /*
   * The pen's haptics (ink-native-bridges.md §4), where the platform has them.
   * Asked for once per mount; until the answer comes, and everywhere it is
   * `null`, the ref is empty and every call above is skipped.
   */
  const hapticsRef = useRef<PenHaptics | null>(null);
  useEffect(() => {
    let cancelled = false;
    void deps.haptics?.().then((haptics) => {
      if (!cancelled) hapticsRef.current = haptics;
    });
    return () => {
      cancelled = true;
      hapticsRef.current?.stop();
      hapticsRef.current = null;
    };
  }, [deps]);

  /** The waveform is the tool's: graphite, felt, rubber. */
  useEffect(() => {
    hapticsRef.current?.setTool(
      tool === "highlighter"
        ? "highlighter"
        : tool === "eraser"
          ? "eraser"
          : "pen",
    );
  }, [tool]);

  /** The pen up, and the actuator off in the same handler — nothing waits a frame. */
  const penHandlers = useMemo(
    () => ({
      ...pen.handlers,
      onPointerUp: (event: React.PointerEvent<HTMLCanvasElement>) => {
        hapticsRef.current?.stop();
        pen.handlers.onPointerUp(event);
      },
      onPointerCancel: (event: React.PointerEvent<HTMLCanvasElement>) => {
        hapticsRef.current?.stop();
        pen.handlers.onPointerCancel(event);
      },
    }),
    [pen.handlers],
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

  /** A request the worker answers by id: model, chunk, or PNG. */
  const requestModel = useCallback(() => {
    return new Promise<InkPageModel>((resolve) => {
      const requestId = ++requestSeq.current;
      pendingModel.current.set(requestId, resolve);
      send({ type: "page-model", requestId });
    });
  }, [send]);
  const requestSave = useCallback(() => {
    return new Promise<Uint8Array | null>((resolve) => {
      const requestId = ++requestSeq.current;
      pendingSave.current.set(requestId, resolve);
      send({ type: "save-page", requestId });
    });
  }, [send]);
  const requestExport = useCallback(() => {
    return new Promise<Blob | null>((resolve) => {
      const requestId = ++requestSeq.current;
      pendingExport.current.set(requestId, resolve);
      send({ type: "export-page", requestId, scale: 2 });
    });
  }, [send]);

  /** The body as the header and text layer now stand. */
  const saveBody = useCallback(async () => {
    const pages = pagesRef.current;
    if (!pages || !onSave) return;
    const meta: InkNoteMeta = {
      ...metaRef.current,
      pages: pages.length,
      pageOrder: pages.map((entry) => entry.chunkId),
    };
    metaRef.current = meta;
    await onSave(
      writeInkNoteBody(meta, joinInkTextLayer(textPagesRef.current)),
    );
  }, [onSave]);

  /** Write the current page's chunk, then the body. */
  const persist = useCallback(async () => {
    const pages = pagesRef.current;
    const current = pages?.[pageIndex];
    if (!pages || !current) return;
    const bytes = await requestSave();
    if (bytes) {
      await deps.chunks.write(noteId, current.chunkId, bytes);
      current.chunk = bytes;
    }
    await saveBody();
  }, [deps.chunks, noteId, pageIndex, requestSave, saveBody]);
  persistRef.current = persist;

  /** Flush a pending save before the page changes or the host goes away. */
  const flushSave = useCallback(() => {
    if (!saveTimer.current) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = null;
    void persistRef.current();
  }, []);
  useEffect(() => flushSave, [flushSave]);

  /** Load the sidecar once; a note with nothing written gets one blank page. */
  useEffect(() => {
    let live = true;
    void loadInkPages(deps.chunks, noteId, metaRef.current).then((pages) => {
      if (!live) return;
      pagesRef.current = pages;
      setPageCount(pages.length);
      setPageIndex((index) => Math.min(index, pages.length - 1));
    });
    return () => {
      live = false;
    };
  }, [deps.chunks, noteId]);

  /**
   * The page's background (§4.8): the attachment its text layer names on its
   * first line, fetched and decoded here, handed to the worker as a bitmap.
   * The worker draws it under the strokes on screen and in an export. A page
   * without one clears the last page's.
   */
  useEffect(() => {
    if (pageCount === 0) return;
    const path = inkPageBackground(textPagesRef.current[pageIndex] ?? "");
    send({ type: "set-background", image: null });
    if (!path) return;
    let live = true;
    void deps.assets
      .fetchBlob(path)
      .then((blob) => createImageBitmap(blob))
      .then((image) => {
        if (!live) {
          image.close();
          return;
        }
        send({ type: "set-background", image }, [image]);
      })
      .catch(() => {
        // A missing attachment is a page without its background, not a broken note.
      });
    return () => {
      live = false;
    };
    // `pageCount` is in the list so the effect runs once the sidecar has answered.
  }, [deps.assets, pageCount, pageIndex, send]);

  /**
   * Tell the worker which page we are on, hand it the bytes, and read its line
   * table back so the text column shows what an earlier run left.
   */
  useEffect(() => {
    const current = pagesRef.current?.[pageIndex];
    if (!current) return;
    send({ type: "load-page", pageIndex, chunk: current.chunk });
    setStrokes(0);
    setSelection([]);
    setRecognised(null);
    let live = true;
    void requestModel().then((model) => {
      if (!live) return;
      setRecognised(
        model.lines.length > 0
          ? recognisedPageFromModel(model, metaRef.current.engine)
          : null,
      );
    });
    return () => {
      live = false;
    };
  }, [pageCount, pageIndex, requestModel, send]);

  /**
   * The ink palette follows the theme. The swatches in the bar are painted with
   * the same CSS tokens, so what the bar shows is what the page draws — in
   * light, dark, and any theme the app grows. Read on mount and again whenever
   * the root's attributes change (that is how a theme is switched) or the OS
   * scheme flips; posted only when a value actually moved.
   */
  useEffect(() => {
    let last: InkPalette | null = null;
    const refresh = () => {
      const next = readThemePalette(document);
      if (last && samePalette(last, next)) return;
      last = next;
      setPalette(next);
      send({ type: "palette", colours: next });
    };
    refresh();
    const observer = new MutationObserver(refresh);
    observer.observe(document.documentElement, { attributes: true });
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", refresh);
    // A theme's stylesheet can land after the first paint.
    const late = window.setTimeout(refresh, 500);
    return () => {
      observer.disconnect();
      media.removeEventListener("change", refresh);
      window.clearTimeout(late);
    };
    // `pen.backend` so a renderer that came up later is handed the palette too.
  }, [pen.backend, send]);

  /** Keep the worker's viewport in step with the layout. */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const box = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    send({
      type: "viewport",
      transform: { scale, offsetX: 0, offsetY: 0, devicePixelRatio: dpr },
    });
    send({ type: "resize", width: box.width, height: box.height, dpr });
    // `pen.backend` is in the list so a renderer that came up after the first
    // layout gets the layout again.
  }, [pen.backend, scale, send]);

  /** Measure the pane, so the fit is the container's and not a guess. */
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const measure = () => setContainerWidth(element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  /*
   * The native shell (docs/internal/design/ink-native-bridges.md), when there
   * is one. It inks over the page itself and hands each finished stroke back;
   * everything below keeps it told where the page is and what the pen is.
   */
  const native = useMemo(() => nativeInkBridge(), []);

  /** The overlay inks only over the page: its box, kept current as it moves. */
  useEffect(() => {
    if (!native) return;
    const canvas = canvasRef.current;
    const scroller = scrollRef.current;
    if (!canvas || !scroller) return;
    const tell = () => {
      const box = canvas.getBoundingClientRect();
      native.setViewport({
        left: box.left,
        top: box.top,
        width: box.width,
        height: box.height,
      });
    };
    tell();
    const observer = new ResizeObserver(tell);
    observer.observe(canvas);
    scroller.addEventListener("scroll", tell, { passive: true });
    window.addEventListener("resize", tell);
    window.addEventListener("scroll", tell, { passive: true });
    return () => {
      observer.disconnect();
      scroller.removeEventListener("scroll", tell);
      window.removeEventListener("resize", tell);
      window.removeEventListener("scroll", tell);
      native.clearViewport();
    };
  }, [native, pageCount, scale]);

  /** The overlay's wet stroke looks like the ink it will become. */
  useEffect(() => {
    if (!native) return;
    const pageWidthPx = canvasRef.current?.getBoundingClientRect().width ?? 0;
    native.setTool({
      tool: tool === "highlighter" ? "highlighter" : "pen",
      colour,
      widthPx: trailStyle({
        colour,
        tool: tool === "highlighter" ? "highlighter" : "pen",
        width: nib,
        pageWidthPx,
        palette,
      }).diameter,
    });
  }, [native, tool, colour, nib, scale, palette]);

  useEffect(() => {
    native?.setPenOnly(pen.penOnly);
  }, [native, pen.penOnly]);

  useEffect(() => {
    native?.setHandedness(hand);
  }, [native, hand]);

  /**
   * A finished native stroke, through the same session the pointer events
   * use — the gate, the filter, the writer, the worker — so it is filtered,
   * indexed and saved exactly as a web stroke is. The overlay is cleared two
   * frames later, once the worker has had a frame to draw the committed one.
   */
  useEffect(() => {
    if (!native) return;
    return installNativeStrokeHandler((points) => {
      const events = nativeStrokeEvents(points, window.devicePixelRatio || 1);
      const session = pen.session;
      const first = events[0];
      if (!first) {
        native.clearOverlay();
        return;
      }
      const last = events.length > 1 ? events[events.length - 1]! : first;
      // Down, one raw update carrying the middle as its coalesced events, up.
      const middle = events.slice(1, -1);
      const dispatched = middle.pop();
      session.pointerDown(first);
      if (dispatched)
        session.pointerRawUpdate({
          ...dispatched,
          getCoalescedEvents: () => middle,
        });
      if (last !== first) session.pointerUp(last);
      else session.pointerUp({ ...first, t: first.t + 1 });
      requestAnimationFrame(() =>
        requestAnimationFrame(() => native.clearOverlay()),
      );
    });
  }, [native, pen.session]);

  /** A recognised page becomes the worker's page, the column's lines and the body's text. */
  const applyRecognised = useCallback(
    (result: RecognisedPage, replace: boolean) => {
      if (replace) send({ type: "replace-page", page: result.page });
      setRecognised(result);
      // Recognition replaces the page's text; the background line is the host's.
      textPagesRef.current[pageIndex] = withInkPageBackground(
        result.text,
        inkPageBackground(textPagesRef.current[pageIndex] ?? ""),
      );
      metaRef.current = {
        ...metaRef.current,
        recognised: result.confidence,
        engine: result.engine || metaRef.current.engine,
      };
      scheduleSave();
    },
    [pageIndex, scheduleSave, send],
  );

  /** Recognise this page: the engine, line by line, then the post-match (§5.4). */
  const recognise = useCallback(async () => {
    if (recognising) return;
    setRecognising(true);
    setProgress(null);
    try {
      const engine = await deps.recogniser();
      if (!engine) {
        setUnavailable(INK_NO_ENGINE_MESSAGE);
        return;
      }
      setUnavailable(null);
      const [model, hints] = await Promise.all([requestModel(), deps.hints()]);
      const result = await recognisePage({
        page: model,
        recogniser: engine,
        hints,
        onProgress: (done, total) => setProgress(`line ${done} of ${total}`),
      });
      applyRecognised(result, true);
    } catch (error) {
      setUnavailable(error instanceof Error ? error.message : String(error));
    } finally {
      setRecognising(false);
      setProgress(null);
    }
  }, [applyRecognised, deps, recognising, requestModel]);

  /** A correction from the column: certain from now on. */
  const onAccept = useCallback(
    (index: number, text: string) => {
      const current = recognisedRef.current;
      if (!current) return;
      applyRecognised(acceptLine(current, index, text), true);
    },
    [applyRecognised],
  );

  /**
   * Export the page as a PNG.
   *
   * The blob comes back from the worker's offscreen target, never from a readback
   * of the live canvas (§6.2.12), and lands as a download named for the note.
   */
  const onExport = useCallback(async () => {
    const png = await requestExport();
    if (!png) return;
    const url = URL.createObjectURL(png);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${noteId}-page-${pageIndex + 1}.png`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [noteId, pageIndex, requestExport]);

  const goToPage = useCallback(
    (index: number) => {
      flushSave();
      setPageIndex(Math.max(0, Math.min(index, pageCount - 1)));
    },
    [flushSave, pageCount],
  );

  /** A new blank page after the last, in the note's order. */
  const onAddPage = useCallback(() => {
    const pages = pagesRef.current;
    if (!pages) return;
    flushSave();
    pages.push({
      chunkId: newInkChunkId(),
      chunk: null,
      paper: metaRef.current.paper,
    });
    textPagesRef.current.push("");
    setPageCount(pages.length);
    setPageIndex(pages.length - 1);
    void saveBody();
  }, [flushSave, saveBody]);

  /**
   * A PDF's page as a new page (§4.8): rasterised with the reader's pdf.js,
   * uploaded to the vault as this note's attachment, named on the new page's
   * first text-layer line, mirrored in the chunk header as the attachment
   * index. The page takes the PDF page's aspect at A4 width.
   */
  const onInsertPdfPage = useCallback(
    async (file: File) => {
      const pages = pagesRef.current;
      if (!pages || inserting) return;
      setInserting(true);
      try {
        const bytes = await file.arrayBuffer();
        const count = await pdfPageCount(bytes);
        let number = 1;
        if (count > 1) {
          const answer = window.prompt(
            `Which page of ${file.name}? (1–${count})`,
            "1",
          );
          if (answer === null) return;
          number = Number.parseInt(answer, 10);
          if (!Number.isFinite(number) || number < 1 || number > count) return;
        }
        const raster = await rasterisePdfPage(bytes, number, 1654);
        const path = await deps.assets.upload(noteId, raster.blob, "png");
        const size = clampInkPageSize(
          INK_A4_WIDTH,
          Math.round((INK_A4_WIDTH * raster.height) / raster.width),
        );
        const text = withInkPageBackground("", path);
        const nextTextPages = [...textPagesRef.current, text];
        const body = writeInkNoteBody(
          metaRef.current,
          joinInkTextLayer(nextTextPages),
        );
        const chunkId = newInkChunkId();
        const chunk = await encodeInkChunk({
          ...blankInkPage(metaRef.current.paper),
          width: size.width,
          height: size.height,
          background: inkAttachmentIndex(body, path),
        });
        await deps.chunks.write(noteId, chunkId, chunk);
        flushSave();
        pages.push({ chunkId, chunk, paper: metaRef.current.paper });
        textPagesRef.current = nextTextPages;
        setPageCount(pages.length);
        setPageIndex(pages.length - 1);
        await saveBody();
      } catch (error) {
        setUnavailable(
          `The PDF page could not be inserted: ${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        setInserting(false);
      }
    },
    [deps.assets, deps.chunks, flushSave, inserting, noteId, saveBody],
  );

  const onLasso = useCallback(
    (path: readonly number[]) => {
      send({ type: "lasso", polygon: [...path] });
    },
    [send],
  );

  /** The selection moved by `dx, dy`: the worker translates it, the box follows. */
  const onMoveSelection = useCallback(
    (dx: number, dy: number) => {
      send({ type: "move-selection", dx, dy });
      setSelectionBounds((b) =>
        b ? [b[0] + dx, b[1] + dy, b[2] + dx, b[3] + dy] : b,
      );
      scheduleSave();
    },
    [scheduleSave, send],
  );
  const onDeleteSelection = useCallback(() => {
    send({ type: "delete-selection" });
    setSelection([]);
    scheduleSave();
  }, [scheduleSave, send]);
  const onCopyAsText = useCallback(async () => {
    const model = await requestModel();
    const text = selectedText(model, selection);
    if (text && typeof navigator !== "undefined" && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
    }
  }, [requestModel, selection]);

  /** The keyboard, per §6.5: tools, undo, recognise, export, the selection. */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;
      if (event.metaKey || event.ctrlKey) {
        const key = event.key.toLowerCase();
        if (key === "z") {
          event.preventDefault();
          send({ type: event.shiftKey ? "redo" : "undo" });
          scheduleSave();
        } else if (event.shiftKey && key === "r") {
          event.preventDefault();
          void recognise();
        } else if (event.shiftKey && key === "e") {
          event.preventDefault();
          void onExport();
        }
        return;
      }
      switch (event.key.toLowerCase()) {
        case "p":
          setTool("pen");
          break;
        case "h":
          setTool("highlighter");
          break;
        case "e":
          setTool("eraser");
          break;
        case "l":
          setTool("lasso");
          break;
        case "s":
          setTool("shape");
          break;
        case "delete":
        case "backspace":
          if (selection.length > 0) {
            event.preventDefault();
            onDeleteSelection();
          }
          break;
        case "escape":
          if (selection.length > 0) {
            send({ type: "select-clear" });
            setSelection([]);
          }
          break;
        case "1":
        case "2":
        case "3":
        case "4":
        case "5":
        case "6": {
          const palette: InkColour[] = [
            "text",
            "accent",
            "warn",
            "good",
            "info",
            "danger",
          ];
          const chosen = palette[Number(event.key) - 1];
          if (chosen) onColourChange(chosen);
          break;
        }
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    onColourChange,
    onDeleteSelection,
    onExport,
    recognise,
    scheduleSave,
    selection.length,
    send,
  ]);

  /** Zoom without plumbing a gesture: ⌘/Ctrl and the wheel, or the buttons. */
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      setZoom((value) =>
        Math.min(4, Math.max(0.5, value * (event.deltaY < 0 ? 1.1 : 0.9))),
      );
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, []);

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

  const lines: readonly RecognisedLine[] = recognised?.lines ?? [];
  const confidence = recognised?.confidence ?? 0;

  return (
    <div className={`ink-wrap${showTextLayer ? "" : " ink-text-hidden"}`}>
      <input
        ref={pdfInputRef}
        type="file"
        accept="application/pdf,.pdf"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void onInsertPdfPage(file);
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
        onRecognise={() => void recognise()}
        onExport={() => void onExport()}
        onUndo={onUndo}
        onRedo={onRedo}
        onAddPage={onAddPage}
        onInsertPdfPage={() => pdfInputRef.current?.click()}
        onPrevPage={() => goToPage(pageIndex - 1)}
        onNextPage={() => goToPage(pageIndex + 1)}
        onDeleteSelection={onDeleteSelection}
        onCopyAsText={() => void onCopyAsText()}
      />
      <div className="ink-page-scroll" ref={scrollRef}>
        <InkPage
          pageIndex={pageIndex}
          pageSize={pageSize}
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
          penOnly={pen.penOnly}
          penSeen={pen.penSeen}
          onPan={onPan}
          onPinch={onPinch}
        />
      </div>
      <InkTextLayer
        lines={lines}
        confidence={confidence}
        progress={progress}
        unavailable={unavailable}
        onAccept={onAccept}
      />
    </div>
  );
}

/** The stroke header a tool produces, so the host and the bar agree. */
export function headerForTool(
  tool: InkBarTool | "shape",
  width: number,
  colour: InkColour,
  pageIndex: number,
  strokeId: number,
): InkStrokeHeader {
  return {
    strokeId,
    pageIndex,
    width: nibForTool(tool, width),
    tool:
      tool === "highlighter"
        ? "highlighter"
        : tool === "shape"
          ? "shape"
          : "pen",
    colour,
  };
}

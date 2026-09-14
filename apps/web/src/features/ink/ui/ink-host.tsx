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
import { ConfirmDialog } from "@/components/confirm-dialog";
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
import { backingRatio } from "../render/ink-renderer";
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
import { availableInkChunkCodec } from "../application/ink-chunk-codec";
import { pdfPageCount } from "../application/pdf-page-raster";
import { pageListProblem, selectedPdfPages } from "../application/pdf-pages";
import {
  imageFileFromClipboard,
  isPageSource,
  isPdf,
  pageBackgroundFromFile,
  pageChunkWithBackground,
} from "../application/page-background";
import {
  acceptLine,
  recognisePage,
  recognisedPageFromModel,
  type RecognisedPage,
} from "../application/recognise-page";
import { InkBar, nibForTool, type InkBarTool } from "./ink-bar";
import { InkGhostPage } from "./ink-ghost-page";
import { InkPage } from "./ink-page";
import { InkTextLayer } from "./ink-text-layer";
import { PNG_EXPORT_SCALE, usePageExport } from "./use-page-export";

/**
 * Pixels per 0.1 mm unit in an exported or printed page, re-exported because
 * this module was where callers have always found it; the export pipeline that
 * spends it lives in `./use-page-export`.
 */
export { PNG_EXPORT_SCALE };

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
  /** The scroller's visible box: the canvas is never larger than this. */
  const [view, setView] = useState({ width: 0, height: 0 });
  const sheetRef = useRef<HTMLDivElement>(null);
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
  /**
   * What the second file input is for: an image for a page (§4.8) — the one
   * being looked at, or a page of its own when the one being looked at already
   * has an image and the user asked to keep it.
   */
  const imageInputRef = useRef<HTMLInputElement>(null);
  /** The answer that picker is waiting for: this page, or one of its own. */
  const imageTargetRef = useRef<"current" | "new">("current");
  /**
   * A question the host is asking, and the code waiting on the answer.
   *
   * Both questions are mid-flow — a multi-page PDF has to say which pages
   * before it can be rasterised — so they are held as a promise the asking
   * code awaits, which keeps the flow linear instead of splitting each one
   * across a state machine. `null` means the question was dismissed and the
   * flow stops.
   */
  const [pageAsk, setPageAsk] = useState<{
    count: number;
    resolve: (pages: number[] | null) => void;
  } | null>(null);
  /** Whether the "this page already has an image" question is open. */
  const [replaceAsk, setReplaceAsk] = useState(false);
  /**
   * The pane, focused on a pointer-down. A `paste` goes to the focused element
   * and a canvas is not one, so the wrap takes focus itself — which is also
   * what keeps a screenshot pasted into the note editor out of here.
   */
  const wrapRef = useRef<HTMLDivElement>(null);
  /** The current page's background attachment, for the bar's two buttons. */
  const [backgroundPath, setBackgroundPath] = useState<string | null>(null);
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

  /**
   * The rail's ghost images: one blob URL per non-live page that has a
   * background, fetched once and kept until the note closes. A ghost is only
   * looked at, so a failure costs a blank ghost rather than a broken flow —
   * the page's image is still on its chunk when the page is reached.
   */
  const [ghostImages, setGhostImages] = useState<ReadonlyMap<number, string>>(
    new Map(),
  );
  // The blobs outlive every render: one cleanup for the note's lifetime, not
  // per page, because a ghost map entry's URL is never re-created.
  const ghostImagesRef = useRef(ghostImages);
  ghostImagesRef.current = ghostImages;
  useEffect(
    () => () => {
      for (const url of ghostImagesRef.current.values()) URL.revokeObjectURL(url);
    },
    [],
  );
  useEffect(() => {
    let live = true;
    const missing: [number, string][] = [];
    for (let index = 0; index < pageCount; index += 1) {
      if (index === pageIndex) continue;
      if (ghostImages.has(index)) continue;
      const path = inkPageBackground(textPagesRef.current[index] ?? "");
      if (path) missing.push([index, path]);
    }
    if (missing.length === 0) return;
    void Promise.all(
      missing.map(async ([index, path]) => {
        try {
          const blob = await deps.assets.fetchBlob(path);
          return [index, URL.createObjectURL(blob)] as const;
        } catch {
          return null;
        }
      }),
    ).then((entries) => {
      if (!live) return;
      const next = new Map(ghostImages);
      for (const entry of entries) if (entry) next.set(entry[0], entry[1]);
      setGhostImages(next);
    });
    return () => {
      live = false;
    };
    // The pages and the active index are what it depends on: the text layer's
    // own length is `pageCount`, and its per-page paths are stable once a
    // page has its image.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deps.assets, pageCount, pageIndex]);

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
          pageWidthPx: sheetRef.current?.getBoundingClientRect().width ?? 0,
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
  const requestExport = useCallback(
    (scale: number = PNG_EXPORT_SCALE) => {
      return new Promise<Blob | null>((resolve) => {
        const requestId = ++requestSeq.current;
        pendingExport.current.set(requestId, resolve);
        send({ type: "export-page", requestId, scale });
      });
    },
    [send],
  );

  /**
   * The header and the body as they now stand.
   *
   * One function rather than two because the body is read for two things that
   * must agree: what gets saved, and the attachment index a page's chunk
   * carries (§4.8) — the index counts the `vault:` refs in this body, so a
   * body built anywhere else would count a different one.
   */
  const noteBody = useCallback((): { meta: InkNoteMeta; body: string } => {
    const pages = pagesRef.current ?? [];
    const meta: InkNoteMeta = {
      ...metaRef.current,
      pages: pages.length,
      pageOrder: pages.map((entry) => entry.chunkId),
    };
    return {
      meta,
      body: writeInkNoteBody(meta, joinInkTextLayer(textPagesRef.current)),
    };
  }, []);

  /** The body as the header and text layer now stand. */
  const saveBody = useCallback(async () => {
    if (!pagesRef.current || !onSave) return;
    const { meta, body: next } = noteBody();
    metaRef.current = meta;
    await onSave(next);
  }, [noteBody, onSave]);

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
   * The worker draws it under the strokes on screen and in an export, and is
   * told the attachment's index too, so the page it saves keeps the mirror the
   * chunk header carries. A page without one clears the last page's.
   */
  useEffect(() => {
    if (pageCount === 0) return;
    const path = inkPageBackground(textPagesRef.current[pageIndex] ?? "");
    const index = inkAttachmentIndex(noteBody().body, path);
    setBackgroundPath(path);
    send({ type: "set-background", image: null, index });
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
        send({ type: "set-background", image, index }, [image]);
      })
      .catch(() => {
        // A missing attachment is a page without its background, not a broken note.
      });
    return () => {
      live = false;
    };
    // `pageCount` is in the list so the effect runs once the sidecar has answered.
  }, [deps.assets, noteBody, pageCount, pageIndex, send]);

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

  /**
   * Keep the worker's viewport in step with the layout. The canvas is a
   * window onto the sheet, so the camera's offset is where the sheet's corner
   * sits relative to the canvas — it moves with every scroll, and a scroll
   * costs one message, not a page-sized re-raster.
   */
  useEffect(() => {
    const canvas = canvasRef.current;
    const sheet = sheetRef.current;
    const scroller = scrollRef.current;
    if (!canvas || !sheet || !scroller) return;
    const box = canvas.getBoundingClientRect();
    // The backing store is capped, so a deep zoom softens rather than vanishes.
    const dpr = backingRatio(
      box.width,
      box.height,
      window.devicePixelRatio || 1,
    );
    const camera = () => {
      const canvasBox = canvas.getBoundingClientRect();
      const sheetBox = sheet.getBoundingClientRect();
      send({
        type: "viewport",
        transform: {
          scale,
          offsetX: sheetBox.left - canvasBox.left,
          offsetY: sheetBox.top - canvasBox.top,
          devicePixelRatio: dpr,
        },
      });
    };
    send({ type: "resize", width: box.width, height: box.height, dpr });
    camera();
    scroller.addEventListener("scroll", camera, { passive: true });
    return () => scroller.removeEventListener("scroll", camera);
    // `pen.backend` is in the list so a renderer that came up after the first
    // layout gets the layout again; `view` and `pageSize` because the canvas
    // was just resized to them.
  }, [pen.backend, scale, send, view, pageSize, pageIndex]);

  /**
   * The rail's scroll watcher: scrolling past the live page's own slot
   * reaches for the next or the previous page, which is what makes the note
   * one continuous scroll rather than a page that must be stepped.
   *
   * The trigger is the live sheet's *centre*, not its edge: half a page of
   * travel, so a stroke that starts near the bottom of one page and continues
   * onto the ghost below stays on this page until the pen is genuinely past
   * the middle of the next. And a mid-flight stroke is never interrupted: the
   * worker is drawing it, and a page change would commit half a word.
   */
  const flipAnchor = useRef<{ centerY: number } | null>(null);
  const flipping = useRef(false);
  useEffect(() => {
    const scroller = scrollRef.current;
    const sheet = sheetRef.current;
    if (!scroller || !sheet || pageCount < 2) return;
    const onScroll = () => {
      if (flipping.current) return;
      if (pen.session.active) return;
      const scrollerBox = scroller.getBoundingClientRect();
      const sheetBox = sheet.getBoundingClientRect();
      // Where the sheet's middle sits in the pane, 0 at the pane's own top.
      const relative = (sheetBox.top + sheetBox.bottom) / 2 - scrollerBox.top;
      const towards = Math.sign(scrollerBox.height / 2 - relative);
      // Half the pane's height of travel before the page flips, and only
      // when there is a page to flip to.
      if (Math.abs(scrollerBox.height / 2 - relative) < scrollerBox.height / 2) return;
      const next = pageIndex + (towards > 0 ? 1 : -1);
      if (next < 0 || next >= pageCount) return;
      // The anchor keeps the live page where the scroll left it: the slot it
      // moves into is the one being looked at, and its own height may differ.
      flipAnchor.current = { centerY: relative };
      flipping.current = true;
      flushSave();
      setPageIndex(next);
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", onScroll);
  }, [flushSave, pageCount, pageIndex, pen.session]);

  /**
   * After a scroll-triggered flip, put the newly-live sheet back where the
   * scroll was: its slot is the one being looked at, so the sheet's middle
   * returns to the same band of the pane and the scroll does not jump to the
   * top of the new page the way a stepped page change does.
   */
  useEffect(() => {
    if (!flipping.current) return;
    const anchor = flipAnchor.current;
    const scroller = scrollRef.current;
    const sheet = sheetRef.current;
    flipping.current = false;
    flipAnchor.current = null;
    if (!anchor || !scroller || !sheet) return;
    const scrollerBox = scroller.getBoundingClientRect();
    const sheetBox = sheet.getBoundingClientRect();
    const relative = (sheetBox.top + sheetBox.bottom) / 2 - scrollerBox.top;
    scroller.scrollTop += relative - anchor.centerY;
  }, [pageIndex]);

  /** Measure the pane, so the fit is the container's and not a guess. */
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const measure = () => {
      setContainerWidth(element.clientWidth);
      setView((was) =>
        was.width === element.clientWidth && was.height === element.clientHeight
          ? was
          : { width: element.clientWidth, height: element.clientHeight },
      );
    };
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
    const pageWidthPx = sheetRef.current?.getBoundingClientRect().width ?? 0;
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
    palette,
    fetchBlob: deps.assets.fetchBlob,
  });

  const goToPage = useCallback(
    (index: number) => {
      flushSave();
      setPageIndex(Math.max(0, Math.min(index, pageCount - 1)));
    },
    [flushSave, pageCount],
  );

  /**
   * A new blank page after the last, in the note's order, and the index it
   * landed at.
   *
   * The index is returned rather than read back from `pageIndex` because
   * `setPageIndex` has not been applied when the caller continues: a caller
   * that means to fill the new page has to name it.
   */
  const appendPage = useCallback((): number => {
    const pages = pagesRef.current;
    if (!pages) return Math.max(0, pageCount - 1);
    flushSave();
    pages.push({
      chunkId: newInkChunkId(),
      chunk: null,
      paper: metaRef.current.paper,
    });
    textPagesRef.current.push("");
    setPageCount(pages.length);
    setPageIndex(pages.length - 1);
    return pages.length - 1;
  }, [flushSave, pageCount]);

  /** A new blank page after the last, in the note's order. */
  const onAddPage = useCallback(() => {
    appendPage();
    void saveBody();
  }, [appendPage, saveBody]);

  /**
   * Write a page's chunk with its background index, strokes and lines kept
   * (§4.8).
   *
   * The text layer says which attachment a page shows; the chunk header
   * mirrors it for a reader that has only the sidecar. This is that second
   * half, done here rather than through a save because a save is about the
   * page the worker holds, while the page whose image changed may be any page
   * of the note — including one with no strokes and so no chunk of its own.
   */
  const writePageBackgroundChunk = useCallback(
    async (targetIndex: number, background: number) => {
      const pages = pagesRef.current;
      const target = pages?.[targetIndex];
      if (!pages || !target) return;
      const bytes = await pageChunkWithBackground(target.chunk, {
        background,
        paper: target.paper,
        // A page with no chunk yet is a blank one on this sheet; the sheet in
        // front of the user is the honest answer for the page in front of them.
        size:
          targetIndex === pageIndexRef.current
            ? { width: pageSize.width, height: pageSize.height }
            : undefined,
        codec: availableInkChunkCodec(),
      });
      await deps.chunks.write(noteId, target.chunkId, bytes);
      target.chunk = bytes;
    },
    [deps.chunks, noteId, pageSize.height, pageSize.width],
  );

  /**
   * Which pages of a multi-page PDF to use, as a promise.
   *
   * The app's own dialog, not `window.prompt`: the system one ignores the theme
   * and covers the page it is asking about on a phone. The answer is a list —
   * "all", or "1,3-5" — so a whole paper can come over as its own pages in
   * one ask; `null` is the dismissal, which every caller treats as "do
   * nothing".
   */
  const askPdfPages = useCallback(
    (count: number) =>
      new Promise<number[] | null>((resolve) => setPageAsk({ count, resolve })),
    [],
  );
  /** The answer to the picker's question, and the code waiting on it. */
  const answerPdfPages = useCallback(
    (pages: number[] | null) => {
      const ask = pageAsk;
      setPageAsk(null);
      ask?.resolve(pages);
    },
    [pageAsk],
  );

  /**
   * Put an image on a page (§4.8): the page in front of the user unless one is
   * named.
   *
   * The file is laid on the A4 sheet, uploaded as this note's attachment, named
   * on that page's first text-layer line, and its index written into the page's
   * chunk header — so the vault's image bookkeeping and a reader holding only
   * the sidecar both see it. An image on a page that already has one replaces
   * it, which is why the bar asks before calling this.
   */
  const onSetPageBackground = useCallback(
    async (file: File, targetPageIndex?: number) => {
      const pages = pagesRef.current;
      if (!pages || inserting) return;
      if (!isPageSource(file)) {
        setUnavailable(`${file.name} is not a PDF or an image.`);
        return;
      }
      const target = Math.max(
        0,
        Math.min(targetPageIndex ?? pageIndexRef.current, pages.length - 1),
      );
      setInserting(true);
      try {
        let number = 1;
        if (isPdf(file)) {
          const count = await pdfPageCount(await file.arrayBuffer());
          if (count > 1) {
            const answer = await askPdfPages(count);
            // A page image is one page: the first of what was asked, because a
            // caller that answered a list here was reaching for "insert pages",
            // not "add an image" — and a dismissal stops the flow.
            if (answer === null || answer.length === 0) return;
            number = answer[0]!;
          }
        }
        const png = await pageBackgroundFromFile(file, number);
        const path = await deps.assets.upload(noteId, png, "png");
        // The text layer first: the body is what the attachment index counts.
        textPagesRef.current = textPagesRef.current.map((text, index) =>
          index === target ? withInkPageBackground(text, path) : text,
        );
        const background = inkAttachmentIndex(noteBody().body, path);
        await writePageBackgroundChunk(target, background);
        // The page the work was for is still the one on screen, whichever page
        // the user was on when the click started: a page made for a new image
        // is being looked at by now and has to be told, because nothing else
        // will — the page-change effect read this page's text layer before this
        // write got to it, so it saw a page with no image on it.
        if (target === pageIndexRef.current) {
          // The worker draws it now, and is told the index so the next save —
          // the first stroke over the image — writes the same mirror back.
          const image = await createImageBitmap(png);
          send({ type: "set-background", image, index: background }, [image]);
          setBackgroundPath(path);
        }
        scheduleSave();
      } catch (error) {
        setUnavailable(
          `The image could not be added: ${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        setInserting(false);
      }
    },
    [
      askPdfPages,
      deps.assets,
      inserting,
      noteBody,
      noteId,
      scheduleSave,
      send,
      writePageBackgroundChunk,
    ],
  );

  /** Take a page's image off, in the text layer and in the chunk (§4.8). */
  const onRemovePageBackground = useCallback(
    async (targetPageIndex?: number) => {
      const pages = pagesRef.current;
      if (!pages) return;
      const target = Math.max(
        0,
        Math.min(targetPageIndex ?? pageIndexRef.current, pages.length - 1),
      );
      if (!inkPageBackground(textPagesRef.current[target] ?? "")) return;
      textPagesRef.current = textPagesRef.current.map((text, index) =>
        index === target ? withInkPageBackground(text, null) : text,
      );
      await writePageBackgroundChunk(target, 0);
      // Only if the reader is still on that page: the chunk write above is an
      // await, so the page losing its image may be behind them by now.
      if (target === pageIndexRef.current) {
        send({ type: "set-background", image: null, index: 0 });
        setBackgroundPath(null);
      }
      scheduleSave();
    },
    [scheduleSave, send, writePageBackgroundChunk],
  );

  /**
   * The bar's image button: pick a file, for this page or for a new one.
   *
   * A page has one background (§4.8), so a page that already has one asks
   * first: replacing is what the button is for, and a page of its own is the
   * answer that loses nothing. The answer is read in the input's handler, which
   * is the only place it has to survive.
   */
  const onAddImageToCurrentPage = useCallback(() => {
    if (backgroundPath) {
      setReplaceAsk(true);
      return;
    }
    imageTargetRef.current = "current";
    imageInputRef.current?.click();
  }, [backgroundPath]);

  /** The answer to that question: replace this page's image, or make a page. */
  const answerReplace = useCallback((replace: boolean) => {
    setReplaceAsk(false);
    imageTargetRef.current = replace ? "current" : "new";
    imageInputRef.current?.click();
  }, []);

  /** The file the image picker produced, on the page the button chose. */
  const onImageFile = useCallback(
    (file: File) => {
      if (imageTargetRef.current === "new") {
        // The page is made first, so the note's order and the text layer grow
        // together and the image lands on the page it made.
        void onSetPageBackground(file, appendPage());
        return;
      }
      void onSetPageBackground(file);
    },
    [appendPage, onSetPageBackground],
  );

  /**
   * A PDF's pages or an image as new pages (§4.8): each one laid on an A4
   * sheet (a PDF page rasterised with the reader's pdf.js), uploaded to the
   * vault as this note's attachment, named on that page's first text-layer
   * line, mirrored in its chunk header as the attachment index. Every page
   * becomes a page of its own, in the order the pages were asked for — "all",
   * or a list like "1,3-5" — so a whole paper comes over in one ask. Each
   * page is A4 whatever the source's shape, so the note prints as drawn.
   */
  const onInsertPage = useCallback(
    async (file: File) => {
      const pages = pagesRef.current;
      if (!pages || inserting) return;
      if (!isPageSource(file)) {
        setUnavailable(`${file.name} is not a PDF or an image.`);
        return;
      }
      setInserting(true);
      try {
        let numbers = [1];
        if (isPdf(file)) {
          const count = await pdfPageCount(await file.arrayBuffer());
          if (count > 1) {
            const answer = await askPdfPages(count);
            if (answer === null || answer.length === 0) return;
            numbers = answer;
          }
        }
        // One page per import: rasterised, uploaded, its own chunk and its own
        // first text-layer line. The attachment index counts the body, so the
        // text layer grows before each index is read — which is what makes a
        // later page's index different from an earlier one's.
        const size = clampInkPageSize(INK_A4_WIDTH, INK_A4_HEIGHT);
        for (const number of numbers) {
          const png = await pageBackgroundFromFile(file, number);
          const path = await deps.assets.upload(noteId, png, "png");
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
        }
      } catch (error) {
        setUnavailable(
          `The page could not be inserted: ${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        setInserting(false);
      }
    },
    [askPdfPages, deps.assets, deps.chunks, flushSave, inserting, noteId, saveBody],
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
      if (dx === 0 && dy === 0) return;
      setSelectionBounds((b) =>
        b ? [b[0] + dx, b[1] + dy, b[2] + dx, b[3] + dy] : b,
      );
      scheduleSave();
    },
    [scheduleSave, send],
  );
  /** The selection is being dragged: the worker shows it shifted, nothing moves yet. */
  const onDragSelection = useCallback(
    (dx: number, dy: number) => send({ type: "drag-selection", dx, dy }),
    [send],
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

  /**
   * The keyboard, per §6.5: tools, undo, recognise, print and export, the
   * selection. A bare `p` is still the pen — only the shifted form prints.
   */
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
        } else if (event.shiftKey && key === "p") {
          event.preventDefault();
          void onPrint();
        } else if (event.shiftKey && key === "e") {
          event.preventDefault();
          void onExportPng();
        } else if (event.shiftKey && key === "g") {
          event.preventDefault();
          void onExportSvg();
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
    onExportPng,
    onExportSvg,
    onPrint,
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

  /**
   * A pasted screenshot (§4.8).
   *
   * The listener is on the window because a `paste` goes to the focused element
   * and a canvas does not take focus; the wrap is what takes it, on a
   * pointer-down, which is also what keeps a paste aimed at the note editor
   * away from here — text pasted there carries no image item, and the active
   * element is not inside this pane. A field inside this pane — a correction in
   * the text column — is the user pasting *text*, and keeps its own paste.
   */
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
      )
        return;
      const wrap = wrapRef.current;
      if (!wrap || !wrap.contains(document.activeElement)) return;
      const file = imageFileFromClipboard(event.clipboardData);
      if (!file) return;
      event.preventDefault();
      void onSetPageBackground(file);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [onSetPageBackground]);

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
      <div className="ink-page-scroll" ref={scrollRef}>
        {/*
          The rail: every page of the note in one column, so the note is one
          scroll rather than a step. Only the page being written on is live —
          its canvas and its worker — and the ghosts above and below it are
          inert boxes of the page's own size, paper and background image, so
          the scroll lands where the next page will be. Reaching a ghost is
          what flips the note to it (the scroll watcher above).
        */}
        {Array.from({ length: pageIndex }, (_, index) => (
          <InkGhostPage
            key={`ghost-${index}`}
            index={index}
            pageSize={pageSize}
            scale={scale}
            paper={pagesRef.current?.[index]?.paper ?? page.paper}
            backgroundUrl={ghostImages.get(index) ?? null}
          />
        ))}
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
          // A file dropped on the sheet is an image for the page under it, not
          // a new page: the sheet is the page the user is pointing at.
          onDropFile={(file) => void onSetPageBackground(file)}
        />
        {Array.from({ length: Math.max(0, pageCount - pageIndex - 1) }, (_, i) => {
          const index = pageIndex + 1 + i;
          return (
            <InkGhostPage
              key={`ghost-${index}`}
              index={index}
              pageSize={pageSize}
              scale={scale}
              paper={pagesRef.current?.[index]?.paper ?? page.paper}
              backgroundUrl={ghostImages.get(index) ?? null}
            />
          );
        })}
      </div>
      <InkTextLayer
        lines={lines}
        confidence={confidence}
        progress={progress}
        unavailable={unavailable}
        onAccept={onAccept}
      />
      {/* Both ask about a file that is already chosen, so they are portaled
          dialogs rather than browser ones: themed, and above the pane either
          way. Escape and the backdrop take the answer that changes nothing. */}
      {replaceAsk ? (
        <ConfirmDialog
          title="This page already has an image"
          body="Replacing keeps the old file in the vault but stops showing it here."
          confirmLabel="Replace it"
          cancelLabel="Add to a new page"
          onConfirm={() => answerReplace(true)}
          onClose={() => answerReplace(false)}
        />
      ) : null}
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

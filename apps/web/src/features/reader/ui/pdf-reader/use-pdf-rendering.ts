"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  DocumentPageText,
  ReaderContainerSize,
  ReaderPageSize,
} from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { savePdfText } from "@/features/search/infrastructure/pdf-text-store";
import {
  sanitizePdfUrl,
  originalUrlFromProxy,
  isAllowedPdfProxyUrl,
  isReaderObjectUrl,
} from "../../application/sanitize-reader-url";
import { useReaderViewport, type ReaderViewportApi } from "../use-reader-viewport";
import type { ReaderOutlineItem } from "../reader-outline";
import type { JumpState, PdfDocument, PdfLib, PdfReaderProps, RenderTask } from "./types";
import {
  buildPageText,
  loadPdfLib,
  mapOutline,
  textItemsFromContent,
} from "./pdf-document";
import type { PageTextGeometry } from "@weaveforge/core";

export interface PdfRenderingDeps {
  url: string;
  originalUrl: PdfReaderProps["originalUrl"];
  /** Present when the reader was opened at a cited passage. */
  locus: PdfReaderProps["locus"];
  paperId: string | undefined;
  paperTitle: string;
  contentHash: string;
  /** 1-based page the reader was opened at, if any. */
  initialPage: number;
  onSourceFailure: PdfReaderProps["onSourceFailure"];
  setJump: (state: JumpState) => void;
}

export interface PdfRendering {
  /** Scroll host; pages are queried out of it by their `data-page`. */
  containerRef: React.RefObject<HTMLDivElement>;
  pdf: PdfDocument | null;
  numPages: number;
  pageSize: ReaderPageSize | null;
  containerSize: ReaderContainerSize | null;
  pageTexts: DocumentPageText[];
  outline: ReaderOutlineItem[];
  error: string | null;
  /** The url actually handed to pdf.js, or null when it was refused. */
  safeUrl: string | null;
  /** Where "open the original" points, which is not always what we render. */
  openUrl: string | null;
  /** Text geometry per rendered page, for anchoring selections and ink. */
  pageGeometries: { current: Map<number, PageTextGeometry> };
  /** Set while the page observer is moving the page, to suppress a scroll. */
  suppressPageScroll: { current: boolean };
  /** Zoom, rotation and current page. Owned here because the page size it
   * fits to is measured by the same render pass it drives. */
  viewport: ReaderViewportApi;
  renderPage: (pageNumber: number) => Promise<void>;
  clearHighlights: () => void;
}

/**
 * The pdf.js side of the reader: open the document, draw a page, keep the text
 * geometry the rest of the reader anchors to.
 *
 * It is one hook rather than several because these parts share mutable state
 * that has to move together — a document change, a zoom or a rotation all
 * invalidate the same caches, and a render task still running against the old
 * generation has to be cancelled rather than allowed to paint over the new one.
 * Splitting them would mean publishing those refs to be co-ordinated from
 * outside, which is how they would fall out of step.
 */
export function usePdfRendering({
  url,
  originalUrl,
  locus,
  paperId,
  paperTitle,
  contentHash,
  initialPage,
  onSourceFailure,
  setJump,
}: PdfRenderingDeps): PdfRendering {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pdf, setPdf] = useState<PdfDocument | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pageSize, setPageSize] = useState<ReaderPageSize | null>(null);
  const [containerSize, setContainerSize] = useState<ReaderContainerSize | null>(null);
  const [pageTexts, setPageTexts] = useState<DocumentPageText[]>([]);
  const [outline, setOutline] = useState<ReaderOutlineItem[]>([]);
  const pageGeometries = useRef(new Map<number, PageTextGeometry>());
  const suppressPageScroll = useRef(false);
  const renderedPages = useRef(new Set<number>());
  const renderingPages = useRef(new Map<number, Promise<void>>());
  const renderTasks = useRef(new Map<number, RenderTask>());
  const renderGeneration = useRef(0);

  // The viewport fits to the page size this hook measures, and the render
  // scale it produces is what the next render pass draws at. Reading it from
  // outside would make the two mutually dependent.
  const viewport = useReaderViewport({ initialPage, pageSize, containerSize, numPages });
  const scale = viewport.renderScale;
  const rotation = viewport.rotation;

const safeUrl = (() => {
  if (url.startsWith("/api/pdf-proxy?")) {
    const original = originalUrlFromProxy(url);
    return original && isAllowedPdfProxyUrl(original) ? url : null;
  }
  // Bytes this app already cached and materialised — see isReaderObjectUrl.
  if (isReaderObjectUrl(url)) return url;
  return sanitizePdfUrl(url);
})();
const openUrl = (() => {
  const direct = sanitizePdfUrl(originalUrl);
  if (direct) return direct;
  const fromProxy = originalUrlFromProxy(url);
  if (fromProxy && isAllowedPdfProxyUrl(fromProxy)) return fromProxy;
  return sanitizePdfUrl(url);
})();

const cancelRenderTasks = useCallback(() => {
  for (const task of renderTasks.current.values()) {
    try {
      task.cancel();
    } catch {
      /* ignore */
    }
  }
  renderTasks.current.clear();
}, []);

useEffect(() => {
  const host = containerRef.current;
  if (!host || typeof ResizeObserver === "undefined") return;
  const measure = () => {
    setContainerSize({
      width: Math.max(1, host.clientWidth),
      height: Math.max(1, host.clientHeight),
    });
  };
  measure();
  const observer = new ResizeObserver(measure);
  observer.observe(host);
  return () => observer.disconnect();
}, [pdf]);

useEffect(() => {
  let cancelled = false;
  let task: ReturnType<PdfLib["getDocument"]> | null = null;
  renderGeneration.current += 1;
  renderedPages.current.clear();
  renderingPages.current.clear();
  // Page geometry is per-document. Keeping the previous document's items
  // would let a selection on a not-yet-rendered page build an anchor from
  // the *old* paper's text. The route remounts on url change, so this is
  // belt-and-braces — but the component must honour its own url prop.
  pageGeometries.current.clear();
  // A pending "the observer moved the page, do not scroll" flag must not
  // survive into the next document and swallow its first deliberate jump.
  suppressPageScroll.current = false;
  cancelRenderTasks();
  setError(null);
  setPdf(null);
  setNumPages(0);
  setPageSize(null);
  setPageTexts([]);
  setOutline([]);
  setJump({ status: locus ? "searching" : "idle" });

  if (!safeUrl) {
    setError("That PDF link is not allowed — only https URLs can be opened.");
    return;
  }

  void (async () => {
    try {
      const lib = await loadPdfLib();
      if (cancelled) return;
      const httpHeaders: Record<string, string> = {};
      if (safeUrl.startsWith("/api/pdf-proxy?")) {
        const accessToken = await getContainer().auth.auth.getAccessToken();
        if (!accessToken) {
          if (!cancelled) setError("Sign in to open this PDF in the reader.");
          return;
        }
        httpHeaders.Authorization = `Bearer ${accessToken}`;
      }
      task = lib.getDocument({
        url: safeUrl,
        isEvalSupported: false,
        ...(Object.keys(httpHeaders).length ? { httpHeaders, withCredentials: false } : {}),
      });
      if (cancelled) {
        try {
          task.destroy();
        } catch {
          /* ignore */
        }
        return;
      }
      const doc = await task.promise;
      if (cancelled) return;
      const first = await doc.getPage(1);
      if (cancelled) return;
      const base = first.getViewport({ scale: 1, rotation: 0 });
      setPageSize({ width: base.width, height: base.height });
      setPdf(doc);
      setNumPages(doc.numPages);

      // Extract text for search + outline (best-effort; never blocks rendering).
      void (async () => {
        try {
          const texts: DocumentPageText[] = [];
          for (let n = 1; n <= doc.numPages; n++) {
            if (cancelled) return;
            const p = await doc.getPage(n);
            const content = await p.getTextContent();
            const items = textItemsFromContent(content);
            texts.push({ pageIndex: n - 1, text: buildPageText(items).text });
          }
          if (cancelled) return;
          setPageTexts(texts);
          // Keep the text so this document stays searchable after the reader
          // closes. Piggybacks on the pass above — no extra fetch or parse.
          if (paperId) {
            const source = {
              paperId,
              title: paperTitle ?? "PDF",
              pages: texts,
              extractedAt: new Date().toISOString(),
            };
            void savePdfText(getContainer().projects.context.projectId, source);
            // Findable now rather than after a reload: the text is already in
            // hand, and a reader who searches straight after reading is the
            // common case, not the edge one.
            getContainer().search.indexPdf(source);
          }
        } catch {
          if (!cancelled) setPageTexts([]);
        }
      })();
      void (async () => {
        try {
          const raw = await doc.getOutline();
          if (cancelled) return;
          setOutline(await mapOutline(doc, raw ?? []));
        } catch {
          if (!cancelled) setOutline([]);
        }
      })();
    } catch (err) {
      if (cancelled) return;
      // A cached copy that will not open is recoverable: the screen can drop
      // it and refetch from the network. Offer that before showing an error,
      // so a bad cache entry is not a dead end.
      if (isReaderObjectUrl(safeUrl) && onSourceFailure) {
        onSourceFailure(safeUrl);
        return;
      }
      setError(err instanceof Error ? err.message : "Could not load this PDF in the app.");
    }
  })();
  return () => {
    cancelled = true;
    cancelRenderTasks();
    try {
      task?.destroy();
    } catch {
      /* ignore */
    }
  };
  // locus intentionally omitted — jump effect owns locus changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [safeUrl, cancelRenderTasks]);

const clearHighlights = useCallback(() => {
  containerRef.current?.querySelectorAll(".pdf-reader-hl").forEach((el) => el.remove());
}, []);

useEffect(() => {
  renderGeneration.current += 1;
  renderedPages.current.clear();
  renderingPages.current.clear();
  cancelRenderTasks();
  clearHighlights();
}, [scale, rotation, clearHighlights, cancelRenderTasks]);

const renderPage = useCallback(
  async (pageNumber: number) => {
    if (!pdf || renderedPages.current.has(pageNumber)) return;
    const inflight = renderingPages.current.get(pageNumber);
    if (inflight) {
      await inflight;
      if (renderedPages.current.has(pageNumber) || !pdf) return;
    }
    const generation = renderGeneration.current;
    let work!: Promise<void>;
    work = (async () => {
      try {
        const host = containerRef.current?.querySelector<HTMLDivElement>(
          `[data-page="${pageNumber}"]`,
        );
        if (!host) return;
        const pdfPage = await pdf.getPage(pageNumber);
        if (generation !== renderGeneration.current) return;
        const viewport = pdfPage.getViewport({ scale, rotation });
        const canvas = host.querySelector("canvas");
        if (!(canvas instanceof HTMLCanvasElement)) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        const ratio = window.devicePixelRatio || 1;
        canvas.width = Math.floor(viewport.width * ratio);
        canvas.height = Math.floor(viewport.height * ratio);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        host.style.width = `${Math.floor(viewport.width)}px`;
        host.style.height = `${Math.floor(viewport.height)}px`;
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        const renderTask = pdfPage.render({ canvasContext: ctx, viewport });
        renderTasks.current.set(pageNumber, renderTask);
        try {
          await renderTask.promise;
        } finally {
          if (renderTasks.current.get(pageNumber) === renderTask) {
            renderTasks.current.delete(pageNumber);
          }
        }
        if (generation !== renderGeneration.current) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          return;
        }
        // Text layer — selectable / copyable; input device for future annotation (R3).
        let textLayer = host.querySelector<HTMLDivElement>(".pdf-reader-textlayer");
        if (!textLayer) {
          textLayer = document.createElement("div");
          textLayer.className = "pdf-reader-textlayer";
          host.appendChild(textLayer);
        }
        textLayer.replaceChildren();
        textLayer.style.width = `${Math.floor(viewport.width)}px`;
        textLayer.style.height = `${Math.floor(viewport.height)}px`;
        const content = await pdfPage.getTextContent();
        const lib = await loadPdfLib();
        const geometryItems: import("@weaveforge/core").PageTextItem[] = [];
        let itemIndex = 0;
        for (const raw of content.items) {
          const it = raw as {
            str?: string;
            transform?: number[];
            width?: number;
            height?: number;
            hasEOL?: boolean;
          };
          if (typeof it.str !== "string" || !Array.isArray(it.transform)) continue;
          geometryItems.push({
            str: it.str,
            transform: it.transform,
            width: typeof it.width === "number" ? it.width : 0,
            height: typeof it.height === "number" ? it.height : 0,
            hasEOL: Boolean(it.hasEOL),
          });
          const tx = lib.Util.transform(viewport.transform, it.transform);
          const fontHeight = Math.hypot(tx[2]!, tx[3]!) || (it.height ?? 0) * scale;
          const width = (it.width ?? 0) * scale;
          const span = document.createElement("span");
          span.textContent = it.str;
          span.setAttribute("data-item-index", String(itemIndex));
          span.style.position = "absolute";
          span.style.whiteSpace = "pre";
          span.style.left = `${tx[4]!}px`;
          span.style.top = `${tx[5]! - fontHeight}px`;
          span.style.fontSize = `${Math.max(fontHeight, 1)}px`;
          span.style.width = `${Math.max(width, 1)}px`;
          textLayer.appendChild(span);
          itemIndex += 1;
        }
        const base = pdfPage.getViewport({ scale: 1, rotation: 0 });
        pageGeometries.current.set(pageNumber, {
          pageIndex: pageNumber - 1,
          pageWidth: base.width,
          pageHeight: base.height,
          items: geometryItems,
          // Stamp new anchors with the file they were captured against, so
          // the overlay's trust check keeps working once hashes are real.
          ...(contentHash ? { contentHash } : {}),
        });
        renderedPages.current.add(pageNumber);
      } catch {
        /* a failed / cancelled page must not break the rest of the document */
      } finally {
        if (renderingPages.current.get(pageNumber) === work) {
          renderingPages.current.delete(pageNumber);
        }
      }
    })();
    renderingPages.current.set(pageNumber, work);
    await work;
  },
  [pdf, scale, rotation, contentHash],
);
  return {
    viewport,
    containerRef,
    pdf,
    numPages,
    pageSize,
    containerSize,
    pageTexts,
    outline,
    error,
    safeUrl,
    openUrl,
    pageGeometries,
    suppressPageScroll,
    renderPage,
    clearHighlights,
  };
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { outlineFromText, type OutlineTextItem, type PdfLink } from "@weaveforge/core";
import type { TextLayer } from "pdfjs-dist";
import { createPdfTextLayer, measurePdfLinks } from "./pdf-text-layer";

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
import { pdfProxyNeedsToken } from "../../application/pdf-download-consent";
import {
  isCachePdfUrl,
  isStoredPdfUrl,
  readStoredPdfBytes,
} from "../../application/resolve-paper-pdf-for-reader";
import { useReaderViewport, type ReaderViewportApi } from "../use-reader-viewport";
import type { ReaderOutlineItem } from "../reader-outline";
import type { JumpState, PdfDocument, PdfLib, PdfReaderProps, RenderTask, TextItemGeometry } from "./types";
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
  /**
   * How much of the container's width a page may take when fitting: 1, or
   * 0.5 while the pen's writing margin sits beside every page.
   */
  pageShare?: number;
}

export interface PdfRendering {
  /** Scroll host; pages are queried out of it by their `data-page`. */
  containerRef: React.RefObject<HTMLDivElement>;
  pdf: PdfDocument | null;
  numPages: number;
  pageSize: ReaderPageSize | null;
  containerSize: ReaderContainerSize | null;
  pageTexts: DocumentPageText[];
  /**
   * Text runs of every page, indexed by page number, once extraction is done.
   * Unlike `pageGeometries` this covers pages that have not been rendered, so
   * the citation index and its overlay can be built for the whole document.
   */
  pageItems: Map<number, TextItemGeometry[]>;
  /** Rects of the document's own `/Link` annotations per page, PDF user space. */
  /** The document's own `/Link` annotations, by 1-based page, destinations resolved. */
  pageLinks: Map<number, PdfLink[]>;
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
/**
 * A pdf.js destination — a name to look up, or an explicit array — as a
 * 1-based page and the point it names when it is `/XYZ` (the only kind that
 * carries one). Anything unresolvable is `null`.
 */
async function resolveDestination(
  doc: PdfDocument,
  dest: unknown,
): Promise<{ page: number; x?: number; y?: number } | null> {
  try {
    const explicit = typeof dest === "string" ? await doc.getDestination(dest) : dest;
    if (!Array.isArray(explicit) || !explicit.length) return null;
    const [ref, kind, x, y] = explicit as [unknown, { name?: string } | undefined, unknown, unknown];
    const page =
      typeof ref === "number" ? ref + 1 : ref && typeof ref === "object" ? (await doc.getPageIndex(ref as never)) + 1 : null;
    if (!page) return null;
    if (kind?.name === "XYZ") {
      return {
        page,
        ...(typeof x === "number" ? { x } : {}),
        ...(typeof y === "number" ? { y } : {}),
      };
    }
    return { page };
  } catch {
    return null;
  }
}

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
  pageShare = 1,
}: PdfRenderingDeps): PdfRendering {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pdf, setPdf] = useState<PdfDocument | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pageSize, setPageSize] = useState<ReaderPageSize | null>(null);
  const [containerSize, setContainerSize] = useState<ReaderContainerSize | null>(null);
  const [pageTexts, setPageTexts] = useState<DocumentPageText[]>([]);
  const [pageItems, setPageItems] = useState<Map<number, TextItemGeometry[]>>(() => new Map());
  const [pageLinks, setPageLinks] = useState<Map<number, PdfLink[]>>(() => new Map());
  const [outline, setOutline] = useState<ReaderOutlineItem[]>([]);
  const pageGeometries = useRef(new Map<number, PageTextGeometry>());
  const suppressPageScroll = useRef(false);
  const renderedPages = useRef(new Set<number>());
  const renderingPages = useRef(new Map<number, Promise<void>>());
  const renderTasks = useRef(new Map<number, RenderTask>());
  /** Each page's pdf.js text layer, so a re-render can cancel the last one. */
  const textLayers = useRef(new Map<number, TextLayer>());
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
  // The same bytes, still in the store: the desktop reader takes them as data.
  if (isCachePdfUrl(url)) return url;
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
  for (const layer of textLayers.current.values()) layer.cancel();
  textLayers.current.clear();
}, []);

useEffect(() => {
  const host = containerRef.current;
  if (!host || typeof ResizeObserver === "undefined") return;
  const measure = () => {
    setContainerSize({
      width: Math.max(1, host.clientWidth * pageShare),
      height: Math.max(1, host.clientHeight),
    });
  };
  measure();
  const observer = new ResizeObserver(measure);
  observer.observe(host);
  return () => observer.disconnect();
}, [pdf, pageShare]);

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
  setPageItems(new Map());
  setPageLinks(new Map());
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
      if (safeUrl.startsWith("/api/pdf-proxy?") && pdfProxyNeedsToken()) {
        const accessToken = await getContainer().auth.auth.getAccessToken();
        if (!accessToken) {
          if (!cancelled) setError("Sign in to open this PDF in the reader.");
          return;
        }
        httpHeaders.Authorization = `Bearer ${accessToken}`;
      }
      let source: { url: string } | { data: Uint8Array };
      if (isCachePdfUrl(safeUrl)) {
        const stored = await readStoredPdfBytes(safeUrl);
        if (!stored) throw new Error("The stored copy of this PDF is missing.");
        source = { data: new Uint8Array(stored) };
      } else {
        source = { url: safeUrl };
      }
      if (cancelled) return;
      task = lib.getDocument({
        ...source,
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

      let detected: ReaderOutlineItem[] = [];
      let bookmarks: ReaderOutlineItem[] | null = null;
      const publishOutline = () => {
        if (!cancelled && bookmarks !== null) setOutline(bookmarks.length ? bookmarks : detected);
      };
      // Extract text for search + outline (best-effort; never blocks rendering).
      void (async () => {
        try {
          const texts: DocumentPageText[] = [];
          const outlinePages: OutlineTextItem[][] = [];
          const itemsByPage = new Map<number, TextItemGeometry[]>();
          const links = new Map<number, PdfLink[]>();
          for (let n = 1; n <= doc.numPages; n++) {
            if (cancelled) return;
            const p = await doc.getPage(n);
            const content = await p.getTextContent();
            const items = textItemsFromContent(content);
            texts.push({ pageIndex: n - 1, text: buildPageText(items).text });
            itemsByPage.set(n, items);
            // The document's own links, two ways. A URL link is left to the
            // document (its rect defers ours). An internal `/Dest` link is
            // what hyperref writes over every `[13]` on an arXiv PDF, naming
            // the entry it cites, so its destination is resolved here to a
            // page and point and becomes the citation itself — exact where a
            // regex over the text layer guesses.
            try {
              const found: PdfLink[] = [];
              for (const a of await p.getAnnotations()) {
                if (a.subtype !== "Link" || !Array.isArray(a.rect) || a.rect.length < 4) continue;
                const rect = a.rect.slice(0, 4) as [number, number, number, number];
                if (typeof a.url === "string" && a.url) {
                  found.push({ rect, url: a.url });
                  continue;
                }
                const dest = await resolveDestination(doc, a.dest);
                if (dest) found.push({ rect, dest });
              }
              if (found.length) {
                // Which characters each box covers, measured in the rendered
                // layout. A page that will not lay out keeps its unmeasured
                // links; the analysis then estimates from the run widths.
                let measured = found;
                try {
                  measured = await measurePdfLinks(
                    lib,
                    content,
                    p.getViewport({ scale: 1, rotation: 0 }),
                    items,
                    found,
                  );
                } catch {
                  /* estimate instead */
                }
                links.set(n, measured);
              }
            } catch {
              /* a page whose annotations will not load simply has none */
            }
            outlinePages.push(items.map((item) => ({
              str: item.str,
              fontSize: Math.hypot(item.transform[2] ?? 0, item.transform[3] ?? 0),
              fontName: item.fontName ? content.styles[item.fontName]?.fontFamily ?? item.fontName : undefined,
              x: item.transform[4] ?? 0,
              y: item.transform[5] ?? 0,
              page: n,
            })));
          }
          if (cancelled) return;
          detected = outlineFromText(outlinePages);
          publishOutline();
          setPageTexts(texts);
          setPageItems(itemsByPage);
          setPageLinks(links);
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
          bookmarks = await mapOutline(doc, raw ?? []);
          publishOutline();
        } catch {
          bookmarks = [];
          publishOutline();
        }
      })();
    } catch (err) {
      if (cancelled) return;
      // A cached copy that will not open is recoverable: the screen can drop
      // it and refetch from the network. Offer that before showing an error,
      // so a bad cache entry is not a dead end.
      if ((isReaderObjectUrl(safeUrl) || isCachePdfUrl(safeUrl)) && onSourceFailure) {
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
        // The *page box* takes the rendered size, not the found host: the host
        // is the page's row (§pdf-reader), which also holds the pen's writing
        // strip and must be free to be wider than the page it contains.
        const pageBox = host.querySelector<HTMLElement>(".pdf-reader-page") ?? host;
        pageBox.style.width = `${Math.floor(viewport.width)}px`;
        pageBox.style.height = `${Math.floor(viewport.height)}px`;
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
        textLayers.current.get(pageNumber)?.cancel();
        textLayers.current.delete(pageNumber);
        textLayer.replaceChildren();
        const content = await pdfPage.getTextContent();
        if (generation !== renderGeneration.current) return;
        const lib = await loadPdfLib();
        const geometryItems: import("@weaveforge/core").PageTextItem[] = [];
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
        }
        // PDF.js lays the runs out itself — measured against their fonts, so
        // the invisible text sits over the glyphs and a selection covers the
        // words it looks like it covers. Hand-placing spans from the transform
        // was a second layout that never quite agreed with the first.
        const layer = createPdfTextLayer(lib, textLayer, content, viewport);
        textLayers.current.set(pageNumber, layer);
        await layer.render();
        if (generation !== renderGeneration.current || textLayers.current.get(pageNumber) !== layer) return;
        if (
          layer.textDivs.length !== geometryItems.length ||
          layer.textContentItemsStr.some((str, i) => str !== geometryItems[i]?.str)
        ) {
          throw new Error("PDF text item mapping changed.");
        }
        // The item index is what selection and citation decoration key on;
        // `textDivs` is in item order, one per run with text.
        layer.textDivs.forEach((div, index) => div.setAttribute("data-item-index", String(index)));
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
    pageItems,
    pageLinks,
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

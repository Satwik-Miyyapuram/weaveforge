"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import {
  isEditableReaderTarget,
  readerKeyboardCommand,
  resolveTextAnchor,
  type PageTextGeometry,
  type PdfLocus,
  type AnchorConfidence,
  type ReaderContainerSize,
  type ReaderPageSize,
  type DocumentPageText,
  type ReaderAnnotationType,
} from "@thesis/core";
import { getContainer } from "@/bootstrap";
import { sanitizePdfUrl, originalUrlFromProxy, isAllowedPdfProxyUrl } from "../application/sanitize-reader-url";
import {
  pageNumberFromSelection,
  selectionRangeFromDom,
} from "../application/dom-selection-range";
import {
  draftFromTextSelection,
  draftImageRegion,
  draftInkAnnotation,
  draftTextBox,
} from "../application/draft-local-annotation";
import {
  annotationPinKey,
  applyAnnotationPatch,
  optimisticAnnotationFromDraft,
  PENDING_ANNOTATION_PREFIX,
  READER_ANNOTATION_COLORS,
  type ReaderCreateTool,
} from "../application/reader-annotation-helpers";
import { useReaderViewport } from "./use-reader-viewport";
import { ReaderToolbar } from "./reader-toolbar";
import { ReaderSearchBar } from "./reader-search-bar";
import { ReaderOutline, type ReaderOutlineItem } from "./reader-outline";
import { AnnotationOverlay } from "./annotation-overlay";
import { bucketAnnotationsByPage } from "../application/project-annotation-geometry";
import { AnnotationSidebar, type ReportSectionOption } from "./annotation-sidebar";
import { SelectionCreateBar } from "./selection-create-bar";
import type { QuotationType, ReaderAnnotation } from "@thesis/core";
import {
  darkPdfCanvasFilter,
  shouldUseDarkPdfRendering,
} from "../application/reader-pdf-theme";
import {
  backlinksForAnnotation,
  findAnnotationBacklinks,
  type AnnotationBacklinkHit,
} from "../application/annotation-backlinks";

/**
 * pdf.js render surface. Dynamically imports pdf.js so no bytes reach first
 * paint on non-reader routes. Viewport defaults to fit-width; anchors stay in
 * PDF user space and are projected through viewport.transform at render time.
 */

type PdfLib = typeof import("pdfjs-dist");
type PdfDocument = Awaited<ReturnType<PdfLib["getDocument"]>["promise"]>;
type RenderTask = ReturnType<Awaited<ReturnType<PdfDocument["getPage"]>>["render"]>;

/** Per-page resolve must ignore document-scoped position offsets. */
function pageScopedLocus(locus: PdfLocus): PdfLocus {
  return { quote: locus.quote };
}

interface TextItemGeometry {
  str: string;
  hasEOL?: boolean;
  transform: number[];
  width: number;
  height: number;
}

interface PageText {
  text: string;
  items: { start: number; end: number; index: number }[];
}

export interface PdfReaderProps {
  url: string;
  originalUrl?: string;
  locus?: PdfLocus;
  /** 0-based page hint; when present the jump resolves there first. */
  page?: number;
  /** Projected reader annotations (Zotero and/or local). */
  annotations?: import("@thesis/core").ReaderAnnotation[];
  /**
   * Hash of the PDF being rendered, when the source ladder knows it. Stored
   * annotation rects are only trusted against a matching hash; empty on both
   * sides means "unnamed local file", which is trusted.
   */
  contentHash?: string;
  paperTitle?: string;
  quotationTypes?: Map<string, QuotationType>;
  /** When set, selection can create local annotations (R3 sink). */
  paperId?: string;
  onAnnotationsChange?: (
    next: ReaderAnnotation[] | ((prev: ReaderAnnotation[]) => ReaderAnnotation[]),
  ) => void;
  onActivity?: (kind: string, message: string) => void;
}

interface JumpState {
  status: "idle" | "searching" | "found" | "low" | "missed";
  pageNumber?: number;
  confidence?: AnchorConfidence;
}

/** Stable empty array — a fresh `[]` per page would defeat memoisation. */
const EMPTY_ANNOTATIONS: ReaderAnnotation[] = [];

let pdfLibPromise: Promise<PdfLib> | null = null;

async function loadPdfLib(): Promise<PdfLib> {
  if (!pdfLibPromise) {
    pdfLibPromise = import("pdfjs-dist").then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      return lib;
    });
  }
  return pdfLibPromise;
}

function buildPageText(items: readonly { str: string; hasEOL?: boolean }[]): PageText {
  let text = "";
  const ranges: PageText["items"] = [];
  items.forEach((item, index) => {
    const start = text.length;
    text += item.str;
    ranges.push({ start, end: text.length, index });
    if (item.hasEOL) text += "\n";
  });
  return { text, items: ranges };
}

function textItemsFromContent(content: { items: readonly unknown[] }): TextItemGeometry[] {
  return content.items.flatMap((raw): TextItemGeometry[] => {
    const it = raw as Partial<TextItemGeometry>;
    if (typeof it.str !== "string" || !Array.isArray(it.transform)) return [];
    return [
      {
        str: it.str,
        hasEOL: Boolean((raw as { hasEOL?: boolean }).hasEOL),
        transform: it.transform,
        width: typeof it.width === "number" ? it.width : 0,
        height: typeof it.height === "number" ? it.height : 0,
      },
    ];
  });
}

function SafeExternalLink({ href, children }: { href: string; children: ReactNode }) {
  const safe = sanitizePdfUrl(href);
  if (!safe) return null;
  return (
    <a className="secondary-btn" href={safe} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return isEditableReaderTarget(target);
}

async function mapOutline(
  doc: PdfDocument,
  nodes: readonly { title?: string; dest?: unknown; items?: unknown[] }[],
): Promise<ReaderOutlineItem[]> {
  const out: ReaderOutlineItem[] = [];
  for (const node of nodes) {
    let pageNumber: number | null = null;
    try {
      if (node.dest) {
        const dest =
          typeof node.dest === "string" ? await doc.getDestination(node.dest) : node.dest;
        if (Array.isArray(dest) && dest[0]) {
          const idx = await doc.getPageIndex(dest[0] as Parameters<PdfDocument["getPageIndex"]>[0]);
          pageNumber = idx + 1;
        }
      }
    } catch {
      pageNumber = null;
    }
    const children = Array.isArray(node.items)
      ? await mapOutline(doc, node.items as { title?: string; dest?: unknown; items?: unknown[] }[])
      : undefined;
    out.push({
      title: node.title?.trim() || "Untitled",
      pageNumber,
      ...(children?.length ? { items: children } : {}),
    });
  }
  return out;
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
}: PdfReaderProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [pdf, setPdf] = useState<PdfDocument | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [jump, setJump] = useState<JumpState>({ status: locus ? "searching" : "idle" });
  const [pageSize, setPageSize] = useState<ReaderPageSize | null>(null);
  const [containerSize, setContainerSize] = useState<ReaderContainerSize | null>(null);
  const [pageTexts, setPageTexts] = useState<DocumentPageText[]>([]);
  const [outline, setOutline] = useState<ReaderOutlineItem[]>([]);
  const [showOutline, setShowOutline] = useState(false);
  const [spread, setSpread] = useState(false);
  const [selectedAnnId, setSelectedAnnId] = useState<string | null>(null);
  const [createTool, setCreateTool] = useState<ReaderCreateTool>("select");
  const [createColor, setCreateColor] = useState<string>(READER_ANNOTATION_COLORS[0]);
  const [pendingCreate, setPendingCreate] = useState<{
    pageNumber: number;
    quote: string;
    selection: import("@thesis/core").TextSelectionRange;
  } | null>(null);
  const [createBusy, setCreateBusy] = useState(false);
  const [reportSections, setReportSections] = useState<ReportSectionOption[]>([]);
  const [pinsByKey, setPinsByKey] = useState<Map<string, string | null>>(new Map());
  const [pinsList, setPinsList] = useState<
    { annotationKey: string; reportSectionId: string; paperId: string }[]
  >([]);
  const [backlinkHits, setBacklinkHits] = useState<AnnotationBacklinkHit[]>([]);
  const [darkPdf, setDarkPdf] = useState(false);
  const [annError, setAnnError] = useState<string | null>(null);
  const [vaultBacklinkPages, setVaultBacklinkPages] = useState<
    { id: string; title: string; body: string }[]
  >([]);
  const pageGeometries = useRef(new Map<number, PageTextGeometry>());
  const suppressPageScroll = useRef(false);
  const inkPath = useRef<number[]>([]);
  const dragRect = useRef<{
    pageNumber: number;
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  } | null>(null);
  const renderedPages = useRef(new Set<number>());
  const renderingPages = useRef(new Map<number, Promise<void>>());
  const renderTasks = useRef(new Map<number, RenderTask>());
  const renderGeneration = useRef(0);
  const canCreate = Boolean(paperId && onAnnotationsChange);
  // Bucket once per annotation change rather than rescanning the whole list in
  // every page's overlay on every zoom, scroll, and rotation.
  const annotationsByPage = useMemo(() => bucketAnnotationsByPage(annotations), [annotations]);

  const viewport = useReaderViewport({
    initialPage: typeof page === "number" ? page + 1 : 1,
    pageSize,
    containerSize,
    numPages,
  });
  const scale = viewport.renderScale;
  const rotation = viewport.rotation;

  const safeUrl = (() => {
    if (url.startsWith("/api/pdf-proxy?")) {
      const original = originalUrlFromProxy(url);
      return original && isAllowedPdfProxyUrl(original) ? url : null;
    }
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
            if (!cancelled) setPageTexts(texts);
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
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not load this PDF in the app.");
        }
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
          const geometryItems: import("@thesis/core").PageTextItem[] = [];
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
    [pdf, locus, scale, rotation],
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
  }, [viewport.page, pdf, numPages, renderPage]);

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

  useEffect(() => {
    if (!paperId) {
      setReportSections([]);
      setPinsByKey(new Map());
      setPinsList([]);
      setVaultBacklinkPages([]);
      setBacklinkHits([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const [sections, pins, vaultPages] = await Promise.all([
          getContainer().papers.listReportSections(),
          getContainer().papers.listAnnotationPinsForPaper(paperId),
          getContainer().vault.listPages().catch(() => []),
        ]);
        if (cancelled) return;
        setReportSections(
          sections.map((s) => ({ id: s.id, title: s.title || "Untitled section" })),
        );
        setPinsByKey(new Map(pins.map((p) => [p.annotationKey, p.reportSectionId])));
        setPinsList(
          pins.map((p) => ({
            annotationKey: p.annotationKey,
            reportSectionId: p.reportSectionId,
            paperId: p.paperId,
          })),
        );
        setVaultBacklinkPages(
          vaultPages.map((p) => ({
            id: p.id,
            title: p.title || "Untitled note",
            body: p.body ?? "",
          })),
        );
      } catch {
        if (!cancelled) {
          setReportSections([]);
          setPinsByKey(new Map());
          setPinsList([]);
          setVaultBacklinkPages([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [paperId]);

  useEffect(() => {
    if (!paperId) {
      setBacklinkHits([]);
      return;
    }
    setBacklinkHits(
      findAnnotationBacklinks({
        annotations,
        pins: pinsList,
        sections: reportSections,
        vaultPages: vaultBacklinkPages,
      }),
    );
  }, [paperId, annotations, pinsList, reportSections, vaultBacklinkPages]);

  useEffect(() => {
    const readTheme = () => {
      const root = document.documentElement;
      const theme = root.getAttribute("data-theme");
      const mode = root.getAttribute("data-mode");
      setDarkPdf(mode === "dark" || shouldUseDarkPdfRendering(theme, mode));
    };
    readTheme();
    const observer = new MutationObserver(readTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "data-mode"],
    });
    return () => observer.disconnect();
  }, []);

  function screenToPdf(pageHost: HTMLElement, clientX: number, clientY: number) {
    const rect = pageHost.getBoundingClientRect();
    const pageNumber = Number(pageHost.dataset.page);
    const x = (clientX - rect.left) / scale;
    const yScreen = (clientY - rect.top) / scale;
    const pageHeight =
      pageGeometries.current.get(pageNumber)?.pageHeight ?? pageSize?.height ?? 0;
    return { x, y: pageHeight - yScreen };
  }

  function onSelectionMouseUp() {
    if (!canCreate || createTool !== "select" || rotation !== 0) return;
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

  async function persistDraft(
    draft: import("@thesis/core").NewReaderAnnotation,
  ): Promise<void> {
    if (!paperId || !onAnnotationsChange) return;

    // Paint first, persist second. The write is a network round-trip, and
    // waiting for it meant the highlight appeared hundreds of milliseconds
    // after the click — long enough to read as a dead button.
    const tempId = `${PENDING_ANNOTATION_PREFIX}${
      globalThis.crypto?.randomUUID?.() ?? String(Date.now())
    }`;
    const optimistic = optimisticAnnotationFromDraft(draft, tempId);
    onAnnotationsChange((prev) => [...prev, optimistic]);
    setSelectedAnnId(tempId);
    setPendingCreate(null);
    setAnnError(null);
    window.getSelection()?.removeAllRanges();

    setCreateBusy(true);
    try {
      const created = await getContainer().papers.createReaderAnnotation(paperId, draft);
      onAnnotationsChange((prev) => prev.map((a) => (a.id === tempId ? created : a)));
      setSelectedAnnId((prev) => (prev === tempId ? created.id : prev));
      onActivity?.("annotate", `Created ${created.type}`);
    } catch (err) {
      // Roll the optimistic one back — leaving it would show a highlight that
      // vanishes on the next reload with no explanation.
      onAnnotationsChange((prev) => prev.filter((a) => a.id !== tempId));
      setSelectedAnnId((prev) => (prev === tempId ? null : prev));
      setAnnError(err instanceof Error ? err.message : "Could not save the annotation.");
    } finally {
      setCreateBusy(false);
    }
  }

  async function createFromPending(
    type: Extract<ReaderAnnotationType, "highlight" | "underline" | "note">,
    color: string,
  ) {
    if (!pendingCreate) return;
    const geometry = pageGeometries.current.get(pendingCreate.pageNumber);
    if (!geometry) return;
    let comment = "";
    if (type === "note") {
      const typed = window.prompt("Sticky note comment");
      if (typed == null) return;
      comment = typed.trim();
    }
    const draft = draftFromTextSelection({
      type,
      color,
      selection: pendingCreate.selection,
      page: geometry,
      comment,
    });
    if (!draft) return;
    await persistDraft(draft);
  }

  async function updateLocal(
    id: string,
    patch: { comment?: string; tags?: string[]; color?: string },
  ) {
    if (!onAnnotationsChange) return;
    // A colour change repaints the highlight, so waiting for the write shows a
    // swatch that stays wrong until the network answers. Apply, then reconcile.
    let previous: ReaderAnnotation | undefined;
    onAnnotationsChange((prev) =>
      prev.map((a) => {
        if (a.id !== id) return a;
        previous = a;
        return applyAnnotationPatch(a, patch);
      }),
    );
    setAnnError(null);
    try {
      const updated = await getContainer().papers.updateReaderAnnotation(id, patch);
      onAnnotationsChange((prev) => prev.map((a) => (a.id === id ? updated : a)));
      onActivity?.("annotate", "Updated annotation");
    } catch (err) {
      if (previous) {
        const restore = previous;
        onAnnotationsChange((prev) => prev.map((a) => (a.id === id ? restore : a)));
      }
      setAnnError(err instanceof Error ? err.message : "Could not update the annotation.");
    }
  }

  async function removeLocal(id: string) {
    if (!onAnnotationsChange) return;
    if (!window.confirm("Delete this local annotation?")) return;
    // Remove on screen straight away, restore if the delete fails — the same
    // round-trip that delayed creation left a deleted highlight sitting there.
    let removed: ReaderAnnotation | undefined;
    onAnnotationsChange((prev) => {
      removed = prev.find((a) => a.id === id);
      return prev.filter((a) => a.id !== id);
    });
    if (selectedAnnId === id) setSelectedAnnId(null);
    setAnnError(null);
    try {
      await getContainer().papers.removeReaderAnnotation(id);
      onActivity?.("annotate", "Deleted annotation");
    } catch (err) {
      if (removed) {
        const restore = removed;
        onAnnotationsChange((prev) =>
          prev.some((a) => a.id === restore.id) ? prev : [...prev, restore],
        );
      }
      setAnnError(err instanceof Error ? err.message : "Could not delete the annotation.");
    }
  }

  async function pinLocal(ann: ReaderAnnotation, sectionId: string | null) {
    if (!paperId) return;
    const key = annotationPinKey(ann);
    try {
      await getContainer().papers.setAnnotationPin(paperId, key, sectionId);
      setPinsByKey((prev) => {
        const next = new Map(prev);
        if (sectionId) next.set(key, sectionId);
        else next.delete(key);
        return next;
      });
      setPinsList((prev) => {
        const without = prev.filter((p) => p.annotationKey !== key);
        if (!sectionId) return without;
        return [...without, { annotationKey: key, reportSectionId: sectionId, paperId }];
      });
      setAnnError(null);
    } catch (err) {
      setAnnError(err instanceof Error ? err.message : "Could not pin the annotation.");
    }
  }

  function onPagePointerDown(pageNumber: number, event: React.PointerEvent<HTMLDivElement>) {
    if (!canCreate || !pageSize) return;
    if (rotation !== 0) return;
    if (createTool === "select") return;
    event.preventDefault();
    const host = event.currentTarget;
    const pt = screenToPdf(host, event.clientX, event.clientY);
    if (createTool === "ink") {
      inkPath.current = [pt.x, pt.y];
      host.setPointerCapture(event.pointerId);
      return;
    }
    if (createTool === "image") {
      dragRect.current = {
        pageNumber,
        x0: pt.x,
        y0: pt.y,
        x1: pt.x,
        y1: pt.y,
      };
      host.setPointerCapture(event.pointerId);
      return;
    }
    if (createTool === "text") {
      const text = window.prompt("Text annotation");
      if (!text?.trim()) return;
      const draft = draftTextBox({
        color: createColor,
        pageIndex: pageNumber - 1,
        pageHeight: pageSize.height,
        text: text.trim(),
        x: pt.x,
        y: pt.y,
      });
      void persistDraft(draft);
    }
  }

  function onPagePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!canCreate || rotation !== 0) return;
    const host = event.currentTarget;
    const pt = screenToPdf(host, event.clientX, event.clientY);
    if (createTool === "ink" && inkPath.current.length >= 2) {
      inkPath.current.push(pt.x, pt.y);
      return;
    }
    if (createTool === "image" && dragRect.current) {
      dragRect.current.x1 = pt.x;
      dragRect.current.y1 = pt.y;
    }
  }

  function onPagePointerUp(pageNumber: number, event: React.PointerEvent<HTMLDivElement>) {
    if (!canCreate || !pageSize || rotation !== 0) return;
    if (createTool === "ink" && inkPath.current.length >= 4) {
      const pageHeight =
        pageGeometries.current.get(pageNumber)?.pageHeight ?? pageSize.height;
      const draft = draftInkAnnotation({
        color: createColor,
        pageIndex: pageNumber - 1,
        pageHeight,
        path: [...inkPath.current],
      });
      inkPath.current = [];
      if (draft) void persistDraft(draft);
      return;
    }
    inkPath.current = [];
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
      style={darkPdf ? ({ ["--pdf-dark-filter" as string]: darkPdfCanvasFilter() } as CSSProperties) : undefined}
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
            <select
              className="pdf-reader-tool-select"
              aria-label="Annotation tool"
              value={createTool}
              disabled={rotation !== 0}
              onChange={(e) => setCreateTool(e.target.value as ReaderCreateTool)}
            >
              <option value="select">Select</option>
              <option value="ink">Ink</option>
              <option value="image">Image region</option>
              <option value="text">Text box</option>
            </select>
            <input
              type="color"
              className="pdf-reader-color-input"
              aria-label="Annotation colour"
              value={createColor}
              disabled={rotation !== 0}
              onChange={(e) => setCreateColor(e.target.value)}
            />
          </div>
        )}
        </div>
      </div>
      {rotation !== 0 && (
        <div className="pdf-reader-banner pdf-reader-banner--low" role="status">
          Annotations and create tools pause while the page is rotated — reset rotation to edit.
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
      {pendingCreate && canCreate && rotation === 0 && (
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
              className={`pdf-reader-page${createTool !== "select" && canCreate ? " pdf-reader-page--draw" : ""}`}
              data-page={n}
              key={n}
              onPointerDown={(e) => onPagePointerDown(n, e)}
              onPointerMove={onPagePointerMove}
              onPointerUp={(e) => onPagePointerUp(n, e)}
            >
              <canvas />
              {pageSize && rotation === 0 && (
                <AnnotationOverlay
                  annotations={annotationsByPage.get(n) ?? EMPTY_ANNOTATIONS}
                  contentHash={contentHash}
                  pageNumber={n}
                  scale={scale}
                  rotation={rotation}
                  pageHeight={pageGeometries.current.get(n)?.pageHeight ?? pageSize.height}
                  selectedId={selectedAnnId}
                  onSelect={(id) => setSelectedAnnId(id)}
                />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import {
  readerKeyboardCommand,
  resolveTextAnchor,
  type PdfLocus,
  type AnchorConfidence,
  type ReaderContainerSize,
  type ReaderPageSize,
  type DocumentPageText,
} from "@thesis/core";
import { getContainer } from "@/bootstrap";
import { sanitizePdfUrl, originalUrlFromProxy, isAllowedPdfProxyUrl } from "../application/sanitize-reader-url";
import { useReaderViewport } from "./use-reader-viewport";
import { ReaderToolbar } from "./reader-toolbar";
import { ReaderSearchBar } from "./reader-search-bar";
import { ReaderOutline, type ReaderOutlineItem } from "./reader-outline";
import { AnnotationOverlay } from "./annotation-overlay";
import { AnnotationSidebar } from "./annotation-sidebar";
import type { QuotationType, ReaderAnnotation } from "@thesis/core";

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
  paperTitle?: string;
  quotationTypes?: Map<string, import("@thesis/core").QuotationType>;
}

interface JumpState {
  status: "idle" | "searching" | "found" | "low" | "missed";
  pageNumber?: number;
  confidence?: AnchorConfidence;
}

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
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable;
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
  paperTitle = "Paper",
  quotationTypes,
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
  const renderedPages = useRef(new Set<number>());
  const renderingPages = useRef(new Map<number, Promise<void>>());
  const renderTasks = useRef(new Map<number, RenderTask>());
  const renderGeneration = useRef(0);

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
          for (const raw of content.items) {
            const it = raw as {
              str?: string;
              transform?: number[];
              width?: number;
              height?: number;
            };
            if (typeof it.str !== "string" || !Array.isArray(it.transform)) continue;
            const tx = lib.Util.transform(viewport.transform, it.transform);
            const fontHeight = Math.hypot(tx[2]!, tx[3]!) || (it.height ?? 0) * scale;
            const width = (it.width ?? 0) * scale;
            const span = document.createElement("span");
            span.textContent = it.str;
            span.style.left = `${tx[4]!}px`;
            span.style.top = `${tx[5]! - fontHeight}px`;
            span.style.fontSize = `${Math.max(fontHeight, 1)}px`;
            span.style.width = `${Math.max(width, 1)}px`;
            textLayer.appendChild(span);
          }
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
    [pdf, scale, rotation],
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
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const n = Number((entry.target as HTMLElement).dataset.page);
          if (n) void renderPage(n);
        }
      },
      { root, rootMargin: "600px 0px" },
    );
    root.querySelectorAll("[data-page]").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [pdf, numPages, renderPage]);

  // Scroll when the toolbar / keyboard changes the current page.
  useEffect(() => {
    if (!pdf || numPages === 0) return;
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
      className="pdf-reader"
      ref={rootRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      aria-label="PDF reader"
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
      <ReaderToolbar viewport={viewport} numPages={numPages} />
      <div className="pdf-reader-tools">
        <ReaderSearchBar
          pages={pageTexts}
          onJump={(match) => {
            viewport.setPage(match.pageIndex + 1);
          }}
        />
        <button
          type="button"
          className="btn-secondary btn-sm"
          onClick={() => setShowOutline((v) => !v)}
        >
          {showOutline ? "Hide outline" : "Outline"}
        </button>
        <button
          type="button"
          className="btn-secondary btn-sm"
          onClick={() => setSpread((v) => !v)}
        >
          {spread ? "Single page" : "Two-page"}
        </button>
      </div>
      <div className={`pdf-reader-body${showOutline || annotations.length ? " pdf-reader-body--outline" : ""}`}>
        {(showOutline || annotations.length > 0) && (
          <div className="pdf-reader-side">
            {showOutline && (
              <ReaderOutline items={outline} onNavigate={(n) => viewport.setPage(n)} />
            )}
            {annotations.length > 0 && (
              <AnnotationSidebar
                annotations={annotations}
                quotationTypes={quotationTypes}
                paperTitle={paperTitle}
                selectedId={selectedAnnId}
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
        >
          {!pdf && <div className="pdf-reader-loading">Loading PDF…</div>}
          {Array.from({ length: numPages }, (_, i) => i + 1).map((n) => (
            <div className="pdf-reader-page" data-page={n} key={n}>
              <canvas />
              {annotations.length > 0 && pageSize && (
                <AnnotationOverlay
                  annotations={annotations}
                  pageNumber={n}
                  scale={scale}
                  rotation={rotation}
                  pageHeight={pageSize.height}
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

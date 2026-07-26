"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { resolveTextAnchor, type PdfLocus, type AnchorConfidence } from "@thesis/core";
import { getContainer } from "@/bootstrap";
import { sanitizePdfUrl, originalUrlFromProxy, isAllowedPdfProxyUrl } from "../application/sanitize-reader-url";

/**
 * Read-only pdf.js render surface (Phase D). Dynamically imports pdf.js so no
 * bytes reach first paint on non-reader routes; the worker runs off the main
 * thread. Pages render lazily as they scroll into view. Given a locus, text is
 * scanned first (no canvas) and only the matched page is painted + highlighted;
 * low confidence is surfaced rather than jumping wrong.
 *
 * This is a provenance-verification surface, not an annotator (D2/D3).
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
  /**
   * PDF URL passed to pdf.js. May be a same-origin `/api/pdf-proxy?…` rewrite
   * so cross-origin publishers do not hit CORS.
   */
  url: string;
  /** Original http(s) URL for "Open the original PDF" (never a javascript: link). */
  originalUrl?: string;
  locus?: PdfLocus;
  /** 0-based page hint; when present the jump resolves there first. */
  page?: number;
  scale?: number;
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

export function PdfReader({ url, originalUrl, locus, page, scale = 1.35 }: PdfReaderProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pdf, setPdf] = useState<PdfDocument | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [jump, setJump] = useState<JumpState>({ status: locus ? "searching" : "idle" });
  const renderedPages = useRef(new Set<number>());
  const renderingPages = useRef(new Map<number, Promise<void>>());
  const renderTasks = useRef(new Map<number, RenderTask>());
  const renderGeneration = useRef(0);
  // Accept same-origin proxy paths only when the nested target is allowlisted.
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
    let cancelled = false;
    let task: ReturnType<PdfLib["getDocument"]> | null = null;
    renderGeneration.current += 1;
    renderedPages.current.clear();
    renderingPages.current.clear();
    cancelRenderTasks();
    setError(null);
    setPdf(null);
    setNumPages(0);
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
        if (cancelled) return; // cleanup's task.destroy() owns the proxy
        setPdf(doc);
        setNumPages(doc.numPages);
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

  // Drop cached canvases when scale changes so highlights stay aligned.
  useEffect(() => {
    renderGeneration.current += 1;
    renderedPages.current.clear();
    renderingPages.current.clear();
    cancelRenderTasks();
    clearHighlights();
  }, [scale, clearHighlights, cancelRenderTasks]);

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
          const viewport = pdfPage.getViewport({ scale });
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
    [pdf, scale],
  );

  /** Text-only scan — no canvas. Returns confidence if the locus matches this page. */
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
      const viewport = pdfPage.getViewport({ scale });
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
        const tx = lib.Util.transform(viewport.transform, item.transform);
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
    [pdf, locus, scale],
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

  // Jump-to-locus: text-scan first, paint the first hit early, downgrade if ambiguous.
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
          if (cancelled) return;
          const host = containerRef.current?.querySelector<HTMLElement>(
            `[data-page="${match.pageNumber}"]`,
          );
          host?.scrollIntoView({ behavior: "smooth", block: "center" });
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
            continue; // skip a bad page; keep scanning
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
        // Never overwrite a successful early paint with a false "missed".
        if (!cancelled && !firstMatch) setJump({ status: "missed" });
      }
    })();
    return () => {
      cancelled = true;
      clearHighlights();
    };
  }, [pdf, locus, page, matchOnPage, highlightOnPage, renderPage, clearHighlights]);

  if (error) {
    return (
      <div className="pdf-reader-error card">
        <p>{error}</p>
        {openUrl && <SafeExternalLink href={openUrl}>Open the original PDF</SafeExternalLink>}
      </div>
    );
  }

  return (
    <div className="pdf-reader">
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
      <div className="pdf-reader-scroll" ref={containerRef}>
        {!pdf && <div className="pdf-reader-loading">Loading PDF…</div>}
        {Array.from({ length: numPages }, (_, i) => i + 1).map((n) => (
          <div className="pdf-reader-page" data-page={n} key={n}>
            <canvas />
          </div>
        ))}
      </div>
    </div>
  );
}

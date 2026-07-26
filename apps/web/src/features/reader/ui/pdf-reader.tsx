"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { resolveTextAnchor, type PdfLocus, type AnchorConfidence } from "@thesis/core";

/**
 * Read-only pdf.js render surface (Phase D). Dynamically imports pdf.js so no
 * bytes reach first paint on non-reader routes; the worker runs off the main
 * thread. Pages render lazily as they scroll into view (text layer on demand).
 * Given a locus, it resolves the used sentence by quote → position and scrolls
 * to it, surfacing low confidence rather than jumping to the wrong place.
 *
 * This is a provenance-verification surface, not an annotator: it never mutates
 * the document or creates annotations (D2/D3).
 */

type PdfLib = typeof import("pdfjs-dist");
type PdfDocument = Awaited<ReturnType<PdfLib["getDocument"]>["promise"]>;

/** The subset of a pdf.js text item we need for text + highlight geometry. */
interface TextItemGeometry {
  str: string;
  hasEOL?: boolean;
  transform: number[];
  width: number;
  height: number;
}

/** Concatenated page text plus the char range each text item occupies. */
interface PageText {
  text: string;
  items: { start: number; end: number; index: number }[];
}

export interface PdfReaderProps {
  /** Direct PDF URL to render (must be fetchable from the browser). */
  url: string;
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

/** Load pdf.js once and wire its worker. Kept out of the first-paint graph. */
async function loadPdfLib(): Promise<PdfLib> {
  if (!pdfLibPromise) {
    pdfLibPromise = import("pdfjs-dist").then((lib) => {
      // Served from public/ (see scripts/copy-pdf-worker.mjs). Loading it via
      // `new URL(..., import.meta.url)` makes webpack re-Terser the minified
      // worker and fails the build; a same-origin static asset avoids that and
      // keeps the worker out of every route's JS graph.
      lib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      return lib;
    });
  }
  return pdfLibPromise;
}

/** Build page text with per-item offsets aligned to what we render. */
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

export function PdfReader({ url, locus, page, scale = 1.35 }: PdfReaderProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pdf, setPdf] = useState<PdfDocument | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [jump, setJump] = useState<JumpState>({ status: locus ? "searching" : "idle" });
  const renderedPages = useRef(new Set<number>());

  useEffect(() => {
    let cancelled = false;
    let task: ReturnType<PdfLib["getDocument"]> | null = null;
    setError(null);
    setPdf(null);
    void (async () => {
      try {
        const lib = await loadPdfLib();
        task = lib.getDocument({ url, isEvalSupported: false });
        const doc = await task.promise;
        if (cancelled) {
          void doc.destroy();
          return;
        }
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
      try {
        task?.destroy();
      } catch {
        /* ignore */
      }
    };
  }, [url]);

  /** Render a single page's canvas + (on demand) an overlay for highlights. */
  const renderPage = useCallback(
    async (pageNumber: number) => {
      if (!pdf || renderedPages.current.has(pageNumber)) return;
      renderedPages.current.add(pageNumber);
      const host = containerRef.current?.querySelector<HTMLDivElement>(
        `[data-page="${pageNumber}"]`,
      );
      if (!host) return;
      try {
        const pdfPage = await pdf.getPage(pageNumber);
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
        await pdfPage.render({ canvasContext: ctx, viewport }).promise;
      } catch {
        /* a failed page must not break the rest of the document */
      }
    },
    [pdf, scale],
  );

  /** Resolve the locus on a page and draw highlight rects over the match. */
  const highlightOnPage = useCallback(
    async (pageNumber: number): Promise<AnchorConfidence | null> => {
      if (!pdf || !locus) return null;
      const lib = await loadPdfLib();
      const pdfPage = await pdf.getPage(pageNumber);
      const viewport = pdfPage.getViewport({ scale });
      const content = await pdfPage.getTextContent();
      const items = content.items.flatMap((raw): TextItemGeometry[] => {
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
      const pageText = buildPageText(items);
      const anchor = resolveTextAnchor(pageText.text, locus);
      if (!anchor) return null;

      const host = containerRef.current?.querySelector<HTMLDivElement>(
        `[data-page="${pageNumber}"]`,
      );
      if (!host) return anchor.confidence;
      host.querySelectorAll(".pdf-reader-hl").forEach((el) => el.remove());

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
      return anchor.confidence;
    },
    [pdf, locus, scale],
  );

  // Lazily render pages as they enter the viewport.
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

  // Jump-to-locus once the document is ready.
  useEffect(() => {
    if (!pdf || !locus) return;
    let cancelled = false;
    setJump({ status: "searching" });
    void (async () => {
      const order: number[] = [];
      const hinted = typeof page === "number" ? page + 1 : undefined;
      if (hinted && hinted >= 1 && hinted <= pdf.numPages) order.push(hinted);
      for (let n = 1; n <= pdf.numPages; n++) if (n !== hinted) order.push(n);

      for (const pageNumber of order) {
        if (cancelled) return;
        await renderPage(pageNumber);
        const confidence = await highlightOnPage(pageNumber);
        if (confidence) {
          if (cancelled) return;
          const host = containerRef.current?.querySelector<HTMLElement>(
            `[data-page="${pageNumber}"]`,
          );
          host?.scrollIntoView({ behavior: "smooth", block: "center" });
          setJump({
            status: confidence === "high" ? "found" : "low",
            pageNumber,
            confidence,
          });
          return;
        }
      }
      if (!cancelled) setJump({ status: "missed" });
    })();
    return () => {
      cancelled = true;
    };
  }, [pdf, locus, page, renderPage, highlightOnPage]);

  if (error) {
    return (
      <div className="pdf-reader-error card">
        <p>{error}</p>
        <a className="secondary-btn" href={url} target="_blank" rel="noreferrer">
          Open the original PDF
        </a>
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
              <a href={url} target="_blank" rel="noreferrer">
                Open the original PDF
              </a>
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

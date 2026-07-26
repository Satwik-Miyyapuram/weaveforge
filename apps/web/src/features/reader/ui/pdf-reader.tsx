"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { resolveTextAnchor, type PdfLocus, type AnchorConfidence } from "@thesis/core";
import { sanitizePdfUrl } from "../application/sanitize-reader-url";

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
  /** Direct PDF URL to render (must already be allowlisted http(s)). */
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

export function PdfReader({ url, locus, page, scale = 1.35 }: PdfReaderProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pdf, setPdf] = useState<PdfDocument | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [jump, setJump] = useState<JumpState>({ status: locus ? "searching" : "idle" });
  const renderedPages = useRef(new Set<number>());
  const safeUrl = sanitizePdfUrl(url);

  useEffect(() => {
    let cancelled = false;
    let task: ReturnType<PdfLib["getDocument"]> | null = null;
    let loaded: PdfDocument | null = null;
    renderedPages.current.clear();
    setError(null);
    setPdf(null);
    setNumPages(0);
    setJump({ status: locus ? "searching" : "idle" });

    if (!safeUrl) {
      setError("That PDF link is not allowed — only http(s) URLs can be opened.");
      return;
    }

    void (async () => {
      try {
        const lib = await loadPdfLib();
        task = lib.getDocument({ url: safeUrl, isEvalSupported: false });
        const doc = await task.promise;
        if (cancelled) {
          void doc.destroy();
          return;
        }
        loaded = doc;
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
      if (loaded) void loaded.destroy().catch(() => undefined);
    };
    // locus intentionally omitted — jump effect owns locus changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safeUrl]);

  const clearHighlights = useCallback(() => {
    containerRef.current?.querySelectorAll(".pdf-reader-hl").forEach((el) => el.remove());
  }, []);

  const renderPage = useCallback(
    async (pageNumber: number) => {
      if (!pdf || renderedPages.current.has(pageNumber)) return;
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
        renderedPages.current.add(pageNumber);
      } catch {
        /* a failed page must not break the rest of the document — leave unset so retry works */
      }
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
      const anchor = resolveTextAnchor(pageText.text, locus);
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
      const anchor = resolveTextAnchor(pageText.text, locus);
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

  // Jump-to-locus: text-scan first, paint only the match, downgrade if ambiguous.
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
      const order: number[] = [];
      const hinted = typeof page === "number" ? page + 1 : undefined;
      if (hinted && hinted >= 1 && hinted <= pdf.numPages) order.push(hinted);
      for (let n = 1; n <= pdf.numPages; n++) if (n !== hinted) order.push(n);

      let firstMatch: { pageNumber: number; confidence: AnchorConfidence } | null = null;
      let extraMatches = 0;

      for (const pageNumber of order) {
        if (cancelled) return;
        const confidence = await matchOnPage(pageNumber);
        if (!confidence) continue;
        if (!firstMatch) {
          firstMatch = { pageNumber, confidence };
          // With a page hint we trust the first hit on that page and stop.
          if (hinted) break;
          // Without a hint, keep scanning to detect ambiguous quotes.
          continue;
        }
        extraMatches += 1;
        // One extra hit is enough to know the quote is ambiguous.
        break;
      }

      if (cancelled) return;
      if (!firstMatch) {
        setJump({ status: "missed" });
        return;
      }

      const confidence: AnchorConfidence =
        !hinted && (extraMatches > 0 || firstMatch.confidence === "low")
          ? "low"
          : firstMatch.confidence;

      await renderPage(firstMatch.pageNumber);
      if (cancelled) return;
      clearHighlights();
      await highlightOnPage(firstMatch.pageNumber);
      if (cancelled) return;
      const host = containerRef.current?.querySelector<HTMLElement>(
        `[data-page="${firstMatch.pageNumber}"]`,
      );
      host?.scrollIntoView({ behavior: "smooth", block: "center" });
      setJump({
        status: confidence === "high" ? "found" : "low",
        pageNumber: firstMatch.pageNumber,
        confidence,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [pdf, locus, page, matchOnPage, highlightOnPage, renderPage, clearHighlights]);

  if (error) {
    return (
      <div className="pdf-reader-error card">
        <p>{error}</p>
        <SafeExternalLink href={url}>Open the original PDF</SafeExternalLink>
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
              <SafeExternalLink href={url}>Open the original PDF</SafeExternalLink>
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

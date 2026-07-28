"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { decodeLocus, type PdfLocus } from "@thesis/core";
import { getContainer } from "@/bootstrap";
import { ScreenLoader } from "@/components/thesis-loader";
import { PdfReader } from "./pdf-reader-lazy";
import {
  sanitizePdfUrl,
  proxiedPdfUrl,
  looksLikePdfUrl,
} from "../application/sanitize-reader-url";
import { resolvePaperPdfSource } from "../application/resolve-paper-pdf-source";

/** Reader route: renders a PDF via the source ladder and jumps to an optional locus. */
export function ReaderScreen() {
  const params = useSearchParams();
  const paperId = params.get("paper");
  const pdfParam = params.get("pdf");
  const pageParam = params.get("page");
  const locusRaw = params.get("locus");
  const locus: PdfLocus | null = useMemo(() => decodeLocus(locusRaw), [locusRaw]);
  const page = useMemo(() => {
    const n = pageParam ? Number(pageParam) : NaN;
    return Number.isInteger(n) && n >= 0 ? n : undefined;
  }, [pageParam]);

  const pdfFromParam = useMemo(() => {
    const sanitized = sanitizePdfUrl(pdfParam);
    if (!sanitized) return null;
    return looksLikePdfUrl(sanitized) ? sanitized : null;
  }, [pdfParam]);
  const [pdfUrl, setPdfUrl] = useState<string | null>(paperId ? null : pdfFromParam);
  const [title, setTitle] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(paperId));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    setTitle(null);
    if (!paperId) {
      if (pdfFromParam) {
        setPdfUrl(pdfFromParam);
        setLoading(false);
        return;
      }
      setPdfUrl(null);
      setLoading(false);
      if (pdfParam) {
        setError("That PDF link is not allowed — only https PDF URLs can be opened.");
      }
      return;
    }
    let cancelled = false;
    setLoading(true);
    setPdfUrl(null);
    void getContainer()
      .papers.getPaper(paperId)
      .then(async (paper) => {
        if (cancelled) return;
        setTitle(paper?.title ?? null);
        if (!paper) {
          setError("Paper not found or inaccessible.");
          return;
        }
        const resolution = await resolvePaperPdfSource({
          id: paper.id,
          url: paper.url,
          arxivId: paper.arxivId,
          doi: paper.doi,
          pdfPath: paper.pdfPath,
        });
        if (cancelled) return;
        if (resolution.ok) setPdfUrl(resolution.hit.url);
        else setError("This paper has no PDF URL the reader can open (HTML landing pages are skipped).");
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [paperId, pdfFromParam, pdfParam]);

  return (
    <section className="screen reader-screen">
      <div className="screen-header">
        <div>
          <p className="eyebrow">Source</p>
          <h1>{title ?? "Reader"}</h1>
          <p className="muted">In-app PDF reader — fit width by default; zoom, rotate, and jump pages from the toolbar.</p>
        </div>
        {paperId && (
          <Link className="secondary-btn" href={`/papers?paper=${encodeURIComponent(paperId)}`}>
            Back to paper
          </Link>
        )}
      </div>
      {loading && <ScreenLoader status="Resolving source…" />}
      {!loading && error && (
        <div className="card empty-state">
          <h2>Cannot open this source</h2>
          <p>{error}</p>
        </div>
      )}
      {!loading && !error && !pdfUrl && (
        <div className="card empty-state">
          <h2>Nothing to show</h2>
          <p>No PDF was provided for this locus.</p>
        </div>
      )}
      {!loading && pdfUrl && (
        <PdfReader
          key={pdfUrl}
          url={proxiedPdfUrl(pdfUrl)}
          originalUrl={pdfUrl}
          locus={locus ?? undefined}
          page={page}
        />
      )}
    </section>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { decodeLocus, type PdfLocus } from "@thesis/core";
import { getContainer } from "@/bootstrap";
import { ScreenLoader } from "@/components/thesis-loader";
import { PdfReader } from "./pdf-reader-lazy";
import { resolvePaperPdfUrl, sanitizePdfUrl } from "../application/sanitize-reader-url";

/** Read-only reader route: renders a PDF and jumps to an optional locus (D). */
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

  const pdfFromParam = useMemo(() => sanitizePdfUrl(pdfParam), [pdfParam]);
  const [pdfUrl, setPdfUrl] = useState<string | null>(pdfFromParam);
  const [title, setTitle] = useState<string | null>(null);
  const [loading, setLoading] = useState(!pdfFromParam && Boolean(paperId));
  const [error, setError] = useState<string | null>(null);

  // Keep state in sync when the query string changes (client nav between loci).
  useEffect(() => {
    setError(null);
    setTitle(null);
    if (pdfFromParam) {
      setPdfUrl(pdfFromParam);
      setLoading(false);
      return;
    }
    if (!paperId) {
      setPdfUrl(null);
      setLoading(false);
      if (pdfParam) setError("That PDF link is not allowed — only http(s) URLs can be opened.");
      return;
    }
    let cancelled = false;
    setLoading(true);
    setPdfUrl(null);
    void getContainer()
      .papers.getPaper(paperId)
      .then((paper) => {
        if (cancelled) return;
        setTitle(paper?.title ?? null);
        const url = resolvePaperPdfUrl({
          url: paper?.url,
          arxivId: paper?.arxivId,
          pdfPath: paper?.pdfPath,
        });
        if (url) setPdfUrl(url);
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
          <p className="muted">Read-only view for verifying where a claim came from.</p>
        </div>
        {paperId && (
          <Link className="secondary-btn" href={`/papers?focus=${encodeURIComponent(paperId)}`}>
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
        <PdfReader key={pdfUrl} url={pdfUrl} locus={locus ?? undefined} page={page} />
      )}
    </section>
  );
}

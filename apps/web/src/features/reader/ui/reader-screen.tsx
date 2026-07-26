"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { decodeLocus, type PdfLocus } from "@thesis/core";
import { getContainer } from "@/bootstrap";
import { ScreenLoader } from "@/components/thesis-loader";
import { PdfReader } from "./pdf-reader-lazy";

/** Read-only reader route: renders a PDF and jumps to an optional locus (D). */
export function ReaderScreen() {
  const params = useSearchParams();
  const paperId = params.get("paper");
  const pdfParam = params.get("pdf");
  const pageParam = params.get("page");
  const locus: PdfLocus | null = useMemo(() => decodeLocus(params.get("locus")), [params]);
  const page = useMemo(() => {
    const n = pageParam ? Number(pageParam) : NaN;
    return Number.isInteger(n) && n >= 0 ? n : undefined;
  }, [pageParam]);

  const [pdfUrl, setPdfUrl] = useState<string | null>(pdfParam);
  const [title, setTitle] = useState<string | null>(null);
  const [loading, setLoading] = useState(!pdfParam && Boolean(paperId));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (pdfParam || !paperId) return;
    let cancelled = false;
    setLoading(true);
    void getContainer()
      .papers.getPaper(paperId)
      .then((paper) => {
        if (cancelled) return;
        setTitle(paper?.title ?? null);
        const url = paper?.url;
        if (url) setPdfUrl(url);
        else setError("This paper has no PDF URL to open in the reader.");
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
  }, [paperId, pdfParam]);

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
      {!loading && pdfUrl && <PdfReader url={pdfUrl} locus={locus ?? undefined} page={page} />}
    </section>
  );
}

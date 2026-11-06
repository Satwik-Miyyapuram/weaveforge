"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/button";
import { FormError } from "@/components/form-error";
import { createPdfObjectUrl, PdfReader, revokePdfObjectUrl } from "@/features/reader";
import {
  fetchWorkshopPdf,
  type WorkshopPdfDeps,
} from "@/features/overleaf/infrastructure/workshop-pdf-client";

export interface WorkshopPdfViewerProps {
  sessionId: string;
  projectId: string;
}

/**
 * Shows the PDF Overleaf compiled for a stored Workshop session. Overleaf picks
 * the project's main document.
 *
 * `authHeaders` comes from the panel, so a copy with no account calls the
 * shell's routes without a bearer token.
 *
 * Each load owns the object URL it creates. A change of inputs or an unmount marks
 * the load cancelled; a response that lands after that is revoked on arrival and
 * never shown. A shown URL is revoked once a newer PDF replaces it or on unmount.
 * Recompile keeps the last PDF on screen until the new one arrives.
 */
export function WorkshopPdfViewer({
  sessionId,
  projectId,
  authHeaders,
}: WorkshopPdfViewerProps & { authHeaders: WorkshopPdfDeps["authHeaders"] }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [compiling, setCompiling] = useState(true);
  /** Recompile bumps this to fetch again. */
  const [runs, setRuns] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const deps: WorkshopPdfDeps = {
      fetch: (url, init) => fetch(url, init),
      authHeaders,
      createObjectUrl: (blob) => createPdfObjectUrl(blob),
    };
    setCompiling(true);
    setError(null);
    void fetchWorkshopPdf(deps, sessionId, projectId, null, () => !cancelled).then((result) => {
      if (cancelled) {
        if (result.ok) revokePdfObjectUrl(result.url);
        return;
      }
      setCompiling(false);
      if (result.ok) setUrl(result.url);
      else setError(result.message);
    });
    return () => {
      cancelled = true;
    };
  }, [sessionId, projectId, authHeaders, runs]);

  useEffect(() => {
    if (!url) return;
    return () => revokePdfObjectUrl(url);
  }, [url]);

  // One bar, as Overleaf has: once a PDF is shown, Recompile and Download sit
  // in the reader's own toolbar instead of a second strip above it.
  const controls = (
    <>
      <Button size="sm" variant="primary" disabled={compiling} onClick={() => setRuns((n) => n + 1)}>
        {compiling ? "Compiling…" : "Recompile"}
      </Button>
      {url && (
        <Button size="sm" variant="ghost" href={url} download="output.pdf" title="Download PDF" aria-label="Download PDF">
          <DownloadIcon />
        </Button>
      )}
    </>
  );

  return (
    <div className="workshop-pdf" aria-label="Compiled Overleaf PDF">
      {!url && <div className="workshop-pdf__bar">{controls}</div>}
      {error && <FormError>{error}</FormError>}
      <div className="workshop-pdf__view">
        {url && <PdfReader url={url} paperTitle="Compiled Overleaf PDF" viewOnly toolbarExtra={controls} />}
      </div>
    </div>
  );
}

const DownloadIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
  </svg>
);

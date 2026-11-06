"use client";

import { useEffect, useState } from "react";
import { FormError } from "@/components/form-error";
import { PdfReader } from "@/features/reader/ui/pdf-reader";
import {
  fetchWorkshopPdf,
  type WorkshopPdfDeps,
} from "@/features/overleaf/infrastructure/workshop-pdf-client";

export interface WorkshopPdfViewerProps {
  sessionId: string;
  projectId: string;
}

type ViewState = { status: "loading" } | { status: "ready"; url: string } | { status: "error"; message: string };

/**
 * Shows the PDF Overleaf compiled for a stored Workshop session. Overleaf picks
 * the project's main document.
 *
 * `authHeaders` comes from the panel, so a copy with no account calls the
 * shell's routes without a bearer token.
 *
 * Each load owns the object URL it creates. A change of inputs or an unmount marks
 * the load cancelled and revokes the URL on screen; a response that lands after
 * that is revoked on arrival and never shown.
 */
export function WorkshopPdfViewer({
  sessionId,
  projectId,
  authHeaders,
}: WorkshopPdfViewerProps & { authHeaders: WorkshopPdfDeps["authHeaders"] }) {
  const [state, setState] = useState<ViewState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    let shownUrl: string | null = null;
    const deps: WorkshopPdfDeps = {
      fetch: (url, init) => fetch(url, init),
      authHeaders,
      createObjectUrl: (blob) => URL.createObjectURL(blob),
    };
    setState({ status: "loading" });
    void fetchWorkshopPdf(deps, sessionId, projectId, null, () => !cancelled).then((result) => {
      if (cancelled) {
        if (result.ok) URL.revokeObjectURL(result.url);
        return;
      }
      if (result.ok) {
        shownUrl = result.url;
        setState({ status: "ready", url: result.url });
      } else {
        setState({ status: "error", message: result.message });
      }
    });
    return () => {
      cancelled = true;
      if (shownUrl) URL.revokeObjectURL(shownUrl);
    };
  }, [sessionId, projectId, authHeaders]);

  if (state.status === "error") return <FormError>{state.message}</FormError>;
  if (state.status === "loading") return <p className="muted">Compiling on Overleaf…</p>;
  return (
    <div className="workshop-pdf" aria-label="Compiled Overleaf PDF">
      <PdfReader url={state.url} paperTitle="Compiled Overleaf PDF" />
    </div>
  );
}

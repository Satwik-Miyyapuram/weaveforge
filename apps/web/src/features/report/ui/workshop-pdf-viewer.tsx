"use client";

import { useEffect, useState } from "react";
import { authHeaders } from "@/lib/auth-headers";
import { FormError } from "@/components/form-error";
import {
  fetchWorkshopPdf,
  type WorkshopPdfDeps,
} from "@/features/overleaf/infrastructure/workshop-pdf-client";

export interface WorkshopPdfViewerProps {
  sessionId: string;
  projectId: string;
  rootResourcePath: string;
}

const browserDeps: WorkshopPdfDeps = {
  fetch: (url, init) => fetch(url, init),
  authHeaders,
  createObjectUrl: (blob) => URL.createObjectURL(blob),
};

type ViewState = { status: "loading" } | { status: "ready"; url: string } | { status: "error"; message: string };

/**
 * Shows the PDF Overleaf compiled for a stored Workshop session.
 *
 * Each load owns the object URL it creates. A change of inputs or an unmount marks
 * the load cancelled and revokes the URL on screen; a response that lands after
 * that is revoked on arrival and never shown.
 */
export function WorkshopPdfViewer({ sessionId, projectId, rootResourcePath }: WorkshopPdfViewerProps) {
  const [state, setState] = useState<ViewState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    let shownUrl: string | null = null;
    setState({ status: "loading" });
    void fetchWorkshopPdf(browserDeps, sessionId, projectId, rootResourcePath, () => !cancelled).then((result) => {
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
  }, [sessionId, projectId, rootResourcePath]);

  if (state.status === "error") return <FormError>{state.message}</FormError>;
  if (state.status === "loading") return <p className="muted">Loading PDF…</p>;
  return (
    <iframe
      title="Compiled Overleaf PDF"
      src={state.url}
      style={{ width: "100%", height: "80vh", border: 0 }}
    />
  );
}

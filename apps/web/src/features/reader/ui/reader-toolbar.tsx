"use client";

import { useEffect, useState } from "react";
import type { ReaderViewportApi } from "./use-reader-viewport";

interface ReaderToolbarProps {
  viewport: ReaderViewportApi;
  numPages: number;
}

export function ReaderToolbar({ viewport, numPages }: ReaderToolbarProps) {
  const percent = Math.round(viewport.renderScale * 100);
  const pages = Math.max(1, numPages);

  /**
   * The page field is edited as text, not bound straight to the viewport's
   * number. A directly controlled numeric input cannot be cleared — React
   * re-renders the old value as fast as the user deletes it — so backspacing
   * in order to type "12" is impossible.
   */
  const [draft, setDraft] = useState(String(viewport.page));
  useEffect(() => {
    setDraft(String(viewport.page));
  }, [viewport.page]);

  function commit(raw: string) {
    const trimmed = raw.trim();
    const next = Number(trimmed);
    if (trimmed === "" || !Number.isFinite(next)) {
      setDraft(String(viewport.page));
      return;
    }
    viewport.setPage(next);
    setDraft(String(Math.min(pages, Math.max(1, Math.round(next)))));
  }

  return (
    <div className="pdf-reader-toolbar" role="toolbar" aria-label="PDF controls">
      <button
        type="button"
        className="btn-secondary btn-sm"
        onClick={viewport.zoomOut}
        aria-label="Zoom out"
        title="Zoom out (−)"
      >
        −
      </button>
      <span className="pdf-reader-toolbar-label" aria-live="polite">
        {percent}%
      </span>
      <button
        type="button"
        className="btn-secondary btn-sm"
        onClick={viewport.zoomIn}
        aria-label="Zoom in"
        title="Zoom in (+)"
      >
        +
      </button>
      <button type="button" className="btn-secondary btn-sm" onClick={viewport.fitWidth} title="Fit width">
        Fit width
      </button>
      <button type="button" className="btn-secondary btn-sm" onClick={viewport.fitPage} title="Fit page">
        Fit page
      </button>
      <button
        type="button"
        className="btn-secondary btn-sm"
        onClick={viewport.rotateClockwise}
        title="Rotate"
      >
        Rotate
      </button>
      <label className="pdf-reader-page-jump">
        <span className="muted">Page</span>
        <input
          type="number"
          min={1}
          max={pages}
          value={draft}
          aria-label="Page number"
          onChange={(event) => {
            const raw = event.target.value;
            setDraft(raw);
            // Apply as the user types, but let the field hold a partial value.
            if (raw.trim() !== "" && Number.isFinite(Number(raw))) {
              viewport.setPage(Number(raw));
            }
          }}
          onBlur={(event) => commit(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") commit(event.currentTarget.value);
          }}
        />
        <span className="muted">/ {pages}</span>
      </label>
    </div>
  );
}

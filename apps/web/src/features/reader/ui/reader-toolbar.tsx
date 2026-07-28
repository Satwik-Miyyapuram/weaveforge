"use client";

import type { ReaderViewportApi } from "./use-reader-viewport";

interface ReaderToolbarProps {
  viewport: ReaderViewportApi;
  numPages: number;
}

export function ReaderToolbar({ viewport, numPages }: ReaderToolbarProps) {
  const percent = Math.round(viewport.renderScale * 100);

  return (
    <div className="pdf-reader-toolbar" role="toolbar" aria-label="PDF controls">
      <button type="button" className="btn-secondary btn-sm" onClick={viewport.zoomOut} title="Zoom out (−)">
        −
      </button>
      <span className="pdf-reader-toolbar-label" aria-live="polite">
        {percent}%
      </span>
      <button type="button" className="btn-secondary btn-sm" onClick={viewport.zoomIn} title="Zoom in (+)">
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
          max={Math.max(1, numPages)}
          value={viewport.page}
          aria-label="Page number"
          onChange={(event) => viewport.setPage(Number(event.target.value))}
        />
        <span className="muted">/ {Math.max(1, numPages)}</span>
      </label>
    </div>
  );
}

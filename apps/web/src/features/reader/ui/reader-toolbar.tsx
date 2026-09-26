"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { ReaderViewportApi } from "./use-reader-viewport";

interface ReaderToolbarProps {
  viewport: ReaderViewportApi;
  numPages: number;
  /**
   * Ink mode: the pen is out.
   *
   * The fit controls stand down with it. Fitting re-scales the page under a
   * hand that is writing on it — the stroke in progress jumps, and the line
   * being drawn lands somewhere else — and a hand holding a stylus is not
   * reaching for "Fit width" anyway. Zoom, rotate and the page field stay: they
   * are how the paper is *read*, and a writer still turns the page.
   */
  hideFit?: boolean;
  /** Phone-only toggles (find, more), at the end of the row. */
  children?: ReactNode;
}

export function ReaderToolbar({ viewport, numPages, hideFit = false, children }: ReaderToolbarProps) {
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
      <div className="pdf-reader-group">
        <button
          type="button"
          className="btn-secondary btn-sm pdf-reader-icon-btn"
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
          className="btn-secondary btn-sm pdf-reader-icon-btn"
          onClick={viewport.zoomIn}
          aria-label="Zoom in"
          title="Zoom in (+)"
        >
          +
        </button>
      </div>
      {/* On a phone, fit and rotate live behind "More": pinch zooms, and the
          page already opens at fit width. */}
      <div className="pdf-reader-group pdf-reader-more">
        {!hideFit && (
          <>
            <button
              type="button"
              className={`btn-secondary btn-sm${viewport.fit === "width" ? " is-active" : ""}`}
              onClick={viewport.fitWidth}
              aria-pressed={viewport.fit === "width"}
              title="Fit width"
            >
              Fit width
            </button>
            <button
              type="button"
              className={`btn-secondary btn-sm${viewport.fit === "page" ? " is-active" : ""}`}
              onClick={viewport.fitPage}
              aria-pressed={viewport.fit === "page"}
              title="Fit page"
            >
              Fit page
            </button>
          </>
        )}
        <button
          type="button"
          className="btn-secondary btn-sm"
          onClick={viewport.rotateClockwise}
          title="Rotate (r)"
        >
          Rotate
        </button>
      </div>
      <label className="pdf-reader-page-jump pdf-reader-group">
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
      {children}
    </div>
  );
}

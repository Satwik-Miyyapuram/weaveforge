"use client";

import { useState, type ReactNode } from "react";
import { pdfPointToScreen, pdfRectToScreenBox, type PageProjection } from "@weaveforge/core";
import { sanitizePdfUrl } from "../application/sanitize-reader-url";
import { Modal } from "@/components/modal";
import { DraftShape } from "./pdf-reader";

export function SafeExternalLink({ href, children }: { href: string; children: ReactNode }) {
  const safe = sanitizePdfUrl(href);
  if (!safe) return null;
  return (
    <a className="btn-secondary" href={safe} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

/**
 * Paints the mark currently under the pointer.
 *
 * Uses the same projection as the persisted overlay — `x * scale` and
 * `(pageHeight - y) * scale` — so the preview sits exactly where the saved
 * annotation lands, with no jump on release.
 */
export function DraftShapeOverlay({
  shape,
  color,
  projection,
}: {
  shape: DraftShape;
  color: string;
  projection: PageProjection;
}) {
  const toScreen = (x: number, y: number) => {
    const point = pdfPointToScreen(x, y, projection);
    return `${point.x},${point.y}`;
  };

  return (
    <div className="pdf-reader-ann-layer" aria-hidden>
      <svg className="pdf-reader-ann-svg" width="100%" height="100%">
        {shape.kind === "ink" ? (
          <polyline
            className={
              shape.highlighter
                ? "pdf-reader-ink pdf-reader-ink--highlighter"
                : "pdf-reader-ink"
            }
            points={Array.from({ length: Math.floor(shape.path.length / 2) }, (_, i) =>
              toScreen(shape.path[i * 2]!, shape.path[i * 2 + 1]!),
            ).join(" ")}
            fill="none"
            stroke={color}
            // Same nib the saved stroke will have, so nothing changes thickness
            // on release.
            strokeWidth={Math.max(shape.width * projection.scale, 0.5)}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : (
          (() => {
            const box = pdfRectToScreenBox(
              [
                Math.min(shape.x0, shape.x1),
                Math.min(shape.y0, shape.y1),
                Math.max(shape.x0, shape.x1),
                Math.max(shape.y0, shape.y1),
              ],
              projection,
            );
            return (
              <rect
                x={box.left}
                y={box.top}
                width={box.width}
                height={box.height}
                fill="none"
                stroke={color}
                strokeWidth={1.5}
                strokeDasharray="4 3"
              />
            );
          })()
        )}
      </svg>
    </div>
  );
}

/**
 * In-app composer for a text annotation's contents.
 *
 * Replaces `window.prompt`, which is an unstyled OS dialog that ignores the
 * app's theme and, on a phone, covers the page being annotated.
 */
export function TextBoxComposer({
  title,
  label,
  submitLabel,
  placeholder,
  onSubmit,
  onCancel,
}: {
  title: string;
  label: string;
  submitLabel: string;
  placeholder: string;
  onSubmit: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState("");
  const trimmed = text.trim();

  return (
    <Modal title={title} onClose={onCancel}>
      <div className="form-stack">
        <label className="field">
          {label}
          <textarea
            rows={4}
            value={text}
            autoFocus
            placeholder={placeholder}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        <div className="screen-actions">
          <button
            type="button"
            className="btn-primary"
            disabled={!trimmed}
            onClick={() => onSubmit(trimmed)}
          >
            {submitLabel}
          </button>
          <button type="button" className="btn-secondary" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  );
}

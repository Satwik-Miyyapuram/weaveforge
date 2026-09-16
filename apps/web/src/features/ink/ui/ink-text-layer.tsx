"use client";

/**
 * The text-layer column: what recognition read, line by line, and the way to
 * put it right (§5.4).
 *
 * A line is a paragraph. One the engine was unsure of is dotted; clicking any
 * line opens it for correction, with the engine's alternatives as one-click
 * choices above a text field. Accepting marks the line certain, which is what
 * `recognisePage` honours on the next run — so a correction is made once.
 *
 * The column is presentational: it shows the lines it is given and reports an
 * accepted text. What that does to the page, the body and the sidecar is the
 * host's business.
 */

import { useEffect, useState } from "react";
import { isUnsureLine, type RecognisedLine } from "@weaveforge/core";

export interface InkTextLayerProps {
  /** The page's lines, in reading order; empty when nothing has been recognised. */
  lines: readonly RecognisedLine[];
  /** The page's mean confidence, shown in the heading. */
  confidence: number;
  /** "Line 3 of 12" while a run is on, `null` otherwise. */
  progress: string | null;
  /** Why no engine can run here, when that is the case. */
  unavailable: string | null;
  onAccept: (index: number, text: string) => void;
  /** The raw markdown/note text on this page, when available. */
  rawText?: string;
}

/** The class a line renders with: unsure lines are dotted, accepted ones plain. */
export function lineClass(line: RecognisedLine): string {
  if (line.conf >= 1) return "ink-line ink-line-sure";
  return isUnsureLine(line) ? "ink-line ink-line-unsure" : "ink-line";
}

export function InkTextLayer({
  lines,
  confidence,
  progress,
  unavailable,
  onAccept,
  rawText,
}: InkTextLayerProps) {
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState("");

  // A new page, or a run that replaced the lines, closes an open correction.
  useEffect(() => {
    setEditing(null);
  }, [lines]);

  const open = (index: number) => {
    setEditing(index);
    setDraft(lines[index]?.text ?? "");
  };

  const accept = (index: number, text: string) => {
    setEditing(null);
    if (
      text.trim() !== (lines[index]?.text ?? "").trim() ||
      (lines[index]?.conf ?? 0) < 1
    ) {
      onAccept(index, text.trim());
    }
  };

  return (
    <div className="ink-text" aria-label="Recognised text">
      <h4>
        Text layer{" "}
        <span className="ink-conf">
          {progress ?? `${Math.round(confidence * 100)} %`}
        </span>
      </h4>
      {unavailable ? <p className="ink-empty">{unavailable}</p> : null}
      {lines.length === 0 ? (
        rawText?.trim() ? (
          <div className="ink-text-raw" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {rawText.trim().split(/\r?\n\r?\n+/).map((para, index) => (
              <p key={index} className="ink-line ink-line-sure" style={{ margin: 0, whiteSpace: "pre-wrap" }}>
                {para}
              </p>
            ))}
          </div>
        ) : (
          <p className="ink-empty">
            Nothing recognised on this page yet. Recognise it to make the note
            searchable and linkable.
          </p>
        )
      ) : (
        lines.map((line, index) =>
          editing === index ? (
            <div key={index} className="ink-line-edit">
              {line.alternatives?.length ? (
                <div className="ink-alternatives">
                  {line.alternatives.map((alt) => (
                    <button
                      key={alt}
                      type="button"
                      className="ink-tool"
                      onClick={() => accept(index, alt)}
                    >
                      {alt}
                    </button>
                  ))}
                </div>
              ) : null}
              <input
                className="themed-input"
                autoFocus
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") accept(index, draft);
                  if (event.key === "Escape") setEditing(null);
                }}
                onBlur={() => accept(index, draft)}
                aria-label={`Correct line ${index + 1}`}
              />
            </div>
          ) : (
            <p
              key={index}
              className={lineClass(line)}
              title={
                line.conf >= 1
                  ? "Accepted"
                  : `Confidence ${Math.round(line.conf * 100)} % — click to correct`
              }
              onClick={() => open(index)}
            >
              {line.text || <span className="ink-empty">(unreadable)</span>}
            </p>
          ),
        )
      )}
    </div>
  );
}

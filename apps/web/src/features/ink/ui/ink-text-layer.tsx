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

import { useEffect, useMemo, useState } from "react";
import { isUnsureLine, type RecognisedLine } from "@weaveforge/core";
import { Markdown } from "@/components/markdown/markdown";
import { useWikilinkNavigation } from "@/lib/hooks/use-cite-links";
import { Button } from "@/components/button";

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

/** A typed page's text, rendered rather than printed, so `[[links]]` are links (E32). */
function InkRawText({ text }: { text: string }) {
  const { resolveWikilink, onWikilinkClick } = useWikilinkNavigation();
  const options = useMemo(() => ({ resolveWikilink }), [resolveWikilink]);
  return (
    <div className="ink-text-raw wikilink-markdown-scope" onClick={onWikilinkClick}>
      <Markdown options={options}>{text}</Markdown>
    </div>
  );
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
          <InkRawText text={rawText.trim()} />
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
                    <Button variant="ghost" size="sm"
                      key={alt}
                      // Keep focus in the field: its blur would accept the
                      // draft and unmount this button before the click lands.
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => accept(index, alt)}
                    >
                      {alt}
                    </Button>
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

/**
 * The minimap: a document's shape at a glance, and the fastest scroll
 * affordance on a full-height workspace screen.
 *
 * It is drawn from the *text*, not from the rendered DOM: a line is a bar whose
 * width and indent come from the line itself, which is what makes a long note's
 * structure visible without rendering it twice. A renderer that reports no text
 * — an ink page, §3.3 — has no minimap, and the pane lays out with the column
 * removed rather than showing an empty rail.
 *
 * Pure, so the two rules that matter are testable: how a line becomes a bar,
 * and where the window is in the document.
 */

import type { DocumentMetrics } from "./document-host";

export interface MinimapLine {
  /** 0–1, the bar's width as a share of the column. */
  width: number;
  /** Indent levels, from the line's own leading whitespace. */
  indent: number;
  /** A heading, at the level the markdown says. Rendered brighter. */
  heading: number;
  blank: boolean;
}

/** How many lines the minimap draws. Longer documents are sampled, not cut. */
export const MINIMAP_LINES = 220;

function measure(line: string): MinimapLine {
  const trimmed = line.trim();
  const indent = Math.min(Math.floor((line.length - line.trimStart().length) / 2), 6);
  const heading = /^(#{1,6})\s+/.exec(trimmed)?.[1]?.length ?? 0;
  // Normalised against a long line rather than the longest one in the document:
  // a single pasted paragraph should not flatten every other bar to a pixel.
  const width = Math.min(trimmed.length / 90, 1);
  return { width: Math.max(width, trimmed ? 0.06 : 0), indent, heading, blank: trimmed === "" };
}

/** The bars for a body, sampled evenly when it is longer than the column. */
export function minimapLines(body: string, limit = MINIMAP_LINES): MinimapLine[] {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  if (lines.length <= limit) return lines.map(measure);
  const step = lines.length / limit;
  const out: MinimapLine[] = [];
  for (let index = 0; index < limit; index++) out.push(measure(lines[Math.floor(index * step)] ?? ""));
  return out;
}

/** Where the viewport sits in the document, 0–1, or `null` when unknown. */
export function viewportFraction(
  metrics: DocumentMetrics | undefined,
  totalLines: number,
): number | null {
  if (!metrics?.cursor || totalLines <= 0) return null;
  return Math.min(Math.max(metrics.cursor.line / totalLines, 0), 1);
}

export function Minimap({
  body,
  fraction,
  onJump,
}: {
  body: string;
  /** 0–1, where the document is scrolled to. `null` hides the viewport bar. */
  fraction: number | null;
  /** A click at 0–1 of the column scrolls the document there. */
  onJump?: (fraction: number) => void;
}) {
  const bars = minimapLines(body);
  if (bars.length === 0) return null;

  return (
    <div
      className="minimap"
      aria-hidden="true"
      onClick={(event) => {
        if (!onJump) return;
        const box = event.currentTarget.getBoundingClientRect();
        onJump((event.clientY - box.top) / box.height);
      }}
    >
      <div className="minimap-lines">
        {bars.map((bar, index) => (
          <span
            key={index}
            className={`minimap-line${bar.heading ? ` is-h${Math.min(bar.heading, 3)}` : ""}${bar.blank ? " is-blank" : ""}`}
            style={{
              width: `${bar.width * 100}%`,
              marginInlineStart: `${bar.indent * 6}%`,
            }}
          />
        ))}
      </div>
      {fraction != null ? (
        <span className="minimap-viewport" style={{ top: `${fraction * 100}%` }} />
      ) : null}
    </div>
  );
}

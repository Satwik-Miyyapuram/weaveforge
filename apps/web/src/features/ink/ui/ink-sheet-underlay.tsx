"use client";

import { useEffect, useMemo, useRef } from "react";
import { renderMarkdownPlain } from "@/components/markdown/markdown";
import { upgradeMermaidFences } from "@/lib/mermaid-render";

/**
 * Text underlay for an ink page: renders the note's markdown/text content
 * directly on the paper sheet under the transparent ink drawing canvas.
 *
 * The text is rendered as markdown (headings, lists, math, tables, fenced
 * code) through the same renderer Read mode uses for prose, so an ink note
 * reads the same on the sheet as it does in the reader.
 *
 * `pointer-events: none` and `user-select: none` ensure that all pointer events
 * (stylus, touch, mouse) pass cleanly to the ink canvas so freehand writing,
 * highlighting and drawing work seamlessly over the text.
 */

/**
 * The underlay's geometry, shared with the text flow (§ink-text-flow).
 *
 * Every length is a page length — 0.1 mm units, scaled to the screen — not a
 * screen length. The font used to be `max(12, 15·scale)` px: at fit-width
 * that is 12 px, about 3 mm on the paper, and it did not grow with zoom
 * until 80 %. Handwriting with the default 0.3 mm pen is 4–5 mm tall, so what
 * was written could never be the size of the text beside it, and a page held
 * a different number of rows at every zoom. 4.8 mm type on a 7.2 mm pitch is
 * college-ruled paper written with a fine-liner: the text, the ruling and the
 * ink all live on the page, and zoom only magnifies.
 */
export const INK_UNDERLAY = {
  /** Top and bottom margin, 12 mm. */
  padY: (scale: number) => 120 * scale,
  /** Left and right margin, 15 mm. */
  padX: (scale: number) => 150 * scale,
  /** 4.8 mm — about 13.5 pt on paper, the height of a 0.3 mm pen's writing. */
  fontSize: (scale: number) => 48 * scale,
  /** 4.8 mm × 1.5 = 7.2 mm, the pitch of college-ruled paper. */
  lineHeight: 1.5,
};

/**
 * The sheet's ruling, as CSS variables: one rule per text row, the first one
 * on the underlay's top padding, so ruled and wide paper line up with the
 * rendered markdown at every zoom (the CSS pitch is read by `.paper-ruled`
 * and `.paper-wide`).
 */
export function inkSheetRuleStyle(scale: number): Record<`--${string}`, string> {
  const row = INK_UNDERLAY.fontSize(scale) * INK_UNDERLAY.lineHeight;
  return {
    "--ink-rule": `${row}px`,
    "--ink-rule-offset": `${INK_UNDERLAY.padY(scale)}px`,
  };
}

/**
 * Mermaid lays a diagram out at the document's 16 px (see the `.md-mermaid`
 * rule in editor-workspace.css); this is the whole-diagram zoom that brings it
 * to the sheet's text size.
 */
export function diagramZoom(fontSize: number): Record<"--ink-diagram-zoom", string> {
  return { "--ink-diagram-zoom": (fontSize / 16).toFixed(4) };
}

export function InkSheetTextUnderlay({
  text,
  scale,
}: {
  text: string;
  scale: number;
}) {
  const html = useMemo(() => (text.trim() ? renderMarkdownPlain(text) : ""), [text]);
  // One object per html string: React resets innerHTML whenever it sees a
  // new `dangerouslySetInnerHTML` object, and the host re-renders on every
  // pointer frame, which would wipe the mermaid upgrade below straight away.
  const markup = useMemo(() => ({ __html: html }), [html]);
  const ref = useRef<HTMLDivElement>(null);
  // Mermaid fences upgrade to diagrams after paint; the sync render above
  // already shows their source, so a note without one pays nothing.
  useEffect(() => {
    const root = ref.current;
    if (!root || !root.querySelector('pre[data-lang="mermaid"]')) return;
    const mode = document.documentElement.dataset.mode === "dark" ? "dark" : "light";
    void upgradeMermaidFences(root, mode);
  }, [html]);
  if (!html) return null;
  return (
    <div
      ref={ref}
      className="ink-sheet-text-underlay markdown"
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        padding: `${INK_UNDERLAY.padY(scale)}px ${INK_UNDERLAY.padX(scale)}px`,
        fontSize: `${INK_UNDERLAY.fontSize(scale)}px`,
        lineHeight: INK_UNDERLAY.lineHeight,
        ...diagramZoom(INK_UNDERLAY.fontSize(scale)),
        color: "var(--text)",
        pointerEvents: "none",
        userSelect: "none",
        zIndex: 0,
        overflow: "hidden",
        wordBreak: "break-word",
        opacity: 0.88,
      }}
      dangerouslySetInnerHTML={markup}
    />
  );
}

/** Extract human text from a page, excluding background and figure lines. */
export function pureInkPageText(text: string): string {
  const BACKGROUND = /^!\[page background\]\(vault:([^)\s]+)\)$/;
  const FIGURE = /^!\[figure ([^\]]*)\]\(vault:([^)\s]+)\)$/;
  return text
    .split(/\r?\n/)
    .filter((line) => !BACKGROUND.test(line.trim()) && !FIGURE.test(line.trim()))
    .join("\n")
    .trim();
}

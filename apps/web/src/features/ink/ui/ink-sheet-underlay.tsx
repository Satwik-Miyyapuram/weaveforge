"use client";

/**
 * Text underlay for an ink page: renders the note's markdown/text content
 * directly on the paper sheet under the transparent ink drawing canvas.
 *
 * `pointer-events: none` and `user-select: none` ensure that all pointer events
 * (stylus, touch, mouse) pass cleanly to the ink canvas so freehand writing,
 * highlighting and drawing work seamlessly over the text.
 */

export function InkSheetTextUnderlay({
  text,
  scale,
}: {
  text: string;
  scale: number;
}) {
  if (!text.trim()) return null;
  return (
    <div
      className="ink-sheet-text-underlay"
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        padding: `${Math.round(48 * scale)}px ${Math.round(56 * scale)}px`,
        fontSize: `${Math.max(12, Math.round(15 * scale))}px`,
        lineHeight: 1.6,
        color: "var(--text)",
        pointerEvents: "none",
        userSelect: "none",
        zIndex: 0,
        overflow: "hidden",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        opacity: 0.88,
      }}
    >
      {text}
    </div>
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

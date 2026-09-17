"use client";

/**
 * Text underlay for an ink page: renders the note's markdown/text content
 * directly on the paper sheet under the transparent ink drawing canvas.
 *
 * `pointer-events: none` and `user-select: none` ensure that all pointer events
 * (stylus, touch, mouse) pass cleanly to the ink canvas so freehand writing,
 * highlighting and drawing work seamlessly over the text.
 */

/** The underlay's geometry, shared with the text flow (§ink-text-flow). */
export const INK_UNDERLAY = {
  padY: (scale: number) => Math.round(48 * scale),
  padX: (scale: number) => Math.round(56 * scale),
  fontSize: (scale: number) => Math.max(12, Math.round(15 * scale)),
  lineHeight: 1.6,
};

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
        padding: `${INK_UNDERLAY.padY(scale)}px ${INK_UNDERLAY.padX(scale)}px`,
        fontSize: `${INK_UNDERLAY.fontSize(scale)}px`,
        lineHeight: INK_UNDERLAY.lineHeight,
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

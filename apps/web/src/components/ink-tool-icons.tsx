/**
 * The pen, highlighter, eraser and lasso glyphs.
 *
 * They live here, outside both features, because the ink note and the PDF
 * reader draw the same tools through the same bar (`features/ink/ui/ink-bar`)
 * and the glyphs are the one part of it that predates that: keeping them where
 * both can reach them is what let the two bars become one without a copy of
 * each icon.
 */

export type InkToolGlyph = "pen" | "highlighter" | "eraser" | "lasso";

const TOOL_PATHS: Record<InkToolGlyph, readonly string[]> = {
  pen: ["M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z", "m15 5 4 4"],
  highlighter: ["m9 11-6 6v3h3l6-6", "m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"],
  eraser: [
    "m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21",
    "M22 21H7",
    "m5 11 9 9",
  ],
  lasso: [
    "M7 22a5 5 0 0 1-2-4",
    "M3.3 14A6.8 6.8 0 0 1 2 10c0-4.4 4.5-8 10-8s10 3.6 10 8-4.5 8-10 8a12 12 0 0 1-5-1",
    "M5 18a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
  ],
};

export function toolIcon(tool: InkToolGlyph) {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {TOOL_PATHS[tool].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

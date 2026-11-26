import type { ReactNode } from "react";

export type Mode = "type" | "pen" | "eraser" | "select";

export function Glyph({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export const MODES: { mode: Mode; label: string; icon: ReactNode }[] = [
  { mode: "select", label: "Select", icon: <Glyph d="M5 3l13 8-5.5 1.5L15 19l-2.5 1-2.7-6.4L5 17z" /> },
  { mode: "type", label: "Type", icon: <Glyph d="M5 6V4h14v2M12 4v16M9 20h6" /> },
  { mode: "pen", label: "Pen", icon: <Glyph d="M4 20l1.2-4.2L15.8 5.2a2 2 0 0 1 2.8 0l.2.2a2 2 0 0 1 0 2.8L8.2 18.8z" /> },
  { mode: "eraser", label: "Eraser", icon: <Glyph d="M3 17l8.5-8.5a2 2 0 0 1 2.8 0l4.2 4.2a2 2 0 0 1 0 2.8L14 21H8zM7 12l5 5" /> },
];

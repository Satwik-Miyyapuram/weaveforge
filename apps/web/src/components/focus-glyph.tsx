/** The focus glyph: four corners drawn in (focus on) or out (enter focus). */
export function FocusGlyph({ on }: { on: boolean }) {
  const d = on
    ? "M9 3H4v5M15 3h5v5M9 21H4v-5M15 21h5v-5"
    : "M4 8V3h5M20 8V3h-5M4 16v5h5M20 16v5h-5";
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

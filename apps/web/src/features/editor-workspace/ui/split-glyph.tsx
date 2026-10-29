/** Two panes with the divider between them: the Split right / Split down icon. */
export function SplitGlyph({ direction }: { direction: "row" | "column" }) {
  // Two panes with the divider between them, drawn at the same weight as the
  // action set it replaces the two Unicode blocks of (`▥` and `▤`).
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {direction === "row" ? (
        <>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M12 4v16" />
        </>
      ) : (
        <>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M3 12h18" />
        </>
      )}
    </svg>
  );
}

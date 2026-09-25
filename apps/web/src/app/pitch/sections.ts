/**
 * The pitch page's sections, in reading order.
 *
 * The header nav renders from this list and the page's scrollspy marks the
 * entry whose `data-section` block is under the top third of the screen. It
 * lives in a plain module rather than inside `page.tsx` so the pairing is
 * testable without rendering the page — see `test/pitch-sections.test.ts`.
 */
export const SECTIONS: readonly PitchSection[] = [
  { id: "overview", label: "Overview" },
  { id: "chain", label: "The chain" },
  { id: "experiments", label: "Experiments" },
  { id: "labs", label: "Labs" },
  { id: "selfhost", label: "Self-host" },
  { id: "compare", label: "Compare" },
];

export interface PitchSection {
  id: string;
  label: string;
}

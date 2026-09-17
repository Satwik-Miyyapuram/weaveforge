/**
 * The pitch page's sections, in one list.
 *
 * Both navigation surfaces render from this — the desktop bar, which is hidden
 * below 1180px, and the "Sections" sheet, which only exists below it — so the
 * two cannot disagree about what the page contains or in what order. It lives in
 * a plain module rather than inside `page.tsx` so the guarantee is testable
 * without rendering the page (which imports eight CSS modules).
 *
 * `sep` is where the bar draws its divider. `low` marks the entries the bar
 * sheds first when the window is too narrow for all nine: the full set does not
 * fit beside the brand and the actions until the header's own measure, and a nav
 * that overflows is a nav with links nobody can reach.
 *
 * The order is the reading order, and `PitchPage`'s scrollspy registers the
 * same nine ids — see `test/pitch-sections.test.ts`, which pins that pairing.
 */
export const SECTIONS: readonly PitchSection[] = [
  { id: "overview", label: "Overview" },
  { id: "why", label: "Why", low: true, sep: "low" },
  { id: "chain", label: "The chain" },
  { id: "reading", label: "Reading" },
  { id: "experiments", label: "Experiments" },
  { id: "writing", label: "Writing", low: true, sep: "low" },
  { id: "labs", label: "Labs", low: true, sep: "plain" },
  { id: "selfhost", label: "Self-host" },
  { id: "compare", label: "Compare" },
];

export interface PitchSection {
  id: string;
  label: string;
  /** Shed first when the header is too narrow for the full set. */
  low?: boolean;
  /** Draw a divider after this entry, at the bar's own weight or the shed one. */
  sep?: "low" | "plain";
}

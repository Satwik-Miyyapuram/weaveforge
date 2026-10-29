/** What a settings rail group says about itself, before the build is known. */
export interface RailGroupWords {
  label: string;
  /** The label to use when the tab it names is hidden: "Account" with no lab tab. */
  labelWithout?: { tab: string; label: string };
  /** One word or phrase per tab, in rail order. The integrations tab's is filled in from config. */
  hints: readonly (readonly [tab: string, text: string])[];
}

/**
 * The label and hint a rail group shows, naming only the tabs this build
 * shows (DA-136). A hint used to be fixed text, so a Dev copy with no Zotero
 * still promised "Cloud, Zotero, calendar".
 */
export function railGroupText(
  group: RailGroupWords,
  visible: ReadonlySet<string>,
  integrationTitles: readonly string[],
): { label: string; hint: string } {
  const parts = group.hints
    .filter(([tab]) => visible.has(tab))
    .map(([tab, text]) => (tab === "integrations" ? integrationTitles.join(", ") : text))
    .filter(Boolean);
  const hint = parts.join(", ");
  const without = group.labelWithout;
  return {
    label: without && !visible.has(without.tab) ? without.label : group.label,
    hint: hint.charAt(0).toUpperCase() + hint.slice(1),
  };
}

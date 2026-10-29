/** How many citing papers a citation alert shows before "Show n more". */
const ALERT_TOP = 5;

/**
 * The short form of a citation-alert entry (DA-110): its text up to the fifth
 * listed paper, and how many listed papers that leaves out. Null for any other
 * entry, or an alert short enough to show whole.
 *
 * The "…and n more" line the alert writes after its list stays with the
 * hidden rows, so the expanded entry reads exactly as it was stored.
 */
export function collapseAlert(headline: string, rest: string): { shown: string; hidden: number } | null {
  if (!headline.startsWith("Citation alert:")) return null;
  const lines = rest.split("\n");
  const isItem = (line: string) => line.startsWith("- ");
  const isPaper = (line: string) => isItem(line) && !line.startsWith("- …and ");
  const papers = lines.filter(isPaper).length;
  if (papers <= ALERT_TOP) return null;

  let seen = 0;
  const shown = lines.filter((line) => !isItem(line) || (isPaper(line) && ++seen <= ALERT_TOP));
  return { shown: shown.join("\n").trim(), hidden: papers - ALERT_TOP };
}

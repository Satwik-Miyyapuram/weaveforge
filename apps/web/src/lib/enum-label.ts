/**
 * One label per enum value (D12, D-16): sentence case, fixed order, the same
 * words on every screen. A value with no entry is humanised, so a new enum value
 * still shows something readable until it gets its own label.
 */

const LABELS = {
  paperStatus: { to_read: "To read", reading: "Reading", read: "Done", skimmed: "Skimmed" },
  milestoneStatus: { planned: "Planned", in_progress: "In progress", done: "Done", blocked: "Blocked" },
  experimentStatus: { planned: "Planned", running: "Running", done: "Done", failed: "Failed", abandoned: "Abandoned" },
  relation: {
    cites: "Cites",
    extends: "Extends",
    contradicts: "Contradicts",
    similar: "Similar",
    builds_on: "Builds on",
    uses_method: "Uses method",
  },
  dependency: {
    milestone: "Another milestone",
    experiment: "An experiment",
    paper: "A paper",
    external: "Something outside WeaveForge",
  },
  shareAccess: { view: "Can view", comment: "Can comment", edit: "Can edit" },
} as const satisfies Record<string, Record<string, string>>;

export type EnumKind = keyof typeof LABELS;

/** "made_up_kind" reads "Made up kind". */
export function humanise(value: string): string {
  const words = value.replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
}

export function enumLabel(kind: EnumKind, value: string): string {
  const known = (LABELS[kind] as Record<string, string>)[value];
  return known ?? humanise(value);
}

/** Every value of an enum with its label, in the one fixed order. */
export function enumOptions(kind: EnumKind): Array<{ value: string; label: string }> {
  return Object.entries(LABELS[kind]).map(([value, label]) => ({ value, label }));
}

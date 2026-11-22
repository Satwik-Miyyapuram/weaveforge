/**
 * Columns that exist only on the server row and are never written to a file.
 * Verify ignores exactly these and compares every other server column. Keep
 * this list reviewed: a column added here stops being checked.
 */
const OWNER_COLUMNS = ["userId", "projectId"] as const;

/** Server stamps that the log, milestone, experiment and metric files do not keep. */
const STAMP_COLUMNS = ["updatedAt", "deletedAt"] as const;

export const SERVER_ONLY_FIELDS: Readonly<Record<string, readonly string[]>> = {
  logEntries: [...OWNER_COLUMNS, ...STAMP_COLUMNS],
  milestones: [...OWNER_COLUMNS, ...STAMP_COLUMNS],
  experiments: [...OWNER_COLUMNS, ...STAMP_COLUMNS],
  metrics: [...OWNER_COLUMNS, ...STAMP_COLUMNS],
  reportSections: [...OWNER_COLUMNS, "deletedAt"],
  aiProposals: [...OWNER_COLUMNS, "deletedAt"],
  annotations: OWNER_COLUMNS,
  annotationPins: OWNER_COLUMNS,
  blobs: OWNER_COLUMNS,
  ink: OWNER_COLUMNS,
  tags: OWNER_COLUMNS,
};

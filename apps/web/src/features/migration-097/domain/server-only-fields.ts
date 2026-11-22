/**
 * Columns that exist only on the server row and are never written to a file.
 * Verify ignores exactly these and compares every other server column. Keep
 * this list reviewed: a column added here stops being checked.
 */
const OWNER_COLUMNS = ["userId", "project_id"] as const;

export const SERVER_ONLY_FIELDS: Readonly<Record<string, readonly string[]>> = {
  logEntries: OWNER_COLUMNS,
  milestones: OWNER_COLUMNS,
  experiments: OWNER_COLUMNS,
  metrics: OWNER_COLUMNS,
  reportSections: OWNER_COLUMNS,
  aiProposals: OWNER_COLUMNS,
  annotations: OWNER_COLUMNS,
  annotationPins: OWNER_COLUMNS,
  blobs: OWNER_COLUMNS,
  ink: OWNER_COLUMNS,
  tags: OWNER_COLUMNS,
};

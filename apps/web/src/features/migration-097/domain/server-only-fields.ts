/**
 * Columns that exist only on the server row and are never written to a file.
 * Verify ignores exactly these and compares every other server column. Keep
 * this list reviewed: a column added here stops being checked.
 */
const OWNER_COLUMNS = ["userId", "projectId"] as const;

/** Server stamps that the log, milestone, experiment and metric files do not keep. */
const STAMP_COLUMNS = ["updatedAt", "deletedAt"] as const;

/** Sync counters of the old database: they mean nothing once the row is a file. */
const SYNC_COLUMNS = ["serverSeq", "rowVersion", "snapshotUpto"] as const;

/** user_settings columns that hold credentials (0006, 0022, 0069): never written to a file, so never compared. */
export const SETTINGS_SECRET_COLUMNS = ["zoteroApiKey", "semanticScholarKey", "credentialsEnc", "integrations"] as const;

export const SERVER_ONLY_FIELDS: Readonly<Record<string, readonly string[]>> = {
  settings: [...OWNER_COLUMNS, ...SETTINGS_SECRET_COLUMNS, "updatedAt"],
  logEntries: [...OWNER_COLUMNS, ...STAMP_COLUMNS, ...SYNC_COLUMNS],
  milestones: [...OWNER_COLUMNS, ...STAMP_COLUMNS, ...SYNC_COLUMNS],
  experiments: [...OWNER_COLUMNS, ...STAMP_COLUMNS, ...SYNC_COLUMNS],
  metrics: [...OWNER_COLUMNS, ...STAMP_COLUMNS, ...SYNC_COLUMNS],
  // The file repo stamps its own revision (the AI report_edit check), so the server stamp is not compared.
  reportSections: [...OWNER_COLUMNS, ...STAMP_COLUMNS, ...SYNC_COLUMNS],
  readingLists: [...OWNER_COLUMNS, "deletedAt", ...SYNC_COLUMNS],
  aiProposals: [...OWNER_COLUMNS, "deletedAt"],
  // paperFile is the exporter's path to the paper, not a DB column; syncState is local bookkeeping.
  annotations: [...OWNER_COLUMNS, "paperFile", "syncState", "deletedAt", ...SYNC_COLUMNS],
  annotationPins: [...OWNER_COLUMNS, "deletedAt", ...SYNC_COLUMNS],
  blobs: OWNER_COLUMNS,
  ink: OWNER_COLUMNS,
  // A tag file keeps its name and colour only.
  tags: [...OWNER_COLUMNS, "createdAt", "deletedAt", ...SYNC_COLUMNS],
  paperFields: OWNER_COLUMNS,
  // Sync and search bookkeeping the note and paper files never hold.
  notes: [...OWNER_COLUMNS, "serverSeq", "rowVersion", "snapshotUpto", "bodyPreview", "deletedAt"],
  papers: [...OWNER_COLUMNS, "doiBidx", "arxivBidx", "serverSeq", "rowVersion", "deletedAt"],
  // A value's file id is `<paper id>:<field id>`, not the server row id, so `id` is not compared either.
  paperFieldValues: ["id", ...OWNER_COLUMNS, "deletedAt", ...SYNC_COLUMNS],
  // A relation is a link in a paper file, keyed by its two papers and its name.
  relations: ["id", ...OWNER_COLUMNS, ...STAMP_COLUMNS, ...SYNC_COLUMNS, "createdAt"],
  screening: [...OWNER_COLUMNS, "deletedAt", ...SYNC_COLUMNS],
  // A pinned paper is `pinned: true` in its own file, which has no pin id, owner or date.
  libraryPins: ["id", "ownerId", "createdAt", ...OWNER_COLUMNS, "deletedAt", ...SYNC_COLUMNS],
  // Membership is a link in the member's file: its id is `<list>:<member>` and its order is the list's.
  readingListItems: ["id", "sortOrder", "inheritedFromListId", "duplicateOfItemId", "deletedAt", ...SYNC_COLUMNS],
  quotationTypes: ["id", ...OWNER_COLUMNS],
  citationAlerts: OWNER_COLUMNS,
};

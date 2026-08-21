/**
 * R5 Zotero write-back — pure ports and conflict math.
 * Live API mutation is intentionally not here; unsupervised runs dry-run only.
 */

import type { ReaderAnnotation, ReaderAnnotationType, AnnotationSyncState } from "./reader-annotation.js";
import type { CombinedPdfAnchor } from "./anchor-strategy.js";

/** Per-library write-back mode. */
export type ZoteroLibrarySyncMode = "bidirectional" | "read_only" | "ignored";

export const ZOTERO_LIBRARY_SYNC_MODES: readonly ZoteroLibrarySyncMode[] = [
  "bidirectional",
  "read_only",
  "ignored",
] as const;

export function isZoteroLibrarySyncMode(value: string): value is ZoteroLibrarySyncMode {
  return (ZOTERO_LIBRARY_SYNC_MODES as readonly string[]).includes(value);
}

export interface ZoteroAnnotationRemote {
  key: string;
  version: number;
  type: ReaderAnnotationType;
  color: string;
  text: string;
  comment: string;
  tags: string[];
  anchor: CombinedPdfAnchor;
  sortIndex: string;
  updatedAt: string;
}

type AnnotationConflictField =
  | "color"
  | "text"
  | "comment"
  | "tags"
  | "anchor"
  | "type"
  | "sortIndex";

export interface AnnotationFieldConflict {
  field: AnnotationConflictField;
  local: unknown;
  remote: unknown;
}

export type AnnotationSyncDecision =
  | { kind: "push"; reason: string }
  | { kind: "pull"; reason: string }
  | { kind: "noop"; reason: string }
  | { kind: "conflict"; fields: AnnotationFieldConflict[]; reason: string }
  | { kind: "skip"; reason: string };

export interface AnnotationSyncRow {
  local: ReaderAnnotation & {
    syncState: AnnotationSyncState;
    zoteroVersion: number | null;
  };
  remote: ZoteroAnnotationRemote | null;
}

const COMPARABLE_FIELDS: AnnotationConflictField[] = [
  "color",
  "text",
  "comment",
  "tags",
  "anchor",
  "type",
  "sortIndex",
];

function fieldValue(
  source: "local" | "remote",
  row: AnnotationSyncRow,
  field: AnnotationConflictField,
): unknown {
  if (source === "local") {
    if (field === "type") return row.local.type;
    if (field === "sortIndex") return row.local.sortIndex;
    if (field === "tags") return [...row.local.tags];
    if (field === "anchor") return row.local.anchor;
    return row.local[field];
  }
  if (!row.remote) return undefined;
  if (field === "type") return row.remote.type;
  if (field === "sortIndex") return row.remote.sortIndex;
  if (field === "tags") return [...row.remote.tags];
  if (field === "anchor") return row.remote.anchor;
  return row.remote[field];
}

function valuesEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Diff local vs remote annotation fields. */
export function diffAnnotationFields(row: AnnotationSyncRow): AnnotationFieldConflict[] {
  if (!row.remote) return [];
  const out: AnnotationFieldConflict[] = [];
  for (const field of COMPARABLE_FIELDS) {
    const local = fieldValue("local", row, field);
    const remote = fieldValue("remote", row, field);
    if (!valuesEqual(local, remote)) {
      out.push({ field, local, remote });
    }
  }
  return out;
}

/**
 * Decide push/pull/conflict for one annotation given library mode and versions.
 * Never mutates; callers apply the decision via a sink or dry-run log.
 */
export function decideAnnotationSync(
  row: AnnotationSyncRow,
  mode: ZoteroLibrarySyncMode,
): AnnotationSyncDecision {
  if (mode === "ignored") {
    return { kind: "skip", reason: "Library sync mode is ignored." };
  }
  if (mode === "read_only") {
    if (!row.remote) {
      return { kind: "skip", reason: "Read-only library; local-only annotation is not pushed." };
    }
    const fields = diffAnnotationFields(row);
    if (fields.length === 0) return { kind: "noop", reason: "Already matches remote." };
    return { kind: "pull", reason: "Read-only library accepts remote." };
  }

  // bidirectional
  if (!row.remote) {
    return { kind: "push", reason: "No remote counterpart; push local." };
  }

  const localVersion = row.local.zoteroVersion;
  const remoteVersion = row.remote.version;
  const fields = diffAnnotationFields(row);

  if (fields.length === 0) {
    return { kind: "noop", reason: "Local and remote are identical." };
  }

  if (localVersion == null) {
    return {
      kind: "conflict",
      fields,
      reason: "Local never synced but remote exists; resolve field conflicts.",
    };
  }

  if (remoteVersion > localVersion) {
    // Remote moved ahead — if local also dirty (pending), conflict; else pull.
    if (row.local.syncState === "pending" || row.local.syncState === "conflict") {
      return {
        kind: "conflict",
        fields,
        reason: "Remote version ahead while local has pending edits.",
      };
    }
    return { kind: "pull", reason: "Remote version is newer." };
  }

  if (remoteVersion < localVersion) {
    return {
      kind: "conflict",
      fields,
      reason: "Local version is ahead of remote (unexpected); resolve manually.",
    };
  }

  // Same version but fields differ — both edited since last sync.
  return {
    kind: "conflict",
    fields,
    reason: "Same zotero_version but fields diverge.",
  };
}

export type ConflictResolveChoice = "keep_local" | "accept_remote" | "merge";

/**
 * Apply a field-level conflict resolution choice. Merge prefers local comment/tags
 * and remote color/text when both changed; otherwise keeps local for unresolved.
 */
export function resolveAnnotationConflict(
  row: AnnotationSyncRow,
  choice: ConflictResolveChoice,
): ReaderAnnotation | null {
  if (!row.remote) return structuredClone(row.local);
  if (choice === "keep_local") return structuredClone(row.local);
  if (choice === "accept_remote") {
    return {
      ...structuredClone(row.local),
      type: row.remote.type,
      color: row.remote.color,
      text: row.remote.text,
      comment: row.remote.comment,
      tags: [...row.remote.tags],
      anchor: structuredClone(row.remote.anchor),
      sortIndex: row.remote.sortIndex,
      zoteroKey: row.remote.key,
      updatedAt: row.remote.updatedAt,
    };
  }
  // merge
  const fields = diffAnnotationFields(row);
  const changed = new Set(fields.map((f) => f.field));
  const merged: ReaderAnnotation = structuredClone(row.local);
  merged.zoteroKey = row.remote.key;
  if (changed.has("color")) merged.color = row.remote.color;
  if (changed.has("text")) merged.text = row.remote.text;
  // keep local comment/tags on merge (researcher prose wins)
  if (changed.has("anchor") && !changed.has("text")) {
    merged.anchor = structuredClone(row.remote.anchor);
  }
  return merged;
}

/** Payload shape for a Zotero Web API annotation create/update (dry-run). */
export interface ZoteroAnnotationWritePayload {
  itemType: "annotation";
  parentItem: string;
  annotationType: ReaderAnnotationType;
  annotationText: string;
  annotationComment: string;
  annotationColor: string;
  annotationSortIndex: string;
  annotationPosition: CombinedPdfAnchor["zoteroPosition"];
  tags: { tag: string }[];
}

export function toZoteroWritePayload(
  ann: ReaderAnnotation,
  parentItemKey: string,
): ZoteroAnnotationWritePayload {
  return {
    itemType: "annotation",
    parentItem: parentItemKey,
    annotationType: ann.type,
    annotationText: ann.text,
    annotationComment: ann.comment,
    annotationColor: ann.color,
    annotationSortIndex: ann.sortIndex,
    annotationPosition: ann.anchor.zoteroPosition,
    tags: ann.tags.map((tag) => ({ tag })),
  };
}

export interface IZoteroAnnotationWriteBack {
  /**
   * Dry-run by default. Live implementations must require an explicit
   * `{ live: true }` flag and human-supervised credentials.
   */
  push(
    parentItemKey: string,
    annotations: readonly ReaderAnnotation[],
    options?: { live?: boolean },
  ): Promise<{ dryRun: boolean; payloads: ZoteroAnnotationWritePayload[] }>;
}

export class DryRunZoteroAnnotationWriteBack implements IZoteroAnnotationWriteBack {
  async push(
    parentItemKey: string,
    annotations: readonly ReaderAnnotation[],
    options?: { live?: boolean },
  ): Promise<{ dryRun: boolean; payloads: ZoteroAnnotationWritePayload[] }> {
    if (options?.live) {
      throw new Error(
        "Live Zotero write-back is disabled in DryRunZoteroAnnotationWriteBack — needs human-supervised credentials (R5).",
      );
    }
    return {
      dryRun: true,
      payloads: annotations.map((a) => toZoteroWritePayload(a, parentItemKey)),
    };
  }
}

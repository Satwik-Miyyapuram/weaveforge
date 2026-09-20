import type { CompactCrdtLogUseCase, ICrdtUpdateStore } from "@weaveforge/core";

/**
 * Runtime collab session deps (wired in bootstrap; no Supabase types in UI).
 *
 * There is deliberately no `setSnapshotUpto`. Compaction moves the watermark
 * inside `compact_crdt_log`, in the same transaction as the sweep and behind an
 * owner-or-edit check; a separate way to write it is a way to write it *without*
 * either, which is what the two-call version did — a collaborator's filtered
 * delete advanced the shared watermark and made the rows it should have removed
 * unsweepable for the owner afterwards.
 */
export interface CollabSession {
  crdtStore: ICrdtUpdateStore;
  /** Realtime client — typed as opaque in UI; EncryptedYjsProvider narrows in infrastructure. */
  db: unknown;
  projectId: () => string | null;
  compactCrdtLog: CompactCrdtLogUseCase;
  getSnapshotUpto: () => Promise<number>;
}

export interface CollabSnapshotHelpers {
  getSnapshotUpto: () => Promise<number>;
  compactCrdtLog: CompactCrdtLogUseCase;
}

import type { CompactCrdtLogUseCase, ICrdtUpdateStore } from "@weaveforge/core";

/** Runtime collab session deps (wired in bootstrap; no Supabase types in UI). */
export interface CollabSession {
  crdtStore: ICrdtUpdateStore;
  /** Realtime client — typed as opaque in UI; EncryptedYjsProvider narrows in infrastructure. */
  db: unknown;
  projectId: () => string | null;
  compactCrdtLog: CompactCrdtLogUseCase;
  getSnapshotUpto: () => Promise<number>;
  setSnapshotUpto: (uptoId: number) => Promise<void>;
}

export interface CollabSnapshotHelpers {
  getSnapshotUpto: () => Promise<number>;
  setSnapshotUpto: (uptoId: number) => Promise<void>;
  compactCrdtLog: CompactCrdtLogUseCase;
}

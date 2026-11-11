import type { CompactCrdtLogUseCase, ICrdtUpdateStore } from "@weaveforge/core";
import type { Peer } from "../domain/presence";

// --- collab-session ---
/**
 * Runtime collab session deps (wired in bootstrap; no supabase-js types in UI).
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
  /** Realtime client — typed as opaque in UI; RealtimeYjsProvider narrows in infrastructure. */
  db: unknown;
  projectId: () => string | null;
  compactCrdtLog: CompactCrdtLogUseCase;
  getSnapshotUpto: () => Promise<number>;
}

export interface CollabSnapshotHelpers {
  getSnapshotUpto: () => Promise<number>;
  compactCrdtLog: CompactCrdtLogUseCase;
}

// --- presence-store ---
/**
 * Who is in each open document, keyed `<kind>:<id>` like a workspace tab.
 * The collab editor publishes; the pane's tab strip reads it to draw avatars.
 */
const byDoc = new Map<string, readonly Peer[]>();
const listeners = new Set<() => void>();
const NONE: readonly Peer[] = [];

export function publishPeers(docKey: string, peers: readonly Peer[]): void {
  if (peers.length === 0 && !byDoc.has(docKey)) return;
  if (peers.length === 0) byDoc.delete(docKey);
  else byDoc.set(docKey, peers);
  for (const listener of [...listeners]) listener();
}

export function peersFor(docKey: string): readonly Peer[] {
  return byDoc.get(docKey) ?? NONE;
}

export function subscribePeers(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

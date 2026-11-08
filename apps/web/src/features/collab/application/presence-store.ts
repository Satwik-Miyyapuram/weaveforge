import type { Peer } from "../domain/presence";

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

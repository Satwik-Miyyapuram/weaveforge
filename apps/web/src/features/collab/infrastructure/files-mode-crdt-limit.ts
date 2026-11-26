import type { CrdtUpdateRecord, ICrdtUpdateStore } from "@weaveforge/core";
import type { CrdtSnapshotStore } from "./parts";

/**
 * The resource types the server CRDT log may still hold in files mode. Every
 * other type is personal document data that now lives in the folder.
 */
export const FILES_MODE_CRDT_TYPES: readonly string[] = ["experiment", "lab_snapshot"];

export const FILES_MODE_CRDT_MESSAGE = "personal CRDT updates are not stored on the server in files mode";

/** The live-sync banner text for a transport error; null for the files-mode refusal, which is expected (the folder holds the note). */
export function transportBanner(stage: string, detail: string): string | null {
  return detail.includes(FILES_MODE_CRDT_MESSAGE) ? null : `${stage}: ${detail}`;
}

/**
 * Wraps the CRDT update log so that, for any type outside `allowed`, writes are
 * refused (nothing reaches the server) and reads see an empty log (the server's
 * old personal rows are not replayed into a folder document).
 */
export function limitCrdtUpdateStore(inner: ICrdtUpdateStore, allowed: readonly string[]): ICrdtUpdateStore {
  const permitted = (type: string) => allowed.includes(type);
  const refuse = () => Promise.reject(new Error(FILES_MODE_CRDT_MESSAGE));
  return {
    append: (input) => (permitted(input.resourceType) ? inner.append(input) : refuse()),
    listAfter: (type, id, afterId) => (permitted(type) ? inner.listAfter(type, id, afterId) : Promise.resolve<CrdtUpdateRecord[]>([])),
    countAfter: (type, id, afterId) => (permitted(type) ? inner.countAfter(type, id, afterId) : Promise.resolve(0)),
    deleteUpTo: (type, id, uptoId) => (permitted(type) ? inner.deleteUpTo(type, id, uptoId) : refuse()),
    compact: (input) => (permitted(input.resourceType) ? inner.compact(input) : refuse()),
  };
}

/** Personal types have no watermark on the server in files mode. */
export function limitCrdtSnapshotStore(inner: CrdtSnapshotStore, allowed: readonly string[]): CrdtSnapshotStore {
  return {
    getSnapshotUpto: (type, id) => (allowed.includes(type) ? inner.getSnapshotUpto(type, id) : Promise.resolve(0)),
  };
}

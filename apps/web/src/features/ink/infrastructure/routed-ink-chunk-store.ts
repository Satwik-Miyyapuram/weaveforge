/**
 * The store the app hands the host: the folder while one is open, the bucket
 * otherwise, decided per call rather than per session because a folder can be
 * opened or closed while a note is on screen.
 */

import type { InkChunkStore } from "../application/ink-chunk-store";

export class RoutedInkChunkStore implements InkChunkStore {
  constructor(private readonly pick: () => InkChunkStore) {}

  read(noteId: string, chunkId: string) {
    return this.pick().read(noteId, chunkId);
  }
  write(noteId: string, chunkId: string, bytes: Uint8Array) {
    return this.pick().write(noteId, chunkId, bytes);
  }
  remove(noteId: string, chunkId: string) {
    return this.pick().remove(noteId, chunkId);
  }
  list(noteId: string) {
    return this.pick().list(noteId);
  }
}

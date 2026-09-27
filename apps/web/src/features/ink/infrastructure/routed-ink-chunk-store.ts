/**
 * The store the app hands the host: the folder while one is open, the bucket
 * otherwise, decided per call rather than per session because a folder can be
 * opened or closed while a note is on screen.
 *
 * `ready` holds every call until the remembered folder has been taken back up
 * at launch. Without it a note opened straight away was read from the bucket,
 * found nothing there, and showed its pages empty until it was opened again.
 */

import type { InkChunkStore } from "../application/ink-chunk-store";

export class RoutedInkChunkStore implements InkChunkStore {
  constructor(
    private readonly pick: () => InkChunkStore,
    private readonly ready: () => Promise<void> = () => Promise.resolve(),
  ) {}

  private async store() {
    await this.ready();
    return this.pick();
  }

  async read(noteId: string, chunkId: string) {
    return (await this.store()).read(noteId, chunkId);
  }
  async write(noteId: string, chunkId: string, bytes: Uint8Array) {
    return (await this.store()).write(noteId, chunkId, bytes);
  }
  async remove(noteId: string, chunkId: string) {
    return (await this.store()).remove(noteId, chunkId);
  }
  async list(noteId: string) {
    return (await this.store()).list(noteId);
  }
}

/**
 * The store the app hands the host: the folder while one is open, the bucket
 * otherwise, decided per call rather than per session because a folder can be
 * opened or closed while a note is on screen.
 *
 * `ready` holds every call until the remembered folder has been taken back up
 * at launch. Without it a note opened straight away was read from the bucket,
 * found nothing there, and showed its pages empty until it was opened again.
 *
 * One home per stroke set, and it is whichever store the call picks. A page
 * drawn with a folder open is written to the folder and is not also written to
 * the bucket, so two devices' pages meet where their homes meet -- a folder
 * both machines can see, or one account's bucket. They do not meet by
 * themselves across a folder and a bucket, which is the one thing about
 * overlapping handwriting that a reader can be surprised by: the note's text
 * merges across devices, its strokes stay where they were drawn.
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

/**
 * Chunks in the encrypted blob bucket the vault's assets already use.
 *
 * The path mirrors the folder layout under the user's prefix —
 * `<userId>/<noteId>/ink/<ulid>.inkb` — so the row the bucket's policy keys on
 * is the same one every other vault asset uses. The bucket cannot be listed
 * from here, so `list` answers `null` and the note's declared order is the
 * whole truth; a chunk this store holds that no note names is unreachable,
 * which is the trade the plan accepts for the cloud path.
 */

import {
  INK_CHUNK_EXT,
  isInkChunkId,
  isInkNoteId,
  type IBlobFetcher,
  type ICurrentUserProvider,
} from "@weaveforge/core";

import type { InkChunkStore } from "../application/ink-chunk-store";

export const INK_CHUNK_BUCKET = "vault-assets";
export const INK_CHUNK_CONTENT_TYPE = "application/octet-stream";

export class BlobInkChunkStore implements InkChunkStore {
  constructor(
    private readonly blobs: IBlobFetcher,
    private readonly session: ICurrentUserProvider,
    private readonly bucket = INK_CHUNK_BUCKET,
  ) {}

  private async path(noteId: string, chunkId: string): Promise<string> {
    if (!isInkNoteId(noteId))
      throw new Error(`ink: unusable note id ${JSON.stringify(noteId)}`);
    if (!isInkChunkId(chunkId))
      throw new Error(`ink: unusable chunk id ${JSON.stringify(chunkId)}`);
    const userId = await this.session.requireUserId();
    return `${userId}/${noteId}/ink/${chunkId}${INK_CHUNK_EXT}`;
  }

  async read(noteId: string, chunkId: string): Promise<Uint8Array | null> {
    try {
      return await this.blobs.fetchBytes(
        this.bucket,
        await this.path(noteId, chunkId),
      );
    } catch {
      // The fetcher throws for "not there" and for "not reachable" alike. Either
      // way the page opens empty rather than not at all, and the first save
      // writes what the user draws.
      return null;
    }
  }

  async write(
    noteId: string,
    chunkId: string,
    bytes: Uint8Array,
  ): Promise<void> {
    const blob = new Blob([bytes as BlobPart], {
      type: INK_CHUNK_CONTENT_TYPE,
    });
    await this.blobs.upload(
      this.bucket,
      await this.path(noteId, chunkId),
      blob,
      INK_CHUNK_CONTENT_TYPE,
    );
  }

  async remove(noteId: string, chunkId: string): Promise<void> {
    await this.blobs.remove(this.bucket, await this.path(noteId, chunkId));
  }

  async list(): Promise<null> {
    return null;
  }
}

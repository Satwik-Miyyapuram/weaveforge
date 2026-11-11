import { readyCore, typedCore } from "@/lib/rust-core";
import {
  BlobNotFoundError,
  type IBlobFetcher,
  type ICurrentUserProvider,
  INK_CHUNK_EXT,
  type IWorkspaceFs,
} from "@weaveforge/core";
import type { InkChunkStore } from "../application/parts-1";

// --- blob-ink-chunk-store ---
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
export const INK_CHUNK_BUCKET = "vault-assets";
export const INK_CHUNK_CONTENT_TYPE = "application/octet-stream";

export class BlobInkChunkStore implements InkChunkStore {
  constructor(
    private readonly blobs: IBlobFetcher,
    private readonly session: ICurrentUserProvider,
    private readonly bucket = INK_CHUNK_BUCKET,
  ) {}

  private async path(noteId: string, chunkId: string): Promise<string> {
    if (!typedCore().isInkNoteId(noteId))
      throw new Error(`ink: unusable note id ${JSON.stringify(noteId)}`);
    if (!readyCore().isInkChunkId(chunkId))
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
    } catch (err) {
      // Only "not there" is an empty page. A read that failed (offline, a
      // server error, a bad decrypt) is thrown, so the page is not mistaken
      // for an empty one and saved over.
      if (err instanceof BlobNotFoundError) return null;
      throw err;
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

// --- fs-ink-chunk-store ---
/**
 * Chunks in the workspace folder: `.ink/<weaveforge-id>/<ulid>.inkb` (§4.1).
 *
 * The folder is the mirror the user can see, sync and put under git, so this
 * is the store that makes an ink note an ordinary file. It lists the directory,
 * which is what lets a chunk another device wrote appear as an orphan page.
 *
 * That listing is also why handwriting from two sides overlaps instead of
 * fighting: a note has no single "current strokes" value to replace, only a
 * directory of pages. A write adds one, a remove takes the one it names, and
 * nothing here removes a directory -- so settling the text of a note that both
 * sides drew on leaves every page where it was, and the two sets are drawn
 * together.
 */
export class FsInkChunkStore implements InkChunkStore {
  constructor(private readonly fs: () => IWorkspaceFs | null) {}

  private require(): IWorkspaceFs {
    const fs = this.fs();
    if (!fs) throw new Error("ink: no workspace folder is open");
    return fs;
  }

  async read(noteId: string, chunkId: string): Promise<Uint8Array | null> {
    const fs = this.fs();
    if (!fs) return null;
    const path = typedCore().inkChunkPath(noteId, chunkId);
    if (!(await fs.stat(path))) return null;
    return fs.readFile(path);
  }

  async write(
    noteId: string,
    chunkId: string,
    bytes: Uint8Array,
  ): Promise<void> {
    const fs = this.require();
    await fs.mkdirp(typedCore().inkSidecarDir(noteId));
    await fs.writeFile(typedCore().inkChunkPath(noteId, chunkId), bytes);
  }

  async remove(noteId: string, chunkId: string): Promise<void> {
    const fs = this.require();
    const path = typedCore().inkChunkPath(noteId, chunkId);
    if (await fs.stat(path)) await fs.remove(path);
  }

  async list(noteId: string): Promise<string[] | null> {
    const fs = this.fs();
    if (!fs) return null;
    const dir = typedCore().inkSidecarDir(noteId);
    if (!(await fs.stat(dir))) return [];
    const ids: string[] = [];
    for (const entry of await fs.list(dir)) {
      if (entry.kind !== "file") continue;
      const id = readyCore().inkChunkIdOfFileName(entry.path.split("/").pop() ?? "");
      if (id) ids.push(id);
    }
    return ids.sort();
  }
}

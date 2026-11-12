import { readyCore, typedCore } from "@/lib/rust-core";
import {
  BlobNotFoundError,
  type IBlobFetcher,
  type ICurrentUserProvider,
  type IWorkspaceFs,
} from "@weaveforge/core";
import type { InkChunkStore } from "../application/parts-1";

// --- blob-ink-chunk-store ---
/**
 * Chunks in the encrypted blob bucket the vault's assets already use.
 *
 * The key (bucket, content type and `<userId>/<noteId>/ink/<ulid>.inkb` layout)
 * is built by Rust, so the row the bucket's policy keys on is the same one every
 * other vault asset uses. The bucket cannot be listed from here, so `list`
 * answers `null` and the note's declared order is the whole truth; a chunk this
 * store holds that no note names is unreachable, which is the trade the plan
 * accepts for the cloud path.
 */
export class BlobInkChunkStore implements InkChunkStore {
  constructor(
    private readonly blobs: IBlobFetcher,
    private readonly session: ICurrentUserProvider,
  ) {}

  private async path(noteId: string, chunkId: string): Promise<string> {
    // Ids are checked before the user, as they were before the key moved to
    // Rust: a bad note id reports first, then a bad chunk id.
    readyCore().inkSidecarDir(noteId);
    readyCore().inkChunkPath(noteId, chunkId);
    const userId = await this.session.requireUserId();
    return readyCore().inkChunkBlobKey(userId, noteId, chunkId);
  }

  async read(noteId: string, chunkId: string): Promise<Uint8Array | null> {
    try {
      return await this.blobs.fetchBytes(
        readyCore().inkChunkBlobSpec().bucket,
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
    const { bucket, contentType } = readyCore().inkChunkBlobSpec();
    const blob = new Blob([bytes as BlobPart], { type: contentType });
    await this.blobs.upload(
      bucket,
      await this.path(noteId, chunkId),
      blob,
      contentType,
    );
  }

  async remove(noteId: string, chunkId: string): Promise<void> {
    await this.blobs.remove(
      readyCore().inkChunkBlobSpec().bucket,
      await this.path(noteId, chunkId),
    );
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
    const files = (await fs.list(dir))
      .filter((entry) => entry.kind === "file")
      .map((entry) => entry.path);
    return readyCore().inkChunkIdsInListing(files);
  }
}

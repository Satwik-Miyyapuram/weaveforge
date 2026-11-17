import { readyCore, typedCore } from "@/lib/rust-core";
import {
  BlobNotFoundError,
  type IBlobFetcher,
  type ICurrentUserProvider,
  type IWorkspaceFs,
} from "@weaveforge/core";
import {
  InkNoFolderError,
  type InkChunkStore,
  type InkMigrationMarks,
} from "../application/parts-1";

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

// --- unavailable-ink-chunk-store ---
/**
 * The desktop with no workspace folder open. Ink has nowhere to go there, so
 * every call fails loudly; the bucket is never used on the desktop.
 */
export class UnavailableInkChunkStore implements InkChunkStore {
  async read(_noteId: string, _chunkId: string): Promise<never> {
    throw new InkNoFolderError();
  }
  async write(_noteId: string, _chunkId: string, _bytes: Uint8Array): Promise<never> {
    throw new InkNoFolderError();
  }
  async remove(_noteId: string, _chunkId: string): Promise<never> {
    throw new InkNoFolderError();
  }
  async list(_noteId: string): Promise<never> {
    throw new InkNoFolderError();
  }
}

// --- copy-on-read-ink-chunk-store ---
/**
 * The desktop's folder store, with the legacy bucket behind it for migration.
 *
 * `prepareNote` (run by every load) copies each declared page the folder lacks
 * from the bucket, reads it back, and only when every declared page is in the
 * folder or confirmed absent from the bucket writes the note's migrated
 * marker. A marked note never asks the bucket again, so a page erased here or
 * by a pull stays erased. The bucket is never written or removed here.
 *
 * Before the marker, only pages the note declared when it was opened can be in
 * the bucket. A page minted on this device since (a fresh note's first page, a
 * page added, a page written or erased here) is answered from the folder
 * alone, so an offline or signed-out bucket cannot make it unreadable. A
 * declared legacy page whose bucket read fails still throws: it may hold
 * strokes, and saving over it would lose them.
 */
export class CopyOnReadInkChunkStore implements InkChunkStore {
  /** Per note, this session: ids the note declared when opened, so maybe in the bucket. */
  private readonly legacy = new Map<string, Set<string>>();
  /** Per note, this session: ids written or erased here, never asked of the bucket. */
  private readonly local = new Map<string, Set<string>>();

  constructor(
    private readonly folder: InkChunkStore & InkMigrationMarks,
    private readonly bucket: InkChunkStore,
  ) {}

  async prepareNote(noteId: string, declared: readonly string[]): Promise<void> {
    if (await this.folder.isMigrated(noteId)) return;
    const local = this.localIds(noteId);
    const legacy = this.legacy.get(noteId) ?? new Set<string>();
    for (const id of declared) if (!local.has(id)) legacy.add(id);
    this.legacy.set(noteId, legacy);
    const settled = await Promise.all(
      [...legacy].map(async (chunkId) => {
        try {
          await this.copyIn(noteId, chunkId);
          return true;
        } catch {
          // The page's own read reports it; the note just stays unmarked.
          return false;
        }
      }),
    );
    if (!settled.every(Boolean)) return;
    try {
      await this.folder.markMigrated(noteId);
    } catch {
      // No marker yet only means the next load settles the note again.
    }
  }

  async read(noteId: string, chunkId: string): Promise<Uint8Array | null> {
    const local = await this.folder.read(noteId, chunkId);
    if (local) return local;
    if (await this.folder.isMigrated(noteId)) return null;
    if (this.localIds(noteId).has(chunkId)) return null;
    const legacy = this.legacy.get(noteId);
    // A note opened this session: only its declared pages can be in the bucket.
    if (legacy && !legacy.has(chunkId)) return null;
    return this.copyIn(noteId, chunkId);
  }

  async write(noteId: string, chunkId: string, bytes: Uint8Array): Promise<void> {
    await this.folder.write(noteId, chunkId, bytes);
    this.markLocal(noteId, chunkId);
  }

  async remove(noteId: string, chunkId: string): Promise<void> {
    await this.folder.remove(noteId, chunkId);
    this.markLocal(noteId, chunkId);
  }

  list(noteId: string): Promise<string[] | null> {
    return this.folder.list(noteId);
  }

  /** Remember a page settled here, unless the bucket may still owe this note a copy of it. */
  private markLocal(noteId: string, chunkId: string): void {
    // A legacy page written here is in the folder now; one erased here must not
    // be copied back by the next prepare.
    this.localIds(noteId).add(chunkId);
    this.legacy.get(noteId)?.delete(chunkId);
  }

  private localIds(noteId: string): Set<string> {
    let ids = this.local.get(noteId);
    if (!ids) {
      ids = new Set<string>();
      this.local.set(noteId, ids);
    }
    return ids;
  }

  /**
   * The page from the folder, else copied in from the bucket and read back.
   * `null` when neither holds it. Throws when the bucket read failed.
   */
  private async copyIn(noteId: string, chunkId: string): Promise<Uint8Array | null> {
    const present = await this.folder.read(noteId, chunkId);
    if (present) return present;
    const legacy = await this.bucket.read(noteId, chunkId);
    if (!legacy) return null;
    // A pull may have landed the page while the bucket answered: the folder's
    // copy wins. The folder port has no atomic create-if-absent (its `rename`
    // is copy-then-delete on both adapters), so this re-check narrows the
    // window rather than closing it.
    const landed = await this.folder.read(noteId, chunkId);
    if (landed) return landed;
    await this.folder.write(noteId, chunkId, legacy);
    const copied = await this.folder.read(noteId, chunkId);
    if (!copied || !sameBytes(copied, legacy)) {
      throw new Error(`ink: copy of page ${chunkId} did not read back from the folder`);
    }
    return legacy;
  }
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
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
export class FsInkChunkStore implements InkChunkStore, InkMigrationMarks {
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

  /**
   * The note's legacy bucket pages are all in this folder. A file in the
   * note's own ink folder, so it travels with the chunks through sync and git;
   * it is not a `.inkb`, so `list` never reads it as a page.
   */
  async isMigrated(noteId: string): Promise<boolean> {
    const fs = this.fs();
    if (!fs) return false;
    return (await fs.stat(migratedMarkerPath(noteId))) !== null;
  }

  async markMigrated(noteId: string): Promise<void> {
    const fs = this.require();
    await fs.mkdirp(typedCore().inkSidecarDir(noteId));
    await fs.writeFile(
      migratedMarkerPath(noteId),
      "legacy bucket ink copied into this folder\n",
    );
  }
}

function migratedMarkerPath(noteId: string): string {
  return `${typedCore().inkSidecarDir(noteId)}/migrated`;
}

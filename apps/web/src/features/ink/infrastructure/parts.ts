import { readyCore, typedCore } from "@/lib/rust-core";
import {
  BlobNotFoundError,
  LEGACY_INK_DIR,
  type IBlobFetcher,
  type ICurrentUserProvider,
  type IWorkspaceFs,
  type WorkspaceStat,
} from "@weaveforge/core";
import { logToApp } from "@/lib/error-report/app-log";
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
    // Ids are checked before the user: the key builder checks the note id,
    // then the chunk id, whatever user it is given.
    readyCore().inkChunkBlobKey("-", noteId, chunkId);
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
/** Runs folder work under the folder lock; the identity where there is none. */
export type InkFolderRun = <T>(fn: () => Promise<T>) => Promise<T>;

const unlocked: InkFolderRun = (fn) => fn();

/** Finds the file an ink note lives in, so its strokes can be found beside it. */
export interface InkNoteLocator {
  /** The note's `.ink.md` path in the workspace folder, or `null` when it has none. */
  pathOf(noteId: string): Promise<string | null>;
}

/** Something the ink folder scan wants the user to see in the app log. */
export interface InkFolderReport {
  level: "info" | "warn" | "error";
  message: string;
  detail?: string;
}

export interface FolderInkNotesOptions {
  /** The folder lock; every read and write of the folder runs inside it. */
  run?: InkFolderRun;
  /**
   * Writes the notes to the folder. Asked once, outside the lock, when a note
   * is not on disk yet (a note made a moment ago, before the mirror ran).
   */
  syncFolder?: () => Promise<unknown>;
  /** Where findings go; the app log by default. */
  report?: (entry: InkFolderReport) => void;
}

/**
 * Ink notes by their file: `notes/foo.ink.md` keeps its pages in `notes/foo.ink/`.
 *
 * Strokes pair with a note by file name only. The note id is just how the app
 * asks; it is turned into a path by reading the `weaveforge-id` of the
 * `.ink.md` files on disk, so a note that is renamed, or that comes back from
 * an import under a new id, finds the strokes that sit beside its file.
 *
 * A scan also runs the one-time move out of the old `.ink/<weaveforge-id>/`
 * folder: it COPIES the pages beside the note, checks each copy by hash, and
 * never writes, moves or deletes anything in the old folder. Stroke folders no
 * note owns are reported, never deleted.
 */
export class FolderInkNotes implements InkNoteLocator {
  private readonly paths = new Map<string, string>();
  private readonly reported = new Set<string>();

  constructor(
    private readonly fs: () => IWorkspaceFs | null,
    private readonly options: FolderInkNotesOptions = {},
  ) {}

  async pathOf(noteId: string): Promise<string | null> {
    const fs = this.fs();
    if (!fs) return null;
    const run = this.options.run ?? unlocked;
    const found = await run(() => this.find(fs, noteId));
    if (found || !this.options.syncFolder) return found;
    try {
      await this.options.syncFolder();
    } catch (err) {
      // The sync reports its own failure; the note is just not on disk yet.
      this.report("warn", `ink: could not write note ${noteId} to the folder`, String(err));
      return null;
    }
    return run(() => this.find(fs, noteId));
  }

  /** The cached path while that file still carries the id, else a fresh scan. */
  private async find(fs: IWorkspaceFs, noteId: string): Promise<string | null> {
    const cached = this.paths.get(noteId);
    if (cached && (await idOfNote(fs, cached)) === noteId) return cached;
    this.paths.delete(noteId);
    await this.scan(fs);
    return this.paths.get(noteId) ?? null;
  }

  private async scan(fs: IWorkspaceFs): Promise<void> {
    const claims = new Map<string, string[]>();
    const unpaired: string[] = [];
    await walkNotes(fs, "", async (entry, kind) => {
      if (kind === "unpaired") {
        unpaired.push(entry.path);
        return;
      }
      const id = await idOfNote(fs, entry.path);
      if (id) claims.set(id, [...(claims.get(id) ?? []), entry.path]);
    });
    const notes = new Map<string, string>();
    for (const [id, paths] of claims) {
      if (paths.length === 1) {
        notes.set(id, paths[0]!);
        continue;
      }
      // A copied file keeps the id. Strokes go to neither note rather than into the wrong one's folder.
      this.report(
        "error",
        `ink: ${paths.join(" and ")} all carry weaveforge-id ${id}; their strokes stay closed until each has its own id`,
      );
    }
    this.paths.clear();
    for (const [id, path] of notes) this.paths.set(id, path);
    for (const [id, path] of notes) {
      try {
        await this.migrate(fs, id, path);
      } catch (err) {
        this.report("error", `ink: could not copy ${typedCore().legacyInkDir(id)} beside ${path}`, String(err));
      }
    }
    await this.reportStrays(fs, claims, unpaired);
  }

  /**
   * Copy `.ink/<id>/` into the note's own folder, once. A page the folder
   * already holds is never overwritten, so a copy cut off half way is finished
   * on the next scan. When every page is across, a record under
   * `.weaveforge/` says so, and the old folder is never copied again -- not
   * even after the user deletes the note's folder.
   */
  private async migrate(fs: IWorkspaceFs, id: string, notePath: string): Promise<void> {
    if (!typedCore().isInkNoteId(id)) return;
    const legacy = typedCore().legacyInkDir(id);
    const record = `${INK_MIGRATED_RECORDS}/${id}`;
    if (!(await fs.stat(legacy)) || (await fs.stat(record))) return;
    const files = (await fs.list(legacy)).filter((entry) => entry.kind === "file").map((entry) => entry.path);
    if (readyCore().inkChunkIdsInListing(files).length === 0) return;
    const target = typedCore().inkStrokesDir(notePath);
    const present = new Set<string>();
    if (await fs.stat(target)) {
      for (const entry of await fs.list(target)) {
        const name = baseName(entry.path);
        // A `.part` is our own unfinished copy; only a whole page counts as there.
        if (name.endsWith(PART)) await fs.remove(entry.path);
        else present.add(name);
      }
    }
    const copy = files.filter((path) => {
      const name = baseName(path);
      if (present.has(name)) return false;
      return name === MIGRATED_MARKER || readyCore().inkChunkIdOfFileName(name) !== null;
    });
    await fs.mkdirp(target);
    for (const source of copy) {
      try {
        await copyByHash(fs, source, `${target}/${baseName(source)}`);
      } catch (err) {
        // Every page copied so far is whole and checked, so it stays; the next scan carries on.
        if (present.size === 0) await removeIfEmpty(fs, target);
        throw err;
      }
      present.add(baseName(source));
    }
    await fs.mkdirp(INK_MIGRATED_RECORDS);
    await fs.writeFile(record, `${target}\n`);
    if (copy.length > 0) {
      this.report("info", `ink: copied ${copy.length} file(s) from ${legacy} to ${target}; ${legacy} is left as it was`);
    }
  }

  private async reportStrays(
    fs: IWorkspaceFs,
    claims: ReadonlyMap<string, readonly string[]>,
    unpaired: readonly string[],
  ): Promise<void> {
    for (const dir of unpaired) {
      const files = (await fs.list(dir)).filter((entry) => entry.kind === "file").map((entry) => entry.path);
      if (readyCore().inkChunkIdsInListing(files).length === 0) continue;
      this.report("warn", `ink: ${dir} holds strokes but there is no ${dir}.md beside it; it was left as it is`);
    }
    if (!(await fs.stat(LEGACY_INK_DIR))) return;
    for (const entry of await fs.list(LEGACY_INK_DIR)) {
      if (entry.kind !== "dir" || claims.has(baseName(entry.path))) continue;
      this.report("warn", `ink: ${entry.path} holds strokes but no note has id ${baseName(entry.path)}; it was left as it is`);
    }
  }

  private report(level: InkFolderReport["level"], message: string, detail?: string): void {
    if (this.reported.has(message)) return;
    this.reported.add(message);
    const entry: InkFolderReport = detail === undefined ? { level, message } : { level, message, detail };
    if (this.options.report) this.options.report(entry);
    else logToApp({ ...entry, source: "ink" });
  }
}

/**
 * Chunks in the workspace folder, beside their note: `notes/foo.ink/<ulid>.inkb`.
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
 *
 * The note id is turned into the note's file by `notes`; nothing here finds
 * strokes by id. A note with no file has no strokes, and writing to it fails.
 */
export class FsInkChunkStore implements InkChunkStore, InkMigrationMarks {
  constructor(
    private readonly fs: () => IWorkspaceFs | null,
    private readonly notes: InkNoteLocator,
    private readonly run: InkFolderRun = unlocked,
  ) {}

  async read(noteId: string, chunkId: string): Promise<Uint8Array | null> {
    return this.at(noteId, () => null, async (fs, note) => {
      const path = typedCore().inkChunkPath(note, chunkId);
      return (await fs.stat(path)) ? fs.readFile(path) : null;
    });
  }

  async write(noteId: string, chunkId: string, bytes: Uint8Array): Promise<void> {
    return this.at(noteId, noFile(noteId), async (fs, note) => {
      await fs.mkdirp(typedCore().inkStrokesDir(note));
      await fs.writeFile(typedCore().inkChunkPath(note, chunkId), bytes);
    }, true);
  }

  async remove(noteId: string, chunkId: string): Promise<void> {
    return this.at(noteId, () => undefined, async (fs, note) => {
      const path = typedCore().inkChunkPath(note, chunkId);
      if (await fs.stat(path)) await fs.remove(path);
    }, true);
  }

  async list(noteId: string): Promise<string[] | null> {
    return this.at(noteId, () => null, async (fs, note) => {
      const dir = typedCore().inkStrokesDir(note);
      if (!(await fs.stat(dir))) return [];
      const files = (await fs.list(dir)).filter((entry) => entry.kind === "file").map((entry) => entry.path);
      return readyCore().inkChunkIdsInListing(files);
    });
  }

  /**
   * The note's legacy bucket pages are all in this folder. A file in the
   * note's own ink folder, so it travels with the chunks through sync and git;
   * it is not a `.inkb`, so `list` never reads it as a page.
   */
  async isMigrated(noteId: string): Promise<boolean> {
    return this.at(noteId, () => false, async (fs, note) => (await fs.stat(markerPath(note))) !== null);
  }

  async markMigrated(noteId: string): Promise<void> {
    return this.at(noteId, noFile(noteId), async (fs, note) => {
      await fs.mkdirp(typedCore().inkStrokesDir(note));
      await fs.writeFile(markerPath(note), "legacy bucket ink copied into this folder\n");
    }, true);
  }

  /**
   * Runs `op` on the note's path under the lock, after checking the note file
   * is still there. A note renamed between finding it and taking the lock is
   * looked up once more, so a page never lands beside a name the note left.
   */
  private async at<T>(
    noteId: string,
    missing: () => T,
    op: (fs: IWorkspaceFs, notePath: string) => Promise<T>,
    needsFolder = false,
  ): Promise<T> {
    const fs = this.fs();
    if (!fs) {
      if (needsFolder) throw new Error("ink: no workspace folder is open");
      return missing();
    }
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const note = await this.notes.pathOf(noteId);
      if (!note) break;
      const done = await this.run(async () =>
        (await fs.stat(note)) ? { value: await op(fs, note) } : null,
      );
      if (done) return done.value;
    }
    return missing();
  }
}

const MIGRATED_MARKER = "migrated";

function markerPath(notePath: string): string {
  return `${typedCore().inkStrokesDir(notePath)}/${MIGRATED_MARKER}`;
}

function noFile(noteId: string): () => never {
  return () => {
    throw new Error(`ink: note ${noteId} has no file in the workspace folder yet`);
  };
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** The `weaveforge-id` of a note file, or `null` when it has none or cannot be read. */
async function idOfNote(fs: IWorkspaceFs, path: string): Promise<string | null> {
  try {
    if (!(await fs.stat(path))) return null;
    const id = typedCore().readFrontmatter(await fs.readText(path)).frontmatter["weaveforge-id"];
    return typeof id === "string" && id ? id : null;
  } catch {
    return null;
  }
}

/**
 * Every `*.ink.md` under `dir` (as "note"), and every `*.ink/` folder with no
 * `*.ink.md` beside it (as "unpaired"). A `foo.ink/` beside `foo.ink.md` holds
 * that note's strokes and is not entered; an unpaired one may be a user's own
 * folder, so it is entered too. Hidden entries -- `.git`, the old `.ink/` --
 * are not entered.
 */
async function walkNotes(
  fs: IWorkspaceFs,
  dir: string,
  visit: (entry: WorkspaceStat, kind: "note" | "unpaired") => Promise<void>,
): Promise<void> {
  const entries = await fs.list(dir);
  const files = new Set(entries.filter((entry) => entry.kind === "file").map((entry) => baseName(entry.path)));
  for (const entry of entries) {
    const name = baseName(entry.path);
    if (name.startsWith(".")) continue;
    if (entry.kind === "dir") {
      if (name.endsWith(INK_STROKES_SUFFIX)) {
        if (files.has(`${name}.md`)) continue;
        await visit(entry, "unpaired");
      }
      await walkNotes(fs, entry.path, visit);
    } else if (name.endsWith(`${INK_STROKES_SUFFIX}.md`)) {
      await visit(entry, "note");
    }
  }
}

const INK_STROKES_SUFFIX = ".ink";
/** One empty-ish file per note id whose `.ink/<id>/` has been copied beside the note. */
const INK_MIGRATED_RECORDS = ".weaveforge/ink-migrated";
const PART = ".part";

/** Writes `destination` through a `.part` file and checks it by hash, so it is either whole or absent. */
async function copyByHash(fs: IWorkspaceFs, source: string, destination: string): Promise<void> {
  const bytes = await fs.readFile(source);
  const want = await sha256(bytes);
  const part = `${destination}${PART}`;
  try {
    await fs.writeFile(part, bytes);
    if ((await sha256(await fs.readFile(part))) !== want) throw new Error(`${part} did not read back the same as ${source}`);
    await fs.rename(part, destination);
  } catch (err) {
    await fs.remove(part).catch(() => {});
    throw err;
  }
  if ((await sha256(await fs.readFile(destination))) !== want) {
    await fs.remove(destination).catch(() => {});
    throw new Error(`${destination} did not read back the same as ${source}`);
  }
}

async function removeIfEmpty(fs: IWorkspaceFs, dir: string): Promise<void> {
  try {
    if ((await fs.stat(dir)) && (await fs.list(dir)).length === 0) await fs.remove(dir, { recursive: true });
  } catch {
    // An empty folder left behind holds nothing.
  }
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

import type { IWorkspaceFs } from "@weaveforge/core";

/**
 * The web app's clone of the workspace repo (D-1a), kept in OPFS.
 *
 * The clone holds the whole tree; a file's bytes are fetched the first time it
 * is opened. The local record of what the remote held at the last pull or push
 * lives in `WEB_CLONE_MANIFEST` (never pushed): the head commit and, per path,
 * the git blob id and whether the bytes are here. Comparing a file's blob id
 * with that record gives the unpushed changes, with no index and no packfiles.
 *
 * Pushes are fast-forward only. A push that loses the race pulls first: where
 * both sides changed a file, the remote file is kept at its path and the web
 * text is written beside it as `<name>.conflict-<stamp>.<ext>`. Nothing is
 * ever reset or force-pushed. Shared-item files are left out of commits unless
 * this tab holds the write-back lease (D-8a).
 *
 * Pulls, pushes, fetches and manifest writes run under one lock per workspace
 * (`navigator.locks`, or an in-tab mutex where that is missing), so two tabs
 * never interleave on the manifest. A pull also re-hashes a file just before it
 * writes it, so an editor save made while the bytes were in flight is kept.
 *
 * The remote is a port (`GitRemote`): `github-remote.ts` speaks GitHub's REST
 * Git Data API, which browsers may call directly, unlike git's own HTTP
 * protocol.
 */

export const WEB_CLONE_MANIFEST = ".weaveforge/local/web-clone.json";
const LOCAL_DIR = ".weaveforge/local/";

export interface RemoteFile {
  path: string;
  /** Git blob id. */
  sha: string;
}

export interface RemoteHead {
  commit: string;
  files: readonly RemoteFile[];
}

/** A file to commit; `bytes: null` deletes it. */
export interface FileChange {
  path: string;
  bytes: Uint8Array | null;
}

export type CommitOutcome = { kind: "pushed"; commit: string } | { kind: "behind" };

export interface GitRemote {
  /** The branch head and its whole tree, without file bytes. */
  head(): Promise<RemoteHead>;
  blob(sha: string): Promise<Uint8Array>;
  /** Commit on top of `parent` and move the branch, fast-forward only. */
  commit(parent: string, changes: readonly FileChange[], message: string): Promise<CommitOutcome>;
}

/** The part of `navigator.locks` the clone uses. */
export interface WebLocks {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>;
}

export interface WebCloneOptions {
  isShared(path: string): boolean;
  leaseHeld(): boolean;
  now(): number;
  /** Names the workspace's lock: one per workspace, shared by all its tabs. */
  lockName: string;
  /** Defaults to `navigator.locks`, else an in-tab mutex. */
  locks?: WebLocks;
}

interface Entry {
  sha: string;
  fetched: boolean;
}

interface Manifest {
  head: string;
  files: Record<string, Entry>;
}

export interface SyncResult {
  /** Conflict copies written by the pull. */
  conflicts: string[];
}

/** Serializes calls made by this tab; used when `navigator.locks` is missing. */
const tabTails = new Map<string, Promise<unknown>>();
const tabLocks: WebLocks = {
  request<T>(name: string, callback: () => Promise<T>): Promise<T> {
    const run = (tabTails.get(name) ?? Promise.resolve()).then(callback);
    tabTails.set(name, run.catch(() => undefined));
    return run;
  },
};

function defaultLocks(): WebLocks {
  const nav = globalThis.navigator as { locks?: WebLocks } | undefined;
  return nav?.locks ?? tabLocks;
}

/** Git's blob id: SHA-1 of `blob <size>\0<bytes>`. */
export async function gitBlobSha(bytes: Uint8Array): Promise<string> {
  const header = new TextEncoder().encode(`blob ${bytes.byteLength}\0`);
  const all = new Uint8Array(header.byteLength + bytes.byteLength);
  all.set(header);
  all.set(bytes, header.byteLength);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-1", all));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** `20261120T101200Z` for file names, as the desktop's conflict copies use. */
function compactStamp(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace(/[-:]/g, "") + "Z";
}

/** Two-part extensions that name a file type; a conflict copy goes before them. */
const COMPOUND_EXTENSIONS = [".ink.md", ".annotations.json"];

/** Where the extension of `path` starts, or -1 when the file has none. */
function extensionStart(path: string): number {
  const slash = path.lastIndexOf("/");
  const name = path.slice(slash + 1);
  for (const ext of COMPOUND_EXTENSIONS) {
    if (name.length > ext.length && name.endsWith(ext)) return path.length - ext.length;
  }
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? -1 : slash + 1 + dot;
}

/** `dir/name.ext` -> `dir/name<suffix>.ext`; a dot in a folder name is not an extension. */
function withSuffix(path: string, suffix: string): string {
  const at = extensionStart(path);
  if (at < 0) return `${path}${suffix}`;
  return `${path.slice(0, at)}${suffix}${path.slice(at)}`;
}

/** A path's local blob id (null when gone) and its bytes, when present. */
interface LocalState {
  sha: string | null;
  bytes: Uint8Array | null;
}

export class WebClone {
  private readonly locks: WebLocks;

  constructor(
    private readonly fs: IWorkspaceFs,
    private readonly remote: GitRemote,
    private readonly options: WebCloneOptions,
  ) {
    this.locks = options.locks ?? defaultLocks();
  }

  /** Runs `work` alone across this workspace's tabs. */
  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    return this.locks.request(`weaveforge-web-clone:${this.options.lockName}`, work);
  }

  private async manifest(): Promise<Manifest> {
    if (!(await this.fs.stat(WEB_CLONE_MANIFEST))) throw new Error("The workspace is not cloned yet.");
    return JSON.parse(await this.fs.readText(WEB_CLONE_MANIFEST)) as Manifest;
  }

  private async save(manifest: Manifest): Promise<void> {
    await this.fs.writeFile(WEB_CLONE_MANIFEST, JSON.stringify(manifest));
  }

  private async bytesAt(path: string): Promise<Uint8Array | null> {
    const stat = await this.fs.stat(path);
    return stat?.kind === "file" ? this.fs.readFile(path) : null;
  }

  /** Record the remote tree; no file bytes are fetched. */
  async clone(): Promise<void> {
    return this.exclusive(async () => {
      const head = await this.remote.head();
      const files: Record<string, Entry> = {};
      for (const file of head.files) files[file.path] = { sha: file.sha, fetched: false };
      await this.save({ head: head.commit, files });
    });
  }

  /** Every path the clone knows on the remote, fetched or not. */
  async paths(): Promise<string[]> {
    return Object.keys((await this.manifest()).files).sort();
  }

  /** A file's bytes, fetched from the remote the first time. */
  async read(path: string): Promise<Uint8Array> {
    return this.exclusive(async () => {
      const manifest = await this.manifest();
      const entry = manifest.files[path];
      if (entry && !entry.fetched && !(await this.fs.stat(path))) {
        const bytes = await this.remote.blob(entry.sha);
        await this.fs.writeFile(path, bytes);
        entry.fetched = true;
        await this.save(manifest);
        return bytes;
      }
      return this.fs.readFile(path);
    });
  }

  /** Delete a file, fetched or not, so the next push deletes it on the remote. */
  async remove(path: string): Promise<void> {
    return this.exclusive(async () => {
      const manifest = await this.manifest();
      const entry = manifest.files[path];
      if (entry) {
        entry.fetched = true;
        await this.save(manifest);
      }
      await this.fs.remove(path);
    });
  }

  /** The local blob id of a path: its bytes, the remote's for an unfetched file, or null when gone. */
  private async localSha(path: string, entry: Entry | undefined): Promise<LocalState> {
    const bytes = await this.bytesAt(path);
    if (bytes) return { sha: await gitBlobSha(bytes), bytes };
    if (entry && !entry.fetched) return { sha: entry.sha, bytes: null };
    return { sha: null, bytes: null };
  }

  private async changesIn(manifest: Manifest): Promise<FileChange[]> {
    const paths = new Set(Object.keys(manifest.files));
    for await (const entry of this.fs.walk("")) {
      if (entry.kind === "file" && !entry.path.startsWith(LOCAL_DIR)) paths.add(entry.path);
    }
    const out: FileChange[] = [];
    for (const path of [...paths].sort()) {
      const entry = manifest.files[path];
      const local = await this.localSha(path, entry);
      if (local.sha !== (entry?.sha ?? null)) out.push({ path, bytes: local.bytes });
    }
    return out;
  }

  /** Local changes since the last pull or push, shared-item files included. */
  async changes(): Promise<FileChange[]> {
    return this.changesIn(await this.manifest());
  }

  private pushable(change: FileChange): boolean {
    return !this.options.isShared(change.path) || this.options.leaseHeld();
  }

  /** How many changes the next push would send. */
  async unpushed(): Promise<number> {
    return (await this.changes()).filter((c) => this.pushable(c)).length;
  }

  /** A conflict-copy path for `path` that is not taken yet. */
  private async freeConflictPath(path: string, taken: (path: string) => boolean): Promise<string> {
    const base = withSuffix(path, `.conflict-${compactStamp(this.options.now())}`);
    for (let n = 1; ; n++) {
      const candidate = n === 1 ? base : withSuffix(base, `-${n}`);
      if (!taken(candidate) && !(await this.fs.stat(candidate))) return candidate;
    }
  }

  /**
   * Put the remote's text at `path`. The bytes are fetched before anything is
   * written, and the local file is hashed again just before the write. If it
   * changed since `seen` (a save made during the fetch), nothing is overwritten:
   * the local text stays at `path` and the remote text goes to a conflict copy,
   * which the next push sends with the rest.
   */
  private async takeRemote(
    path: string,
    theirs: string,
    seen: LocalState,
    keepSeenCopy: boolean,
    remoteShas: Map<string, string>,
    manifest: Manifest,
    conflicts: string[],
  ): Promise<void> {
    const incoming = await this.remote.blob(theirs);
    const now = await this.localSha(path, manifest.files[path]);
    const taken = (candidate: string) => candidate in manifest.files || remoteShas.has(candidate);
    if (now.sha !== seen.sha) {
      const copy = await this.freeConflictPath(path, taken);
      await this.fs.writeFile(copy, incoming);
      conflicts.push(copy);
    } else {
      if (keepSeenCopy && seen.bytes) {
        const copy = await this.freeConflictPath(path, taken);
        await this.fs.writeFile(copy, seen.bytes);
        conflicts.push(copy);
      }
      await this.fs.writeFile(path, incoming);
    }
    manifest.files[path] = { sha: theirs, fetched: true };
  }

  /**
   * Take in the remote's changes. A local edit is never lost: a file changed
   * on both sides keeps the remote text at its path and the local text in a
   * conflict copy; a file deleted remotely but edited here stays.
   */
  async pull(): Promise<SyncResult> {
    return this.exclusive(() => this.pullLocked());
  }

  private async pullLocked(): Promise<SyncResult> {
    const manifest = await this.manifest();
    const head = await this.remote.head();
    const conflicts: string[] = [];
    if (head.commit === manifest.head) return { conflicts };
    const remoteShas = new Map(head.files.map((f) => [f.path, f.sha]));
    const paths = new Set([...Object.keys(manifest.files), ...remoteShas.keys()]);
    for (const path of [...paths].sort()) {
      const entry = manifest.files[path];
      const base = entry?.sha ?? null;
      const theirs = remoteShas.get(path) ?? null;
      if (theirs === base) continue;
      const local = await this.localSha(path, entry);
      const lazy = !!entry && !entry.fetched && !local.bytes;
      if (local.sha === base) {
        // Unchanged here: take theirs.
        if (theirs === null) {
          if (local.bytes && (await this.localSha(path, entry)).sha === base) await this.fs.remove(path);
          delete manifest.files[path];
        } else if (lazy || (!entry && !local.bytes)) {
          manifest.files[path] = { sha: theirs, fetched: false };
        } else {
          await this.takeRemote(path, theirs, local, false, remoteShas, manifest, conflicts);
        }
      } else if (local.sha === theirs) {
        if (theirs === null) delete manifest.files[path];
        else manifest.files[path] = { sha: theirs, fetched: true };
      } else if (theirs === null) {
        // Deleted there, edited here: keep the file; it is now a local addition.
        delete manifest.files[path];
      } else {
        await this.takeRemote(path, theirs, local, true, remoteShas, manifest, conflicts);
      }
    }
    manifest.head = head.commit;
    await this.save(manifest);
    return { conflicts };
  }

  /** Push local changes fast-forward only; `behind` when the remote moved. */
  async push(message: string): Promise<CommitOutcome | { kind: "clean" }> {
    return this.exclusive(() => this.pushLocked(message));
  }

  private async pushLocked(message: string): Promise<CommitOutcome | { kind: "clean" }> {
    const manifest = await this.manifest();
    const changes = (await this.changesIn(manifest)).filter((c) => this.pushable(c));
    if (changes.length === 0) return { kind: "clean" };
    const outcome = await this.remote.commit(manifest.head, changes, message);
    if (outcome.kind === "behind") return outcome;
    for (const change of changes) {
      if (change.bytes) manifest.files[change.path] = { sha: await gitBlobSha(change.bytes), fetched: true };
      else delete manifest.files[change.path];
    }
    manifest.head = outcome.commit;
    await this.save(manifest);
    return outcome;
  }

  /** Pull, then push; a push that loses a race pulls and pushes once more. */
  async sync(message: string): Promise<SyncResult> {
    return this.exclusive(async () => {
      const conflicts = (await this.pullLocked()).conflicts;
      for (let attempt = 0; attempt < 2; attempt++) {
        const pushed = await this.pushLocked(message);
        if (pushed.kind !== "behind") return { conflicts };
        conflicts.push(...(await this.pullLocked()).conflicts);
      }
      throw new Error("The remote kept moving; try again.");
    });
  }
}

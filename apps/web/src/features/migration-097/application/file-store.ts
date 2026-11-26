import type { FileSink } from "../domain/ports";
import { sha256Hex } from "../domain/hash";
import { conflictCopyPath } from "../domain/conflict-path";
import { addsKeysOnly, mergeAddedKeys } from "../domain/add-keys-only";
import { toAppConflictCopy } from "../domain/conflict-copy";
import { isTempPath } from "@/lib/temp-path";
import { ConflictError } from "@weaveforge/core";

/** Path to the sha256 of the content this run wrote there (or found there and kept). */
export type Outputs = Record<string, string>;

/** Upper bound on the conflict copies one store() call tries before it gives up with a coded error. */
const MAX_CANDIDATES = 1000;

export type FileStore = {
  /**
   * Writes the DB version at `path`. Returns the path it now holds: `path` itself, or a conflict copy when
   * a differing file already sits there. A file never gets overwritten unless this device's previous run
   * wrote it and it is unchanged since. Identical content is left alone. A conflict copy gets `copy` when
   * given (the copy form of the row, e.g. `conflictOf` instead of `id`), else the same `data`.
   */
  store(path: string, data: string | Uint8Array, hash: string, copy?: { data: string; hash: string }): Promise<string>;
  /** Copies written, reused or kept this run. */
  readonly outputs: Outputs;
  /** Conflict copies this run wrote or reused. */
  readonly conflicts: string[];
  /** User files this run merged the DB version into in place (keys added, the file's own values kept). */
  readonly kept: string[];
  /** This device's previous run outputs, as given to createFileStore. */
  readonly prior: Outputs;
};

/**
 * The run's no-overwrite writer. `prior` is this device's previous run outputs: a file whose content still
 * matches the hash that run recorded is ours and unchanged, so the new DB version may replace it.
 */
export async function createFileStore(sink: FileSink, prior: Outputs): Promise<FileStore> {
  const outputs: Outputs = {};
  const conflicts: string[] = [];
  const kept: string[] = [];

  /**
   * What is at `path` right now. Presence comes from a stat of that path, so a case-only spelling mismatch still
   * finds the file. A file whose stat or read fails counts as present, with `bytes` null, and is never overwritten.
   */
  const stateAt = async (path: string): Promise<{ present: false } | { present: true; bytes: Uint8Array | null }> => {
    try {
      if (!(await sink.exists(path))) return { present: false };
    } catch {
      return { present: true, bytes: null };
    }
    try {
      return { present: true, bytes: await sink.readBytes(path) };
    } catch {
      return { present: true, bytes: null };
    }
  };

  /**
   * Whether a sidecar name is taken. A sidecar already holding this blob's own sha256 is free: it is the blob's sidecar.
   * A sidecar that cannot be checked or read counts as taken, so the blob is never written without a sidecar it owns.
   */
  const sidecarTaken = async (sidecar: string, hash: string): Promise<boolean> => {
    try {
      if (!(await sink.exists(sidecar))) return false;
    } catch {
      return true;
    }
    try {
      return (await sink.readText(sidecar)).split("\n")[0] !== hash;
    } catch {
      return true;
    }
  };

  /**
   * Replaces the file at `path` only if it still holds `bytes` (sha256 `hash`). Text goes by the sink's compare-and-set;
   * binary data, or a file that is not exact UTF-8, by a re-read and re-hash just before the write.
   */
  const replaceIfUnchanged = async (
    path: string,
    bytes: Uint8Array,
    hash: string,
    data: string | Uint8Array,
  ): Promise<boolean> => {
    if (typeof data === "string") {
      const text = exactUtf8(bytes);
      if (text !== null) return sink.writeIf(path, data, text);
    }
    try {
      if ((await sha256Hex(await sink.readBytes(path))) !== hash) return false;
    } catch {
      return false;
    }
    await sink.write(path, data);
    return true;
  };

  return {
    async store(path, data, hash, copy) {
      // Candidate 0 is the path itself; candidate n (n >= 1) is its nth conflict copy.
      for (let n = 0; n < MAX_CANDIDATES; n++) {
        const candidate = n === 0 ? path : conflictCopyPath(path, n);
        const out = n === 0 || !copy ? { data, hash } : copy;
        const state = await stateAt(candidate);
        if (!state.present) {
          // A candidate is free only when its .sha256 sidecar name is free too: a stale sidecar would leave the blob without its own.
          if (await sidecarTaken(`${candidate}.sha256`, out.hash)) continue;
          await sink.write(candidate, out.data);
        } else {
          // An unreadable file is never overwritten: skip to the next candidate.
          if (state.bytes === null) continue;
          // Known window: an edit landing between this read and the write below is lost. FileSink has no
          // compare-and-set for bytes (writeIf is text only), and only files this device wrote, unchanged, get here.
          const current = await sha256Hex(state.bytes);
          if (current !== out.hash) {
            // A file this device wrote and left unchanged takes the new version. A file the DB version agrees with
            // (same body, same values) takes only the keys the DB adds; its own lines stay. Anything else is kept.
            if (prior[candidate] !== current) {
              const text = n === 0 && typeof data === "string" ? exactUtf8(state.bytes) : null;
              const merged = text === null ? null : mergeAddedKeys(text, data as string);
              if (text === null || merged === null) continue;
              if (merged !== text && !(await sink.writeIf(candidate, merged, text))) continue;
              outputs[candidate] = await sha256Hex(merged);
              kept.push(candidate);
              return candidate;
            }
            // An edit since the read above keeps its file: this version goes on to a conflict copy.
            if (!(await replaceIfUnchanged(candidate, state.bytes, current, out.data))) continue;
          }
        }
        outputs[candidate] = out.hash;
        if (candidate !== path) conflicts.push(candidate);
        return candidate;
      }
      throw Object.assign(new Error(`no free name for ${path} within ${MAX_CANDIDATES} candidates`), {
        code: "file-store-candidates-exhausted",
      });
    },
    outputs,
    conflicts,
    kept,
    prior,
  };
}

/** The text `bytes` hold when they are valid UTF-8 (a BOM kept as text), else null. */
function exactUtf8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return null;
  }
}

/**
 * A FileSink whose writes go through the run's no-overwrite store, so every kind writer shares one rule.
 * Only generated temp files (see tempPathFor) pass straight through; a user file named `*.part` is guarded. Settings files are saved by compare-and-set
 * (writeIf), never by a plain write. A rename never replaces an existing file.
 */
export function guardedSink(sink: FileSink, store: FileStore): FileSink {
  /** The text a non-ours file held before this run's first add-keys merge: later merges keep its body and keys. */
  const baselines = new Map<string, string>();
  /** Stores `data`; a conflict copy of an app file holds `conflictOf:` in place of its `weaveforge-id:`. */
  const storeWithCopy = async (path: string, data: string | Uint8Array): Promise<string> => {
    const hash = await sha256Hex(data);
    if (typeof data !== "string") return store.store(path, data, hash);
    const copy = toAppConflictCopy(data);
    return store.store(path, data, hash, copy === data ? undefined : { data: copy, hash: await sha256Hex(copy) });
  };
  return {
    async write(path, data) {
      if (isTempPath(path)) return sink.write(path, data);
      await storeWithCopy(path, data);
    },
    list: () => sink.list(),
    ...(sink.entries && { entries: (dir: string) => sink.entries!(dir) }),
    readText: (path) => sink.readText(path),
    readBytes: (path) => sink.readBytes(path),
    exists: (path) => sink.exists(path),
    async rename(from, to) {
      // Known gap until (c): the list-then-rename window is not atomic. (c) adds a refuse-to-replace rename on the real sinks.
      // Presence is stat, not list: a case-folding sink lists the stored spelling only. A failed stat counts as present.
      let present: boolean;
      try {
        present = from !== to && (await sink.exists(to));
      } catch {
        present = true;
      }
      if (present) throw new Error(`refusing to replace an existing file: ${to}`);
      return sink.rename(from, to);
    },
    remove: (path) => sink.remove(path),
    // A compare-and-set replaces only the text the caller read, so it never loses a user edit. Its result is this
    // run's output only when the file is ours: created by this write, already written this run, or still holding
    // the text this device's prior run recorded. A user's file is never recorded. The hash is of the bytes now on disk.
    // A file that is not ours takes only an add-keys merge (new keys added, body and existing keys unchanged); any
    // other change is refused and the text lands in a conflict copy.
    async writeIf(path, text, expected) {
      if (path.startsWith(".weaveforge/")) return sink.writeIf(path, text, expected);
      const ours =
        expected === null || path in store.outputs || store.prior[path] === (await sha256Hex(expected));
      const known = baselines.get(path);
      const base = known ?? expected;
      if (!ours && (base === null || !addsKeysOnly(base, text))) {
        // The store merges what it can into the user's file in place (a kept file, not a conflict). Anything else is a
        // conflict, not a plain miss: the DB text goes to a copy, the user's file is kept.
        if ((await storeWithCopy(path, text)) === path) return true;
        throw new ConflictError(`conflict: ${path} changed on disk, not add-keys-only; kept the file's version`);
      }
      const ok = await sink.writeIf(path, text, expected);
      if (ok && !ours && known === undefined && expected !== null) baselines.set(path, expected);
      if (ok && ours) {
        // Recorded only when the bytes read back are the text written; a mid-run edit is the user's, not ours.
        const landed = await sha256Hex(await sink.readBytes(path));
        if (landed === (await sha256Hex(text))) store.outputs[path] = landed;
      }
      return ok;
    },
  };
}

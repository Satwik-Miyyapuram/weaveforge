import type { FileSink } from "../domain/ports";
import { sha256Hex } from "../domain/hash";
import { conflictCopyPath } from "../domain/conflict-path";
import { addsKeysOnly } from "../domain/add-keys-only";

/** Path to the sha256 of the content this run wrote there (or found there and kept). */
export type Outputs = Record<string, string>;

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

  /**
   * What is at `path` right now. Presence comes from a fresh listing (never one taken earlier in the run), so a
   * file that exists but cannot be read still counts as present. `bytes` is null for that unreadable case.
   */
  const stateAt = async (path: string): Promise<{ present: false } | { present: true; bytes: Uint8Array | null }> => {
    if (!(await sink.list()).includes(path)) return { present: false };
    try {
      return { present: true, bytes: await sink.readBytes(path) };
    } catch {
      return { present: true, bytes: null };
    }
  };

  return {
    async store(path, data, hash, copy) {
      // Candidate 0 is the path itself; candidate n (n >= 1) is its nth conflict copy.
      for (let n = 0; ; n++) {
        const candidate = n === 0 ? path : conflictCopyPath(path, n);
        const out = n === 0 || !copy ? { data, hash } : copy;
        const state = await stateAt(candidate);
        if (!state.present) {
          await sink.write(candidate, out.data);
        } else {
          // An unreadable file is never overwritten: skip to the next candidate.
          if (state.bytes === null) continue;
          const current = await sha256Hex(state.bytes);
          if (current !== out.hash) {
            // A file this device wrote and left unchanged takes the new version; anything else is kept.
            if (prior[candidate] !== current) continue;
            await sink.write(candidate, out.data);
          }
        }
        outputs[candidate] = out.hash;
        if (candidate !== path) conflicts.push(candidate);
        return candidate;
      }
    },
    outputs,
    conflicts,
    prior,
  };
}

/**
 * A FileSink whose writes go through the run's no-overwrite store, so every kind writer shares one rule.
 * Only `.part` temp files under `.weaveforge/` pass straight through. Settings files are saved by compare-and-set
 * (writeIf), never by a plain write. A rename never replaces an existing file.
 */
export function guardedSink(sink: FileSink, store: FileStore): FileSink {
  /** The text a non-ours file held before this run's first add-keys merge: later merges keep its body and keys. */
  const baselines = new Map<string, string>();
  return {
    async write(path, data) {
      if (path.startsWith(".weaveforge/") && path.endsWith(".part")) return sink.write(path, data);
      await store.store(path, data, await sha256Hex(data));
    },
    list: () => sink.list(),
    readText: (path) => sink.readText(path),
    readBytes: (path) => sink.readBytes(path),
    async rename(from, to) {
      // Known gap until (c): the list-then-rename window is not atomic. (c) adds a refuse-to-replace rename on the real sinks.
      if ((await sink.list()).includes(to)) throw new Error(`refusing to replace an existing file: ${to}`);
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
        // A refused merge is a conflict, not a plain miss: the DB text goes to a copy, the user's file is kept.
        await store.store(path, text, await sha256Hex(text));
        throw new Error(`conflict: ${path} changed on disk, not add-keys-only; kept the file's version`);
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

import type { FileSink } from "../domain/ports";
import { sha256Hex } from "../domain/hash";
import { conflictCopyPath } from "../domain/conflict-path";

/** Path to the sha256 of the content this run wrote there (or found there and kept). */
export type Outputs = Record<string, string>;

export type FileStore = {
  /**
   * Writes the DB version at `path`. Returns the path it now holds: `path` itself, or a conflict copy when
   * a differing file already sits there. A file never gets overwritten unless this device's previous run
   * wrote it and it is unchanged since. Identical content is left alone.
   */
  store(path: string, data: string | Uint8Array, hash: string): Promise<string>;
  /** Writes a small sidecar only when nothing is at `path` yet. An existing file is never replaced. */
  writeIfMissing(path: string, text: string): Promise<void>;
  /** Copies written, reused or kept this run. */
  readonly outputs: Outputs;
  /** Conflict copies this run wrote or reused. */
  readonly conflicts: string[];
};

/**
 * The run's no-overwrite writer. `prior` is this device's previous run outputs: a file whose content still
 * matches the hash that run recorded is ours and unchanged, so the new DB version may replace it.
 */
export async function createFileStore(sink: FileSink, prior: Outputs): Promise<FileStore> {
  // Read on first write, so a failed listing throws inside the caller's write try, never here.
  let existingNames: Set<string> | null = null;
  const existing = async (): Promise<Set<string>> => (existingNames ??= new Set(await sink.list()));
  const outputs: Outputs = {};
  const conflicts: string[] = [];

  /** sha256 of what is at `path`, or null when it cannot be read: an unreadable file is never overwritten. */
  const hashAt = async (path: string): Promise<string | null> => {
    try {
      return await sha256Hex(await sink.readBytes(path));
    } catch {
      return null;
    }
  };

  return {
    async store(path, data, hash) {
      // Candidate 0 is the path itself; candidate n (n >= 1) is its nth conflict copy.
      const names = await existing();
      for (let n = 0; ; n++) {
        const candidate = n === 0 ? path : conflictCopyPath(path, n);
        if (!names.has(candidate)) {
          await sink.write(candidate, data);
          names.add(candidate);
        } else {
          const current = await hashAt(candidate);
          if (current === null) continue;
          if (current !== hash) {
            // A file this device wrote and left unchanged takes the new version; anything else is kept.
            if (prior[candidate] !== current) continue;
            await sink.write(candidate, data);
          }
        }
        outputs[candidate] = hash;
        if (candidate !== path) conflicts.push(candidate);
        return candidate;
      }
    },
    async writeIfMissing(path, text) {
      const names = await existing();
      if (!names.has(path)) {
        await sink.write(path, text);
        names.add(path);
        outputs[path] = await sha256Hex(text);
        return;
      }
      // Kept as it is: the output records what is actually on disk, or nothing when it cannot be read.
      const current = await hashAt(path);
      if (current !== null) outputs[path] = current;
    },
    outputs,
    conflicts,
  };
}

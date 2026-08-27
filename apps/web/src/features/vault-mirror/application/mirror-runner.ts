import {
  WORKSPACE_META_DIR,
  mirrorWorkspace,
  type IWorkspaceFs,
  type MirrorResult,
  type WorkspaceSnapshot,
} from "@weaveforge/core";

/**
 * Runs the mirror: at most one at a time, coalesced, and remembering what it
 * wrote last time.
 *
 * `mirrorWorkspace` needs `previousPaths` to know which files have left the
 * workspace, and that list has to outlive the process. It is kept inside the
 * folder rather than in local storage on purpose — the folder can be opened on
 * another machine, and a manifest that travelled separately from the files it
 * describes would be worse than no manifest at all: it would name paths that
 * were never written here and delete files it did not own.
 *
 * A missing or unreadable manifest degrades to "remove nothing", which leaves
 * stale files behind. That is the right way round: a stale file is visible and
 * fixable, a wrongly deleted one is not.
 */

export const MIRROR_MANIFEST_PATH = `${WORKSPACE_META_DIR}/mirror.json`;

async function readManifest(fs: IWorkspaceFs): Promise<string[]> {
  try {
    const parsed = JSON.parse(await fs.readText(MIRROR_MANIFEST_PATH)) as { paths?: unknown };
    if (!Array.isArray(parsed.paths)) return [];
    return parsed.paths.filter((path): path is string => typeof path === "string");
  } catch {
    return [];
  }
}

async function writeManifest(fs: IWorkspaceFs, paths: readonly string[]): Promise<void> {
  await fs.mkdirp(WORKSPACE_META_DIR);
  await fs.writeFile(
    MIRROR_MANIFEST_PATH,
    `${JSON.stringify({ version: 1, paths: [...paths].sort(), writtenAt: new Date().toISOString() }, null, 2)}\n`,
  );
}

export interface MirrorRunnerOptions {
  fs: IWorkspaceFs;
  collect(): Promise<WorkspaceSnapshot>;
  fetchAsset?(storagePath: string): Promise<Uint8Array | null>;
  /** Quiet period after the last request before a run starts. */
  debounceMs?: number;
  onResult?(result: MirrorResult): void;
  onError?(error: unknown): void;
  setTimeoutFn?: (fn: () => void, ms: number) => unknown;
  clearTimeoutFn?: (handle: unknown) => void;
}

export interface MirrorRunner {
  /** Ask for a mirror. Cheap, and safe to call on every save. */
  request(): void;
  /** Run now, waiting for the result. Used by tests and by "mirror now". */
  runNow(): Promise<MirrorResult | null>;
  /** Stop reading from the folder — writes already in flight still finish. */
  stop(): void;
  /** True while a read-back is being applied, so the mirror stands down. */
  suspended: boolean;
}

const DEFAULT_DEBOUNCE_MS = 1_500;

export function createMirrorRunner(options: MirrorRunnerOptions): MirrorRunner {
  const setTimer = options.setTimeoutFn ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = options.clearTimeoutFn ?? ((handle) => clearTimeout(handle as never));
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;

  let timer: unknown = null;
  let running: Promise<MirrorResult | null> | null = null;
  // A save that lands mid-run has to be mirrored *after* it, not folded into a
  // snapshot taken before it happened.
  let again = false;
  let stopped = false;

  const runner: MirrorRunner = {
    suspended: false,

    request() {
      if (stopped || runner.suspended) return;
      if (timer !== null) clearTimer(timer);
      timer = setTimer(() => {
        timer = null;
        void runner.runNow();
      }, debounceMs);
    },

    async runNow(): Promise<MirrorResult | null> {
      if (stopped || runner.suspended) return null;
      if (running) {
        again = true;
        return running;
      }

      running = (async () => {
        try {
          const snapshot = await options.collect();
          const previousPaths = await readManifest(options.fs);
          const result = await mirrorWorkspace(snapshot, options.fs, {
            previousPaths,
            ...(options.fetchAsset ? { fetchAsset: options.fetchAsset } : {}),
          });
          // Unchanged files are still ours, so the manifest carries forward
          // everything the last run claimed and adds what this one wrote. A
          // lost manifest therefore re-learns the folder one write at a time.
          const kept = previousPaths.filter((path) => !result.removed.includes(path));
          await writeManifest(options.fs, [...new Set([...kept, ...result.written])]);
          options.onResult?.(result);
          return result;
        } catch (error) {
          options.onError?.(error);
          return null;
        } finally {
          running = null;
        }
      })();

      const result = await running;
      if (again && !stopped) {
        again = false;
        return runner.runNow();
      }
      again = false;
      return result;
    },

    stop() {
      stopped = true;
      if (timer !== null) clearTimer(timer);
      timer = null;
    },
  };

  return runner;
}

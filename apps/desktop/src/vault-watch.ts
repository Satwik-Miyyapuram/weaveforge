/**
 * Noticing that somebody else changed the folder.
 *
 * The workspace port has nine methods and none of them watch, on purpose: a
 * browser cannot watch a directory it was handed, and a port whose contract
 * only one backing can honour is not a port. Watching therefore lives out here,
 * on the side that actually can, and reaches the renderer as an event rather
 * than as a method it could call anywhere.
 *
 * Two problems make this more than a `fs.watch` call.
 *
 * The first is that the app writes to this folder itself. Every file the mirror
 * puts down is a change the watcher sees, so a naive watcher would tell the
 * renderer that the folder changed each time the renderer changed it, and the
 * user would be asked to review their own edits. The write handlers say what
 * they wrote and those paths are ignored for a moment afterwards.
 *
 * The second is that editors do not save files once. A single save in Obsidian
 * or VS Code can arrive as a write, a rename, and a second write within a few
 * milliseconds, and an atomic save is a create-and-replace rather than a write
 * at all. So events are collected and reported as one batch after things go
 * quiet, and the batch carries paths rather than a description of what happened
 * to them -- what happened is a question the reader answers better by looking.
 */

/** Long enough to cover a write and its own echo, short enough to feel live. */
export const SELF_WRITE_WINDOW_MS = 2_000;

/** Long enough for an editor to finish saving, short enough to feel live. */
export const QUIET_MS = 400;

export interface VaultWatchOptions {
  /** Called with the paths that changed, once things go quiet. */
  onChange(paths: string[]): void;
  /**
   * Put a path into the one form both sides are compared in.
   *
   * The two sides arrive spelled differently: the renderer sends a workspace
   * path that the writer folds before using, while the watcher reports what
   * the filesystem called it. Comparing them unfolded means a write never
   * matches its own echo, and every file the app writes is announced back to
   * it as somebody else's change.
   */
  normalize?: (path: string) => string;
  now?: () => number;
  quietMs?: number;
  selfWriteWindowMs?: number;
  setTimeoutFn?: (fn: () => void, ms: number) => unknown;
  clearTimeoutFn?: (handle: unknown) => void;
}

export interface VaultWatch {
  /** This process wrote it; the echo is not news. */
  noteSelfWrite(path: string): void;
  /** The filesystem reported a path. */
  saw(path: string): void;
  /** Drop anything pending. Reported changes already delivered stay delivered. */
  stop(): void;
}

export function createVaultWatch(options: VaultWatchOptions): VaultWatch {
  const normalize = options.normalize ?? ((path: string) => path);
  const now = options.now ?? (() => Date.now());
  const quietMs = options.quietMs ?? QUIET_MS;
  const selfWindow = options.selfWriteWindowMs ?? SELF_WRITE_WINDOW_MS;
  const setTimer = options.setTimeoutFn ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = options.clearTimeoutFn ?? ((handle) => clearTimeout(handle as never));

  /** Path -> when this process last wrote it. */
  const mine = new Map<string, number>();
  const pending = new Set<string>();
  let timer: unknown = null;

  function flush(): void {
    timer = null;
    if (pending.size === 0) return;
    const paths = [...pending].sort();
    pending.clear();
    options.onChange(paths);
  }

  return {
    noteSelfWrite(path: string) {
      const at = now();
      mine.set(normalize(path), at);
      // Swept here rather than on a timer of its own: the map only grows while
      // the app is writing, and the app writing is exactly when this runs.
      for (const [seen, when] of mine) {
        if (at - when > selfWindow) mine.delete(seen);
      }
    },

    saw(raw: string) {
      const path = normalize(raw);
      const written = mine.get(path);
      if (written !== undefined && now() - written <= selfWindow) {
        // Our own echo. Forget it, so that a second change to the same file
        // moments later is still reported: an editor saving over a file the
        // mirror has just written is the case this must not swallow twice.
        mine.delete(path);
        return;
      }
      pending.add(path);
      if (timer !== null) clearTimer(timer);
      timer = setTimer(flush, quietMs);
    },

    stop() {
      if (timer !== null) clearTimer(timer);
      timer = null;
      pending.clear();
      mine.clear();
    },
  };
}

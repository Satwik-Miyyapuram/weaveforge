import type { DesktopVaultSync } from "@/lib/desktop/desktop-bridge";
import { formatError } from "@/lib/format-error";

/**
 * Automatic git sync for the workspace folder: pull, then push, with no button.
 *
 * Runs ten seconds after the last folder commit, when started, every five
 * minutes, and when the window regains focus or the machine comes back online.
 * One run at a time; asking during a run queues exactly one more. A failure
 * waits 30 s, then 1 min, then 5 min before trying again, and a success resets
 * that. Offline, nothing runs. With no remote or no token it does nothing.
 *
 * It only pulls and pushes, as the Settings buttons do: whatever a pull writes
 * into the folder is taken in by the folder watcher, as before.
 */

export const AUTO_SYNC_TIMING = {
  afterCommitMs: 10_000,
  intervalMs: 5 * 60_000,
  backoffMs: [30_000, 60_000, 5 * 60_000] as readonly number[],
};

export type AutoSyncState =
  | { kind: "off" }
  | { kind: "idle"; syncedAt: number; pulled: boolean }
  | { kind: "syncing" }
  | { kind: "offline" }
  | { kind: "error"; message: string; retryAt: number };

export interface AutoSyncDeps {
  /** The remote as the shell holds it. */
  remote(): Promise<{ url: string | null; hasToken: boolean }>;
  /** Pull, then push; no push after a conflicted pull. */
  sync(): Promise<{ pulled: DesktopVaultSync; pushed: DesktopVaultSync | null }>;
  isOnline(): boolean;
  now(): number;
}

export interface AutoSync {
  /** Sync now and every five minutes after. Starting again changes nothing. */
  start(): void;
  /** Stop every timer; a run in flight finishes, and nothing follows it. */
  stop(): void;
  /** A folder commit landed: sync once the commits stop for ten seconds. */
  afterCommit(): void;
  /** Sync now, unless offline or waiting out a failure. */
  nudge(): void;
  /** Sync now, cutting short the wait after a failure. */
  retry(): void;
  setOnline(online: boolean): void;
  state(): AutoSyncState;
  subscribe(listener: () => void): () => void;
}

/** Why a run that did not throw still failed, or null. */
function problemOf({ pulled, pushed }: Awaited<ReturnType<AutoSyncDeps["sync"]>>): string | null {
  if (pulled.pull?.kind === "conflict") {
    const n = pulled.pull.files.length;
    return `${n} ${n === 1 ? "file" : "files"} changed on both sides. Choose which copy to keep in Settings, Workspace.`;
  }
  if (pushed?.push?.kind === "rejected") return pushed.push.reason;
  return null;
}

export function createAutoSync(deps: AutoSyncDeps, timing = AUTO_SYNC_TIMING): AutoSync {
  let current: AutoSyncState = { kind: "off" };
  const listeners = new Set<() => void>();
  let interval: ReturnType<typeof setInterval> | null = null;
  let commitTimer: ReturnType<typeof setTimeout> | null = null;
  let backoffTimer: ReturnType<typeof setTimeout> | null = null;
  let failures = 0;
  let running = false;
  let again = false;
  let stopped = false;

  const set = (next: AutoSyncState) => {
    current = next;
    for (const listener of [...listeners]) listener();
  };

  const clearBackoff = () => {
    if (backoffTimer) clearTimeout(backoffTimer);
    backoffTimer = null;
  };

  const fail = (message: string) => {
    const wait = timing.backoffMs[Math.min(failures, timing.backoffMs.length - 1)]!;
    failures++;
    clearBackoff();
    backoffTimer = setTimeout(() => {
      backoffTimer = null;
      request();
    }, wait);
    set({ kind: "error", message, retryAt: deps.now() + wait });
  };

  const once = async () => {
    if (!deps.isOnline()) return set({ kind: "offline" });
    try {
      const remote = await deps.remote();
      if (!remote.url || !remote.hasToken) return set({ kind: "off" });
      set({ kind: "syncing" });
      const outcome = await deps.sync();
      const problem = problemOf(outcome);
      if (problem) return fail(problem);
      failures = 0;
      const kind = outcome.pulled.pull?.kind;
      set({ kind: "idle", syncedAt: deps.now(), pulled: kind === "fast-forward" || kind === "merged" });
    } catch (error) {
      fail(formatError(error));
    }
  };

  const request = () => {
    if (running) {
      again = true;
      return;
    }
    running = true;
    void (async () => {
      do {
        again = false;
        await once();
      } while (again && !backoffTimer && !stopped);
      again = false;
      running = false;
    })();
  };

  const nudge = () => {
    stopped = false;
    if (!deps.isOnline()) return set({ kind: "offline" });
    if (backoffTimer) return;
    request();
  };

  return {
    start() {
      stopped = false;
      if (interval) return;
      interval = setInterval(nudge, timing.intervalMs);
      nudge();
    },
    stop() {
      stopped = true;
      if (interval) clearInterval(interval);
      interval = null;
      if (commitTimer) clearTimeout(commitTimer);
      commitTimer = null;
      clearBackoff();
    },
    afterCommit() {
      if (commitTimer) clearTimeout(commitTimer);
      commitTimer = setTimeout(() => {
        commitTimer = null;
        nudge();
      }, timing.afterCommitMs);
    },
    nudge,
    retry() {
      clearBackoff();
      nudge();
    },
    setOnline(online) {
      if (online) nudge();
      else set({ kind: "offline" });
    },
    state: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/*
 * The one engine the app runs, as the status dot sees it. The host that
 * starts the engine shows it here; the dot reads this and needs nothing else.
 */

const OFF: AutoSyncState = { kind: "off" };
let view: AutoSyncState = OFF;
let retryShown: () => void = () => undefined;
const viewListeners = new Set<() => void>();

const announceView = (next: AutoSyncState) => {
  view = next;
  for (const listener of [...viewListeners]) listener();
};

/** Show this engine's state to the status dot; the answer hides it again. */
export function showAutoSync(engine: AutoSync): () => void {
  retryShown = () => engine.retry();
  const off = engine.subscribe(() => announceView(engine.state()));
  announceView(engine.state());
  return () => {
    off();
    retryShown = () => undefined;
    announceView(OFF);
  };
}

export function autoSyncView(): AutoSyncState {
  return view;
}

export function onAutoSyncView(listener: () => void): () => void {
  viewListeners.add(listener);
  return () => viewListeners.delete(listener);
}

/** The status dot's retry. */
export function retryAutoSync(): void {
  retryShown();
}

/**
 * Run the engine for the app: show it, start it, and follow folder commits,
 * window focus and the network. The answer undoes all of it.
 */
export function wireAutoSync(
  engine: AutoSync,
  { onCommit, target }: { onCommit: (listener: () => void) => () => void; target: EventTarget },
): () => void {
  const hide = showAutoSync(engine);
  const offCommit = onCommit(() => engine.afterCommit());
  const onFocus = () => engine.nudge();
  const onOnline = () => engine.setOnline(true);
  const onOffline = () => engine.setOnline(false);
  target.addEventListener("focus", onFocus);
  target.addEventListener("online", onOnline);
  target.addEventListener("offline", onOffline);
  engine.start();
  return () => {
    engine.stop();
    target.removeEventListener("focus", onFocus);
    target.removeEventListener("online", onOnline);
    target.removeEventListener("offline", onOffline);
    offCommit();
    hide();
  };
}

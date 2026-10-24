/**
 * Holds one built value per key and rebuilds it when the key changes.
 *
 * The app container is the user: its key is the backend and storage provider,
 * and a build is slow (a dynamic import, then the wiring). Builds can overlap
 * when the config changes mid-build, so each build takes a generation number
 * and only the newest may install itself. An older build that finishes later is
 * disposed instead, so it neither puts a stale key in place nor leaves the
 * newer build's channel and cache registrations undisposed.
 */
export interface RebuildSlot<T> {
  /** The value built for `key`, or null if none is installed for it. */
  get(key: string): T | null;
  /** The value for `key`, building it (once, however many callers) if needed. */
  ensure(key: string): Promise<T>;
}

export function createRebuildSlot<T extends { dispose(): void }>(build: () => Promise<T>): RebuildSlot<T> {
  let current: T | null = null;
  let currentKey: string | null = null;
  let pending: Promise<T> | null = null;
  let pendingKey: string | null = null;
  let generation = 0;

  function get(key: string): T | null {
    return current && currentKey === key ? current : null;
  }

  async function ensure(key: string): Promise<T> {
    const ready = get(key);
    if (ready) return ready;
    if (pending && pendingKey === key) return pending;

    const mine = ++generation;
    const run = (async () => {
      const created = await build();
      if (mine !== generation) {
        // A newer build started meanwhile; it owns the slot.
        created.dispose();
        const newer = pending ?? current;
        if (!newer) throw new Error("The container was rebuilt for a newer configuration, and that build failed.");
        return newer;
      }
      // Disposed after the new one is built, so a failure to build leaves the
      // working one in place rather than tearing down the app on a bad config.
      const previous = current;
      current = created;
      currentKey = key;
      if (previous && previous !== created) previous.dispose();
      return created;
    })();
    pending = run;
    pendingKey = key;

    try {
      return await run;
    } finally {
      if (pending === run) {
        pending = null;
        pendingKey = null;
      }
    }
  }

  return { get, ensure };
}

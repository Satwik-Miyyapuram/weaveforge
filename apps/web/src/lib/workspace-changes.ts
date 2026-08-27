/**
 * One place that says the workspace changed.
 *
 * Deliberately not a general event bus. It carries a table name and nothing
 * else, because the things listening -- the folder mirror today, the local HTTP
 * surface and the MCP server in `interop-surface.md` -- all re-read what they
 * need anyway. A richer event would be a second description of the data that
 * has to be kept true alongside the first.
 *
 * Module-level rather than held in the container: the container is rebuilt when
 * the project changes, and a listener that had to be re-registered each time
 * would go quiet exactly when the workspace is busiest.
 */

export type WorkspaceChangeListener = (table: string) => void;

const listeners = new Set<WorkspaceChangeListener>();

/** Listen. Returns the unsubscribe, which callers should actually call. */
export function onWorkspaceChange(listener: WorkspaceChangeListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Announce a change.
 *
 * One listener throwing must not stop the others hearing about it, and must
 * not reach the write that triggered this.
 */
export function notifyWorkspaceChange(table: string): void {
  for (const listener of [...listeners]) {
    try {
      listener(table);
    } catch {
      // A listener's problem is its own; the write already succeeded.
    }
  }
}

/** Drop every listener. For tests, which should not leak into each other. */
export function resetWorkspaceChangeListeners(): void {
  listeners.clear();
}

/**
 * Getting a sign-in link from the OS to the page without losing it (38-07).
 *
 * When no window is open, the main process creates one and sends the sign-in
 * at once. That message is dropped twice over: the page has not loaded, and
 * even once it has, the web app subscribes only after React mounts. These two
 * helpers close both gaps. No Electron import, so both run in plain tests.
 */

/** The part of `WebContents` used here. */
export interface LoadingContents {
  isLoading(): boolean;
  once(event: "did-finish-load", listener: () => void): unknown;
  send(channel: string, ...args: unknown[]): void;
}

/** Send now if the page is loaded, else once it finishes loading. */
export function sendWhenLoaded(contents: LoadingContents, channel: string, ...args: unknown[]): void {
  if (contents.isLoading()) contents.once("did-finish-load", () => contents.send(channel, ...args));
  else contents.send(channel, ...args);
}

/**
 * Holds the newest sign-in that arrived while nobody listened and hands it to
 * the next subscriber, once. Live sign-ins go straight to the listeners.
 */
export function createSignInInbox() {
  const listeners = new Set<(query: string) => void>();
  let pending: string | null = null;
  return {
    deliver(query: string): void {
      if (listeners.size === 0) pending = query;
      else for (const listener of listeners) listener(query);
    },
    subscribe(listener: (query: string) => void): () => void {
      listeners.add(listener);
      if (pending !== null) {
        const query = pending;
        pending = null;
        listener(query);
      }
      return () => listeners.delete(listener);
    },
  };
}

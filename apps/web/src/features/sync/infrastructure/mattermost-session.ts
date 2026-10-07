/**
 * A one-shot signal that a Mattermost session token stopped working.
 *
 * Posts run in the background and swallow their errors, so a 401 there has no
 * call site that can show anything. The notifier emits here instead, and one
 * listener near the app root raises the shared "signed out" dialog. Kept as a
 * module event, not React state, because the emitter is plain infrastructure.
 */

export interface MattermostSignedOut {
  /** Server URL (the integration's `repo`), so the dialog can re-sign-in to it. */
  serverUrl: string;
}

type Listener = (detail: MattermostSignedOut) => void;

const listeners = new Set<Listener>();

export function onMattermostSignedOut(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitMattermostSignedOut(detail: MattermostSignedOut): void {
  for (const listener of listeners) listener(detail);
}

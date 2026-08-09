/**
 * When a collaborative editor is allowed to write its document back to the row.
 *
 * Kept out of the editor component because getting this wrong is not a
 * rendering bug, it is data loss and a UI that fights the user — and both
 * failures it guards against actually happened:
 *
 *  * **Saving before the document is ready.** The Yjs document is empty until
 *    the CRDT log has been replayed and the seed has run. A save in that window
 *    writes an empty body over a real one; the logbook rejected it outright
 *    ("Log entry body is required") and the vault would have accepted it.
 *
 *  * **Saving something that did not change.** Opening the editor seeded the
 *    document, which tripped the observer, which queued a save of the body that
 *    was already stored. The host closed the form on save, so the editor shut
 *    itself the instant it opened — the "Edit does nothing" bug.
 */
export interface SaveDecisionInput {
  /** Has the CRDT log been replayed and the seed run? */
  ready: boolean;
  /** The document's current text. */
  next: string;
  /** The body as the server last saw it. */
  lastSaved: string;
}

export function shouldPersistBody({ ready, next, lastSaved }: SaveDecisionInput): boolean {
  if (!ready) return false;
  return next !== lastSaved;
}

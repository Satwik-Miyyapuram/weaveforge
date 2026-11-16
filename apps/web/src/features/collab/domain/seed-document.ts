import * as Y from "yjs";

/**
 * The pinned client id every seed is authored by.
 *
 * Zotero-style content keys aside, a CRDT identifies an operation by
 * `(clientId, clock)`. Two clients seeding "the same" text with their own ids
 * author two *different* operations, and Yjs is right to keep both. Pinning the
 * id makes the operation identical everywhere, so it deduplicates itself.
 *
 * Zero is safe because no live document ever uses it: `Y.Doc` draws a random
 * 32-bit client id, and a collision would need that draw to land on exactly 0.
 */
const SEED_CLIENT_ID = 0;

/**
 * A row's stored body as a Yjs update that every client generates identically.
 *
 * Seeding with a local `yText.insert(0, body)` cannot work for more than one
 * client. Each insert is a distinct operation from a distinct author, so two
 * people opening the same never-co-edited note both insert the body and the
 * document ends up holding it twice — which is exactly what happened, and read
 * as the note silently doubling on every reopen.
 *
 * Building the update from a throwaway document pinned to one client id makes
 * the bytes identical wherever it is produced, so Yjs recognises it as
 * already-applied. Contributed by one client or by ten, replayed once or on
 * every open, the document holds one copy.
 */
export function seedUpdate(body: string): Uint8Array {
  const seedDoc = new Y.Doc();
  seedDoc.clientID = SEED_CLIENT_ID;
  seedDoc.getText("body").insert(0, body);
  const update = Y.encodeStateAsUpdate(seedDoc);
  seedDoc.destroy();
  return update;
}

/**
 * Put `body` into `doc` if — and only if — the document is still empty.
 *
 * The emptiness check is the second half of the guard: seeding on top of a
 * replayed log would append a second copy of text the log already carries. A
 * document with history is reconciled with the body instead (`reconcileWithBody`).
 */
export function seedIfEmpty(doc: Y.Doc, body: string): boolean {
  const yText = doc.getText("body");
  if (yText.length > 0 || !body) return false;
  Y.applyUpdate(doc, seedUpdate(body));
  return true;
}

// --- the body is the source of truth; the CRDT log is the live session's copy ---

/** How many saved bodies a document remembers; older ones fall off the front. */
export const SAVED_BODIES_KEPT = 16;

/** Digests of bodies this document's live sessions saved to the row, oldest first. */
function savedBodies(doc: Y.Doc): Y.Array<string> {
  return doc.getArray<string>("savedBodies");
}

/** The digests this document's sessions saved: those bodies are not someone else's edit. */
export function savedDigests(doc: Y.Doc): string[] {
  return savedBodies(doc).toArray();
}

/**
 * Remember that the body with `digest` was saved from this document, as the
 * newest mark. A peer that receives the mark already holds the text it names
 * (Yjs applies one client's updates in order).
 *
 * Peers mark concurrently, so the array can hold a digest twice; each mark
 * keeps only the newest copy of every digest, and the newest
 * `SAVED_BODIES_KEPT` of those.
 */
export function markSaved(doc: Y.Doc, digest: string): void {
  const saved = savedBodies(doc);
  const marks = saved.toArray();
  const last = marks.length - 1;
  if (last >= 0 && marks.indexOf(digest) === last && marks.length <= SAVED_BODIES_KEPT) return;
  doc.transact(() => {
    saved.push([digest]);
    const all = saved.toArray();
    const kept = new Set<string>();
    for (let i = all.length - 1; i >= 0; i -= 1) {
      const mark = all[i] ?? "";
      if (kept.has(mark) || kept.size >= SAVED_BODIES_KEPT) saved.delete(i, 1);
      else kept.add(mark);
    }
  });
}

/** Forget a mark whose save did not land, so the body is not claimed as saved. */
export function unmarkSaved(doc: Y.Doc, digest: string): void {
  const saved = savedBodies(doc);
  const marks = saved.toArray();
  if (!marks.includes(digest)) return;
  doc.transact(() => {
    for (let i = marks.length - 1; i >= 0; i -= 1) if (marks[i] === digest) saved.delete(i, 1);
  });
}

/**
 * A 32-bit FNV-1a hash of a document's state and a body, never the seed's
 * client id. The state is the snapshot, delete set included: two documents can
 * share a state vector while holding different text (a delete adds no clock).
 */
function clientIdFor(doc: Y.Doc, body: string): number {
  let hash = 0x811c9dc5;
  const mix = (byte: number) => {
    hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  };
  Y.encodeSnapshot(Y.snapshot(doc)).forEach(mix);
  for (let i = 0; i < body.length; i += 1) {
    const unit = body.charCodeAt(i);
    mix(unit & 0xff);
    mix(unit >>> 8);
  }
  return hash === SEED_CLIENT_ID ? 1 : hash;
}

/**
 * Make `doc`'s text equal `body`, replacing only the span between the common
 * prefix and suffix.
 *
 * The edit is authored by a client id derived from the document's state and
 * the target body. Two clients rebuilding the same state to the same body make
 * the same operation, which Yjs keeps once; clients that started from
 * different states use different ids, so their operations never collide.
 */
export function rebuildTo(doc: Y.Doc, body: string): void {
  const current = doc.getText("body").toString();
  if (current === body) return;
  let start = 0;
  while (start < current.length && start < body.length && current[start] === body[start]) start += 1;
  let end = 0;
  while (
    end < current.length - start &&
    end < body.length - start &&
    current[current.length - 1 - end] === body[body.length - 1 - end]
  ) {
    end += 1;
  }
  const scratch = new Y.Doc();
  Y.applyUpdate(scratch, Y.encodeStateAsUpdate(doc));
  scratch.clientID = clientIdFor(doc, body);
  const before = Y.encodeStateVector(scratch);
  const text = scratch.getText("body");
  scratch.transact(() => {
    text.delete(start, current.length - start - end);
    text.insert(start, body.slice(start, body.length - end));
  });
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(scratch, before));
  scratch.destroy();
}

/**
 * Bring the body the store wrote into the document, when it differs from the
 * one sent (the store merged in someone else's save).
 *
 * `sentState` is the document's state when the save was sent: the change from
 * the sent text to the stored one is made against it and merged in, so text
 * typed while the save was in flight is kept. Made with `rebuildTo`, so peers
 * that do the same for one save make the same operation. Applied as a remote
 * update: the body is already stored, and this is not an edit to save.
 */
export function applyStoredBody(doc: Y.Doc, sentState: Uint8Array, stored: string): void {
  const sent = new Y.Doc();
  Y.applyUpdate(sent, sentState);
  rebuildTo(sent, stored);
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(sent, Y.encodeStateVectorFromUpdate(sentState)));
  sent.destroy();
}

/** The heading over live text the stored body lacked, kept when it cannot tell which is newer. */
export const KEPT_LIVE_TEXT_HEADING = "**Kept from this note's live copy (check it, then delete this block):**";

/** What reconciling a replayed document with its row left. */
export interface Reconciled {
  /** The body the row holds: where the saver starts from. */
  saved: string;
  /** The document now holds text the row lacks, which should be saved. */
  dirty: boolean;
}

/**
 * Reconcile a document replayed from its CRDT log with the row's `body`.
 *
 * The body is the source of truth. Every writer saves it (the workspace, the
 * vault editor, the assistant, imports, a device that was offline), while only
 * a live session writes the log. So the log is trusted only as far as it can be
 * shown to be newer, and a body some session of this document saved is one the
 * log already carries:
 *  - an empty document takes the body;
 *  - the same text, or a body this document saved: the log is as new or newer,
 *    so it is kept (and saved, if it is ahead: that save never landed);
 *  - a body it did not save, while the log's text is one it did: the body was
 *    changed elsewhere, so the log is rebuilt to it;
 *  - otherwise both changed, or the document predates these marks: the body
 *    wins and the log's lines it lacks are kept in a marked block, so neither
 *    side's text is lost.
 */
export function reconcileWithBody(doc: Y.Doc, body: string, digest: (text: string) => string): Reconciled {
  const crdt = doc.getText("body").toString();
  const bodyDigest = digest(body);
  if (crdt.length === 0) {
    seedIfEmpty(doc, body);
    if (body) markSaved(doc, bodyDigest);
    return { saved: body, dirty: false };
  }
  const saved = savedDigests(doc);
  if (crdt === body || saved.includes(bodyDigest)) {
    markSaved(doc, bodyDigest);
    return { saved: body, dirty: crdt !== body };
  }
  if (saved.includes(digest(crdt))) {
    rebuildTo(doc, body);
    markSaved(doc, bodyDigest);
    return { saved: body, dirty: false };
  }
  const bodyLines = new Set(body.split("\n"));
  const liveOnly = crdt.split("\n").filter((line) => line.trim() !== "" && !bodyLines.has(line));
  const kept = liveOnly.length > 0 ? `${body}\n\n${KEPT_LIVE_TEXT_HEADING}\n\n${liveOnly.join("\n")}\n` : body;
  rebuildTo(doc, kept);
  markSaved(doc, bodyDigest);
  return { saved: body, dirty: kept !== body };
}

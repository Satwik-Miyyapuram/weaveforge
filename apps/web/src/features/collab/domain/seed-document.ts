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
 * The emptiness check is the second half of the guard. The CRDT log is the
 * truth for any resource that has been co-edited before, so seeding on top of a
 * replayed log would append a second copy of text the log already carries. Only
 * a document with no history takes the row's body.
 */
export function seedIfEmpty(doc: Y.Doc, body: string): boolean {
  const yText = doc.getText("body");
  if (yText.length > 0 || !body) return false;
  Y.applyUpdate(doc, seedUpdate(body));
  return true;
}

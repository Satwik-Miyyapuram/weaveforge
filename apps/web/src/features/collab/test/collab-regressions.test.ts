/**
 * Regression tests for the bugs that made collaborative editing not work at
 * all. Each one names the failure it prevents, because none of them are
 * obvious from the code they guard.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as Y from "yjs";

import { seedIfEmpty, seedUpdate } from "../domain/seed-document";
import { shouldPersistBody } from "../domain/save-policy";
import { encodeRealtimeMessageAsJson } from "@/backend/providers/supabase/client";

const text = (doc: Y.Doc) => doc.getText("body").toString();

// ---------------------------------------------------------------------------
// Seeding — the note-doubling bug.
// ---------------------------------------------------------------------------

test("seed: two clients produce byte-identical updates", () => {
  // The whole mechanism rests on this. If the bytes ever differ — a changed
  // client id, a different field name, a Yjs encoding change — the updates
  // stop deduplicating and every reopen doubles the text again.
  const a = seedUpdate("Prof A: reviewed the graph clusters.");
  const b = seedUpdate("Prof A: reviewed the graph clusters.");
  assert.deepEqual([...a], [...b]);
});

test("seed: applying the same seed twice leaves one copy", () => {
  const doc = new Y.Doc();
  const body = "one copy only";
  Y.applyUpdate(doc, seedUpdate(body));
  Y.applyUpdate(doc, seedUpdate(body));
  assert.equal(text(doc), body);
});

test("seed: two independent clients converge on one copy", () => {
  // The original bug, exactly: two people open a note that has never been
  // co-edited, both seed it, the updates meet, and the CRDT keeps both inserts.
  const body = "collaboratively opened, once";
  const alice = new Y.Doc();
  const bob = new Y.Doc();
  seedIfEmpty(alice, body);
  seedIfEmpty(bob, body);

  // Exchange, as the provider would.
  Y.applyUpdate(bob, Y.encodeStateAsUpdate(alice));
  Y.applyUpdate(alice, Y.encodeStateAsUpdate(bob));

  assert.equal(text(alice), body, "alice sees one copy");
  assert.equal(text(bob), body, "bob sees one copy");
});

test("seed: a document with history is never seeded over", () => {
  // The replayed CRDT log is the truth. Seeding on top of it appended the
  // row's body to text the log already carried.
  const doc = new Y.Doc();
  doc.getText("body").insert(0, "edited by hand, and since persisted");
  const seeded = seedIfEmpty(doc, "the row's stale body");
  assert.equal(seeded, false);
  assert.equal(text(doc), "edited by hand, and since persisted");
});

test("seed: an empty body seeds nothing", () => {
  const doc = new Y.Doc();
  assert.equal(seedIfEmpty(doc, ""), false);
  assert.equal(text(doc), "");
});

test("seed: local edits survive a peer's seed of the original body", () => {
  const body = "original";
  const alice = new Y.Doc();
  seedIfEmpty(alice, body);
  alice.getText("body").insert(alice.getText("body").length, " plus alice's edit");

  const bob = new Y.Doc();
  seedIfEmpty(bob, body);
  Y.applyUpdate(bob, Y.encodeStateAsUpdate(alice));

  assert.equal(text(bob), "original plus alice's edit");
});

// ---------------------------------------------------------------------------
// Save gating — the "Edit does nothing" bug.
// ---------------------------------------------------------------------------

test("save: nothing is written before the document is ready", () => {
  // An empty document written over a real body. The logbook rejected it with
  // "Log entry body is required"; the vault would have accepted the deletion.
  assert.equal(
    shouldPersistBody({ ready: false, next: "", lastSaved: "a real body" }),
    false,
  );
  assert.equal(
    shouldPersistBody({ ready: false, next: "even a plausible body", lastSaved: "a real body" }),
    false,
  );
});

test("save: an unchanged body is not written back", () => {
  // Opening the editor seeded the document, which tripped the observer, which
  // queued a save — and the host closed the form on save. The form shut itself
  // the moment it opened.
  assert.equal(
    shouldPersistBody({ ready: true, next: "unchanged", lastSaved: "unchanged" }),
    false,
  );
});

test("save: a real edit is written", () => {
  assert.equal(
    shouldPersistBody({ ready: true, next: "edited", lastSaved: "original" }),
    true,
  );
});

test("save: clearing a body deliberately is still a real edit", () => {
  // Distinct from the not-ready case above: once ready, an empty document means
  // the user emptied it, and refusing that would silently discard their edit.
  assert.equal(shouldPersistBody({ ready: true, next: "", lastSaved: "had text" }), true);
});

// ---------------------------------------------------------------------------
// Realtime frames — the socket that died on every send.
// ---------------------------------------------------------------------------

test("realtime: a broadcast push encodes as a JSON text frame", () => {
  // `realtime-js` binary-encodes every broadcast push, and the self-hosted
  // Realtime answers that frame kind by tearing the whole websocket down with a
  // 1011 — taking the co-editing channel and the cache-invalidation channel
  // with it, while every `phx_join` still reported SUBSCRIBED.
  let encoded: unknown;
  encodeRealtimeMessageAsJson(
    {
      join_ref: "9",
      ref: "16",
      topic: "realtime:crdt:vault_page:abc",
      event: "broadcast",
      payload: { type: "broadcast", event: "yjs", payload: { data: "AQTM+N3gCg==" } },
    },
    (result) => {
      encoded = result;
    },
  );

  assert.equal(typeof encoded, "string", "must be a text frame, never an ArrayBuffer");
  assert.deepEqual(JSON.parse(encoded as string), [
    "9",
    "16",
    "realtime:crdt:vault_page:abc",
    "broadcast",
    { type: "broadcast", event: "yjs", payload: { data: "AQTM+N3gCg==" } },
  ]);
});

test("realtime: a join frame keeps the same tuple shape", () => {
  let encoded = "";
  encodeRealtimeMessageAsJson(
    { join_ref: "1", ref: "1", topic: "realtime:proj:p1", event: "phx_join", payload: { config: {} } },
    (r) => {
      encoded = r;
    },
  );
  const tuple = JSON.parse(encoded) as unknown[];
  assert.equal(tuple.length, 5);
  assert.equal(tuple[3], "phx_join");
});

test("realtime: a null join_ref survives encoding", () => {
  // Phoenix sends `null` for join_ref on some frames; dropping it or coercing
  // it to a string would desynchronise the server's ref tracking.
  let encoded = "";
  encodeRealtimeMessageAsJson(
    { join_ref: null, ref: "4", topic: "realtime:proj:p1", event: "heartbeat", payload: {} },
    (r) => {
      encoded = r;
    },
  );
  assert.equal((JSON.parse(encoded) as unknown[])[0], null);
});

/**
 * Y3: the row's body is the source of truth and the CRDT log is the live
 * session's copy. Reopening a note reconciles the two: a stale log is rebuilt to
 * a newer body, a log ahead of the body is saved, and when neither can be shown
 * newer both texts are kept.
 */
import { before, test } from "node:test";
import assert from "node:assert/strict";
import * as Y from "yjs";

import {
  KEPT_LIVE_TEXT_HEADING,
  SAVED_BODIES_KEPT,
  markSaved,
  reconcileWithBody,
  savedDigests,
  seedIfEmpty,
} from "../domain/seed-document";
import { readyCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";

before(async () => {
  await loadTestCore();
});

const digest = (body: string) => readyCore().digestText(body);
const text = (doc: Y.Doc) => doc.getText("body").toString();

/** A document whose live session saved `saved`, then typed on to `live`. */
function sessionDoc(saved: string, live = saved): Y.Doc {
  const doc = new Y.Doc();
  seedIfEmpty(doc, saved);
  markSaved(doc, digest(saved));
  const yText = doc.getText("body");
  if (live !== saved) {
    yText.delete(0, yText.length);
    yText.insert(0, live);
  }
  return doc;
}

test("reconcile: an empty document takes the body and is clean", () => {
  const doc = new Y.Doc();
  const result = reconcileWithBody(doc, "stored", digest);
  assert.deepEqual(result, { saved: "stored", dirty: false });
  assert.equal(text(doc), "stored");
  assert.deepEqual(savedDigests(doc), [digest("stored")]);
});

test("reconcile: an empty document and an empty body stay empty", () => {
  const doc = new Y.Doc();
  assert.deepEqual(reconcileWithBody(doc, "", digest), { saved: "", dirty: false });
  assert.equal(text(doc), "");
  assert.deepEqual(savedDigests(doc), []);
});

test("reconcile: the same text is kept untouched", () => {
  const doc = sessionDoc("same");
  const before = Y.encodeStateVector(doc);
  assert.deepEqual(reconcileWithBody(doc, "same", digest), { saved: "same", dirty: false });
  assert.deepEqual(Y.encodeStateVector(doc), before, "no new operation");
});

test("reconcile: a log ahead of a body it saved is kept and marked dirty", () => {
  // The session saved "v1", typed on, and closed before the next save landed.
  const doc = sessionDoc("v1", "v1 and more");
  const result = reconcileWithBody(doc, "v1", digest);
  assert.deepEqual(result, { saved: "v1", dirty: true });
  assert.equal(text(doc), "v1 and more", "the unsaved typing survives");
});

test("reconcile: a body changed elsewhere rebuilds the stale log", () => {
  // The log holds what the session saved; the assistant then rewrote the row.
  const doc = sessionDoc("first draft");
  const result = reconcileWithBody(doc, "rewritten by the assistant", digest);
  assert.deepEqual(result, { saved: "rewritten by the assistant", dirty: false });
  assert.equal(text(doc), "rewritten by the assistant");
  assert.ok(savedDigests(doc).includes(digest("rewritten by the assistant")));
});

test("reconcile: a newer body is never overwritten by the log", () => {
  const doc = sessionDoc("old");
  reconcileWithBody(doc, "new", digest);
  // Reopening again agrees and changes nothing.
  assert.deepEqual(reconcileWithBody(doc, "new", digest), { saved: "new", dirty: false });
  assert.equal(text(doc), "new");
});

test("reconcile: when both changed, the body wins and the live lines are kept", () => {
  // Saved "a", typed "a\nlive line", never saved; elsewhere the body became "b".
  const doc = sessionDoc("a", "a\nlive line");
  const result = reconcileWithBody(doc, "b", digest);
  assert.equal(result.saved, "b");
  assert.equal(result.dirty, true, "the kept block is saved");
  assert.equal(text(doc), `b\n\n${KEPT_LIVE_TEXT_HEADING}\n\na\nlive line\n`);
});

test("reconcile: a legacy document with no marks keeps its differing lines once", () => {
  const doc = new Y.Doc();
  doc.getText("body").insert(0, "shared\nonly in the log");
  const first = reconcileWithBody(doc, "shared\nonly in the row", digest);
  assert.equal(first.dirty, true);
  const kept = text(doc);
  assert.equal(kept, `shared\nonly in the row\n\n${KEPT_LIVE_TEXT_HEADING}\n\nonly in the log\n`);

  // The kept text is saved; reopening against it nests nothing.
  markSaved(doc, digest(kept));
  assert.deepEqual(reconcileWithBody(doc, kept, digest), { saved: kept, dirty: false });
  assert.equal(text(doc), kept);
});

test("reconcile: a log whose lines the body already has is rebuilt with no block", () => {
  const doc = new Y.Doc();
  doc.getText("body").insert(0, "one\ntwo");
  const result = reconcileWithBody(doc, "one\ntwo\nthree", digest);
  assert.deepEqual(result, { saved: "one\ntwo\nthree", dirty: false });
  assert.equal(text(doc), "one\ntwo\nthree");
});

test("reconcile: two clients rebuilding the same state agree on one copy", () => {
  const origin = sessionDoc("stale body");
  const alice = new Y.Doc();
  const bob = new Y.Doc();
  Y.applyUpdate(alice, Y.encodeStateAsUpdate(origin));
  Y.applyUpdate(bob, Y.encodeStateAsUpdate(origin));

  reconcileWithBody(alice, "fresh body", digest);
  reconcileWithBody(bob, "fresh body", digest);
  Y.applyUpdate(alice, Y.encodeStateAsUpdate(bob));
  Y.applyUpdate(bob, Y.encodeStateAsUpdate(alice));

  assert.equal(text(alice), "fresh body", "the rebuild is not applied twice");
  assert.equal(text(bob), "fresh body");
});

test("markSaved: remembers each digest once and only the newest ones", () => {
  const doc = new Y.Doc();
  markSaved(doc, "d0");
  markSaved(doc, "d0");
  assert.deepEqual(savedDigests(doc), ["d0"]);
  for (let i = 1; i <= SAVED_BODIES_KEPT + 3; i += 1) markSaved(doc, `d${i}`);
  const kept = savedDigests(doc);
  assert.equal(kept.length, SAVED_BODIES_KEPT);
  assert.equal(kept[kept.length - 1], `d${SAVED_BODIES_KEPT + 3}`);
  assert.ok(!kept.includes("d0"), "the oldest fell off");
});

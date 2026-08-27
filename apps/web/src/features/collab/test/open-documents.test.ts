/**
 * The registry's whole job is that two panes on one note get one document. The
 * counting is boring; getting it wrong is not, so each rule has a test.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as Y from "yjs";

import { createDocumentRegistry, documentKey } from "../application/open-documents";

const NOTE = { kind: "vault_page", id: "n1" };
const OTHER = { kind: "vault_page", id: "n2" };

function docFactory(destroyed: string[]) {
  return () => {
    const doc = new Y.Doc();
    return { value: doc, destroy: () => { destroyed.push("destroyed"); } };
  };
}

test("a second acquire returns the first instance, and never builds a second", () => {
  const registry = createDocumentRegistry<Y.Doc>();
  let built = 0;
  const create = () => {
    built += 1;
    return { value: new Y.Doc(), destroy: () => {} };
  };

  const first = registry.acquire(NOTE, create);
  const second = registry.acquire(NOTE, create);

  assert.equal(second, first);
  assert.equal(built, 1);
  assert.equal(registry.holders(NOTE), 2);
});

test("a different id is a different document", () => {
  const registry = createDocumentRegistry<Y.Doc>();
  const create = () => ({ value: new Y.Doc(), destroy: () => {} });

  assert.notEqual(registry.acquire(OTHER, create), registry.acquire(NOTE, create));
  assert.equal(documentKey(NOTE), "vault_page:n1");
});

test("only the last release tears the document down", () => {
  const destroyed: string[] = [];
  const registry = createDocumentRegistry<Y.Doc>();
  registry.acquire(NOTE, docFactory(destroyed));
  registry.acquire(NOTE, docFactory(destroyed));

  registry.release(NOTE);
  assert.deepEqual(destroyed, []);
  assert.equal(registry.peek(NOTE) !== undefined, true);

  registry.release(NOTE);
  assert.deepEqual(destroyed, ["destroyed"]);
  assert.equal(registry.peek(NOTE), undefined);
  assert.equal(registry.holders(NOTE), 0);
});

test("releasing more often than acquiring destroys once and stays quiet", () => {
  const destroyed: string[] = [];
  const registry = createDocumentRegistry<Y.Doc>();
  registry.acquire(NOTE, docFactory(destroyed));

  registry.release(NOTE);
  registry.release(NOTE);

  assert.deepEqual(destroyed, ["destroyed"]);
});

test("an edit typed in one pane is the text the other pane holds", () => {
  const registry = createDocumentRegistry<Y.Doc>();
  const create = () => ({ value: new Y.Doc(), destroy: () => {} });

  const left = registry.acquire(NOTE, create);
  const right = registry.acquire(NOTE, create);
  left.getText("body").insert(0, "typed in the left pane");

  assert.equal(right.getText("body").toString(), "typed in the left pane");
});

test("the save baseline is shared, so one pane's save silences the other's", () => {
  const registry = createDocumentRegistry<Y.Doc>();
  const create = () => ({ value: new Y.Doc(), destroy: () => {} });
  registry.acquire(NOTE, create);
  registry.acquire(NOTE, create);

  // Nothing saves before the document has loaded — the empty-body overwrite.
  assert.equal(registry.shouldSave(NOTE, "stored body"), false);

  registry.markReady(NOTE, "stored body");
  assert.equal(registry.shouldSave(NOTE, "stored body"), false);
  assert.equal(registry.shouldSave(NOTE, "edited body"), true);

  registry.markSaved(NOTE, "edited body");
  assert.equal(registry.shouldSave(NOTE, "edited body"), false);
});

test("a document nobody holds cannot be saved", () => {
  const registry = createDocumentRegistry<Y.Doc>();

  assert.equal(registry.shouldSave(NOTE, "anything"), false);
  registry.markReady(NOTE, "anything");
  assert.equal(registry.shouldSave(NOTE, "other"), false);
});

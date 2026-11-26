import assert from "node:assert/strict";
import { test } from "node:test";

import type { EditorHandle } from "@/components/editor-handle";

import { handBackOpenLinkers, handBackRenamedBody } from "../application/rename-hand-back";

/** A dirty editor: `text` is what the user sees, unsaved typing included. */
function fakeEditor(text: string): { handle: EditorHandle; replaced: string[] } {
  const replaced: string[] = [];
  const handle = {
    text: () => text,
    replaceAll: (markdown: string) => void replaced.push(markdown),
  } as unknown as EditorHandle;
  return { handle, replaced };
}

const rewrite = (text: string) => text.replaceAll("[[Old]]", "[[Renamed]]");

test("F97-P2-4: an open renamed note is rewritten from its editor text, so unsaved typing survives", async () => {
  const { handle, replaced } = fakeEditor("typed but not saved [[Old]] tail");
  const stored: string[] = [];
  await handBackRenamedBody(
    { linkRewrittenBody: "stale stored body [[Old]]" },
    handle,
    async (body) => void stored.push(body),
    rewrite,
  );
  assert.deepEqual(replaced, ["typed but not saved [[Renamed]] tail"]);
  assert.deepEqual(stored, []);
});

test("F97-P2-4: an open editor with no old self-link left in its text is not touched", async () => {
  const { handle, replaced } = fakeEditor("nothing to rewrite here");
  await handBackRenamedBody({ linkRewrittenBody: "x" }, handle, async () => undefined, rewrite);
  assert.deepEqual(replaced, []);
});

test("F97-P2-4: a renamed note that is not open is saved with its rewritten body", async () => {
  const stored: string[] = [];
  await handBackRenamedBody({ linkRewrittenBody: "Self: [[Renamed]]" }, null, async (body) => void stored.push(body), rewrite);
  assert.deepEqual(stored, ["Self: [[Renamed]]"]);
});

test("F97-P2-4: nothing is handed back when no body was rewritten", async () => {
  const { handle, replaced } = fakeEditor("[[Old]]");
  const stored: string[] = [];
  await handBackRenamedBody({}, handle, async (body) => void stored.push(body), rewrite);
  await handBackRenamedBody({}, null, async (body) => void stored.push(body), rewrite);
  assert.deepEqual(replaced, []);
  assert.deepEqual(stored, []);
});

test("another note open in an editor has its [[Old]] links rewritten there and is no longer reported", () => {
  const { handle, replaced } = fakeEditor("typed [[Old]] here");
  const left = handBackOpenLinkers(
    { linkRewriteFailed: ["Open", "Broken"], linkRewriteOpen: [{ id: "open", title: "Open" }] },
    (id) => (id === "open" ? handle : null),
    rewrite,
  );
  assert.deepEqual(replaced, ["typed [[Renamed]] here"]);
  assert.deepEqual(left.linkRewriteFailed, ["Broken"]);
});

test("an open linking note with no editor here (open elsewhere) stays reported", () => {
  const left = handBackOpenLinkers(
    { linkRewriteFailed: ["Open"], linkRewriteOpen: [{ id: "open", title: "Open" }] },
    () => null,
    rewrite,
  );
  assert.deepEqual(left.linkRewriteFailed, ["Open"]);
});

test("an open note whose editor text no longer holds the old link is left as typed", () => {
  const { handle, replaced } = fakeEditor("link removed meanwhile");
  const left = handBackOpenLinkers(
    { linkRewriteFailed: ["Open"], linkRewriteOpen: [{ id: "open", title: "Open" }] },
    () => handle,
    rewrite,
  );
  assert.deepEqual(replaced, []);
  assert.deepEqual(left.linkRewriteFailed, []);
});

test("two open notes sharing a title are cleared one report each", () => {
  const a = fakeEditor("[[Old]]");
  const left = handBackOpenLinkers(
    {
      linkRewriteFailed: ["Same", "Same"],
      linkRewriteOpen: [
        { id: "a", title: "Same" },
        { id: "b", title: "Same" },
      ],
    },
    (id) => (id === "a" ? a.handle : null),
    rewrite,
  );
  assert.deepEqual(left.linkRewriteFailed, ["Same"]);
});

test("a rename with no open linking notes is returned as it was", () => {
  const renamed = { linkRewriteFailed: ["Broken"] };
  assert.equal(handBackOpenLinkers(renamed, () => null, rewrite), renamed);
});

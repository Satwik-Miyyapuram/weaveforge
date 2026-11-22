import assert from "node:assert/strict";
import { test } from "node:test";

import type { EditorHandle } from "@/components/editor-handle";

import { handBackRenamedBody } from "../ui/rename-hand-back";

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

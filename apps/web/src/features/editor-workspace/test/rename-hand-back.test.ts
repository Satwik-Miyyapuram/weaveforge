import assert from "node:assert/strict";
import { test } from "node:test";

import type { EditorHandle } from "@/components/editor-handle";

import { handBackRenamedBody } from "../ui/rename-hand-back";

function fakeEditor(): { handle: EditorHandle; replaced: string[] } {
  const replaced: string[] = [];
  const handle = { replaceAll: (markdown: string) => void replaced.push(markdown) } as unknown as EditorHandle;
  return { handle, replaced };
}

test("F97-P2-4: an open renamed note gets its rewritten self-link through its editor, not the store", async () => {
  const { handle, replaced } = fakeEditor();
  const stored: string[] = [];
  await handBackRenamedBody({ linkRewrittenBody: "Self: [[Renamed]]" }, handle, async (body) => void stored.push(body));
  assert.deepEqual(replaced, ["Self: [[Renamed]]"]);
  assert.deepEqual(stored, []);
});

test("F97-P2-4: a renamed note that is not open is saved with its rewritten body", async () => {
  const stored: string[] = [];
  await handBackRenamedBody({ linkRewrittenBody: "Self: [[Renamed]]" }, null, async (body) => void stored.push(body));
  assert.deepEqual(stored, ["Self: [[Renamed]]"]);
});

test("F97-P2-4: nothing is handed back when no body was rewritten", async () => {
  const { handle, replaced } = fakeEditor();
  const stored: string[] = [];
  await handBackRenamedBody({}, handle, async (body) => void stored.push(body));
  await handBackRenamedBody({}, null, async (body) => void stored.push(body));
  assert.deepEqual(replaced, []);
  assert.deepEqual(stored, []);
});

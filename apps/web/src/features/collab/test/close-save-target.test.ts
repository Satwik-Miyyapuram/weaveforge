/**
 * The close-save of a document goes to that document (P2-148). Switching the
 * editor to another resource re-rendered with the new `onSave` before the old
 * effect's cleanup ran, and the close-save read the ref when it ran, so the
 * old document's text was written into the new one.
 */
import { before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { loadTestCore } from "@/lib/test/load-test-core";
import { BodySaver } from "../application/parts";

before(async () => {
  await loadTestCore();
});

const editor = readFileSync(
  fileURLToPath(new URL("../ui/collaborative-markdown-editor.tsx", import.meta.url)),
  "utf8",
);

test("the onSave ref is not moved during render, only after the old effect's cleanup", () => {
  assert.equal(editor.split("onSaveRef.current = onSave;").length, 2, "moved in one place only");
  assert.match(editor, /useEffect\(\(\) => \{\s*onSaveRef\.current = onSave;\s*\}\);/);
});

test("the save target is taken when the save is queued, not when it runs", () => {
  assert.match(editor, /prepare: \(body\) => \{[\s\S]*?const target = onSaveRef\.current;/);
  assert.match(editor, /await sent\.target\(body,/);
});

test("a close-save queued for A still writes to A after the target moves to B", async () => {
  const writes: string[] = [];
  const target = { current: async (body: string) => { writes.push(`A:${body}`); } };
  let release!: () => void;
  const blocker = new Promise<void>((resolve) => { release = resolve; });
  const saver = new BodySaver<{ target: (body: string) => Promise<void> }>(
    {
      prepare: () => ({ target: target.current }),
      save: async (body, sent) => {
        await blocker;
        await sent.target(body);
      },
      onError: (err) => { throw err; },
      delayMs: 10_000,
    },
    "saved",
  );
  saver.seeded("saved");
  saver.schedule("edited");
  saver.close("edited");
  target.current = async (body: string) => { writes.push(`B:${body}`); };
  release();
  await saver.flush();
  assert.deepEqual(writes, ["A:edited"]);
});

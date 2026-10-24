import { test } from "node:test";
import assert from "node:assert/strict";

import { createNoteFromLink } from "../application/create-note-from-link";

function deps(titles: string[] = [], add?: (title: string) => Promise<{ id: string }>) {
  const calls = { added: [] as string[], opened: [] as string[], reloads: 0 };
  return {
    calls,
    deps: {
      existing: titles.map((title, i) => ({ id: `p${i}`, title })),
      add: add ?? (async (title: string) => { calls.added.push(title); return { id: "new" }; }),
      reload: async () => { calls.reloads += 1; },
      open: (id: string) => { calls.opened.push(id); },
    },
  };
}

test("creates and opens a new note by default (12-17)", async () => {
  const { calls, deps: d } = deps();
  assert.equal(await createNoteFromLink("Idea", undefined, d), "new");
  assert.deepEqual(calls, { added: ["Idea"], opened: ["new"], reloads: 1 });
});

test("open:false creates without navigating away (12-17)", async () => {
  const { calls, deps: d } = deps();
  await createNoteFromLink("Idea", { open: false }, d);
  assert.deepEqual(calls, { added: ["Idea"], opened: [], reloads: 1 });
});

test("an existing title, any case or spacing, is reused not duplicated (12-17)", async () => {
  const { calls, deps: d } = deps(["Deep  Learning"]);
  assert.equal(await createNoteFromLink("  deep learning ", { open: false }, d), "p0");
  assert.deepEqual(calls, { added: [], opened: [], reloads: 0 });
  assert.equal(await createNoteFromLink("DEEP LEARNING", undefined, d), "p0");
  assert.deepEqual(calls.opened, ["p0"]);
});

test("a blank title does nothing (12-17)", async () => {
  const { calls, deps: d } = deps();
  assert.equal(await createNoteFromLink("   ", undefined, d), null);
  assert.deepEqual(calls, { added: [], opened: [], reloads: 0 });
});

test("a failed add rejects and opens nothing (12-17)", async () => {
  const { calls, deps: d } = deps([], async () => { throw new Error("offline"); });
  await assert.rejects(createNoteFromLink("Idea", undefined, d), /offline/);
  assert.deepEqual(calls.opened, []);
  assert.equal(calls.reloads, 0);
});

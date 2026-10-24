/**
 * `walkByList` is the recursive file walk the desktop, browser and Electron
 * folder adapters each wrote on top of `list` (xhelp-05).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { walkByList, type WorkspaceStat } from "../../src/index.js";

const file = (path: string): WorkspaceStat => ({ path, size: 1, modifiedAt: "t", kind: "file" });
const dir = (path: string): WorkspaceStat => ({ path, size: 0, modifiedAt: "t", kind: "dir" });

function fsOf(tree: Record<string, WorkspaceStat[]>) {
  const listed: string[] = [];
  return {
    listed,
    async list(at: string) {
      listed.push(at);
      return tree[at] ?? [];
    },
  };
}

async function collect(it: AsyncIterable<WorkspaceStat>) {
  const out: string[] = [];
  for await (const s of it) out.push(s.path);
  return out;
}

test("yields files depth-first in list order, never directories", async () => {
  const fs = fsOf({
    "": [file("a.md"), dir("d"), file("z.md")],
    d: [dir("d/e"), file("d/b.md")],
    "d/e": [file("d/e/c.md")],
  });
  assert.deepEqual(await collect(walkByList(fs, "")), ["a.md", "d/e/c.md", "d/b.md", "z.md"]);
  assert.deepEqual(fs.listed, ["", "d", "d/e"]);
});

test("an empty root or empty sub-directories yield nothing", async () => {
  assert.deepEqual(await collect(walkByList(fsOf({}), "")), []);
  assert.deepEqual(await collect(walkByList(fsOf({ "": [dir("x")], x: [dir("x/y")] }), "")), []);
});

test("walks from a sub-directory", async () => {
  const fs = fsOf({ "": [file("top.md"), dir("d")], d: [file("d/in.md")] });
  assert.deepEqual(await collect(walkByList(fs, "d")), ["d/in.md"]);
  assert.deepEqual(fs.listed, ["d"]);
});

test("a failing list rejects the walk", async () => {
  const fs = { list: async () => { throw new Error("denied"); } };
  await assert.rejects(collect(walkByList(fs, "")), /denied/);
});

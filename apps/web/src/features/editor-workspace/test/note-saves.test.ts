/**
 * A note's saves from the workspace. Each names the body the store held when
 * it was sent (its base), so the store can tell an edit made elsewhere from
 * this one. Two saves of one note in flight at once both named the body from
 * before either, so the second looked like it overwrote someone else's edit.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { NoteSaves } from "../application/parts";

const tick = () => new Promise((r) => setTimeout(r, 5));

function store() {
  const sent: { id: string; body: string; base: string | undefined }[] = [];
  const releases: (() => void)[] = [];
  const write = (id: string, body: string, merged?: string) => async (base: string | undefined) => {
    sent.push({ id, body, base });
    await new Promise<void>((r) => releases.push(r));
    return merged ?? body;
  };
  return { sent, releases, write };
}

test("a note's second save waits for the first and names the body it stored", async () => {
  const bases = new Map([["n1", "v0"]]);
  const saves = new NoteSaves(bases);
  const s = store();
  const first = saves.run("n1", undefined, s.write("n1", "v1"));
  const second = saves.run("n1", undefined, s.write("n1", "v2"));
  await tick();
  assert.deepEqual(s.sent, [{ id: "n1", body: "v1", base: "v0" }], "one save of a note at a time");
  s.releases.shift()?.();
  assert.equal(await first, "v1");
  await tick();
  assert.deepEqual(s.sent[1], { id: "n1", body: "v2", base: "v1" });
  s.releases.shift()?.();
  assert.equal(await second, "v2");
  assert.equal(bases.get("n1"), "v2");
});

test("saves of different notes do not wait for each other", async () => {
  const saves = new NoteSaves(new Map());
  const s = store();
  void saves.run("n1", "a", s.write("n1", "a1"));
  void saves.run("n2", "b", s.write("n2", "b1"));
  await tick();
  assert.equal(s.sent.length, 2);
  for (const r of s.releases.splice(0)) r();
});

test("a body the store merged becomes the next save's base", async () => {
  const bases = new Map([["n1", "v0"]]);
  const saves = new NoteSaves(bases);
  const s = store();
  const first = saves.run("n1", undefined, s.write("n1", "mine", "mine+theirs"));
  await tick();
  s.releases.shift()?.();
  assert.equal(await first, "mine+theirs");
  void saves.run("n1", undefined, s.write("n1", "mine+theirs+more"));
  await tick();
  assert.equal(s.sent[1]?.base, "mine+theirs");
  for (const r of s.releases.splice(0)) r();
});

test("with no known base, the body the workspace loaded is the base", async () => {
  const saves = new NoteSaves(new Map());
  const s = store();
  void saves.run("n1", "loaded", s.write("n1", "edited"));
  await tick();
  assert.equal(s.sent[0]?.base, "loaded");
  for (const r of s.releases.splice(0)) r();
});

test("a failed save does not block the next, and leaves the base as it was", async () => {
  const bases = new Map([["n1", "v0"]]);
  const saves = new NoteSaves(bases);
  const failed = saves.run("n1", undefined, async () => {
    throw new Error("offline");
  });
  await assert.rejects(failed, /offline/);
  assert.equal(bases.get("n1"), "v0");
  let base: string | undefined;
  await saves.run("n1", undefined, async (b) => {
    base = b;
    return "v1";
  });
  assert.equal(base, "v0");
});

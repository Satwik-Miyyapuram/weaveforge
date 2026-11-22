import { test } from "node:test";
import assert from "node:assert/strict";

import { CanvasSaver } from "../application/canvas-save";
import { fakeTimers, tick } from "./canvas-save-timers";

/**
 * A store that guards writes like the vault: a write names the body it was
 * built on; if the store moved on since, the two are merged line by line, and
 * a clash keeps theirs as a conflict copy and writes ours.
 */
function guardedStore(initial: string) {
  const store = { body: initial, copies: [] as string[], calls: [] as Array<{ text: string; base: string | undefined }> };
  const merge = (base: string, mine: string, theirs: string): string | null => {
    const [b, m, t] = [base.split("\n"), mine.split("\n"), theirs.split("\n")];
    if (b.length !== m.length || b.length !== t.length) return null;
    const out: string[] = [];
    for (let i = 0; i < b.length; i++) {
      if (m[i] === b[i] || m[i] === t[i]) out.push(t[i]!);
      else if (t[i] === b[i]) out.push(m[i]!);
      else return null;
    }
    return out.join("\n");
  };
  const update = (text: string, base: string | undefined): string => {
    store.calls.push({ text, base });
    if (base === undefined || store.body === base || store.body === text) store.body = text;
    else {
      const merged = merge(base, text, store.body);
      if (merged === null) {
        store.copies.push(store.body);
        store.body = text;
      } else store.body = merged;
    }
    return store.body;
  };
  return { store, update };
}

function storeSetup(initial: string, write?: (text: string, base: string | undefined) => unknown) {
  const timers = fakeTimers();
  const { store, update } = guardedStore(initial);
  const shown: string[] = [];
  let text = initial;
  const saver = new CanvasSaver({
    loaded: initial,
    write: (t, base) => (write ?? update)(t, base),
    onError: () => undefined,
    onStored: (body) => {
      shown.push(body);
      text = body;
    },
    schedule: timers.schedule,
    unschedule: timers.unschedule,
  });
  const read = () => text;
  saver.touch(read);
  return { saver, timers, store, update, shown, read, edit: (next: string) => (text = next) };
}

test("their body arriving while my change waits leaves my change queued and on screen", () => {
  const s = storeSetup("a\nb");
  s.edit("A\nb");
  s.saver.touch(s.read);
  s.store.body = "a\nB";
  assert.equal(s.saver.receive("a\nB"), false, "theirs is not loaded over my unsaved change");
  assert.equal(s.saver.hasPending(), true, "my change is not dropped");
  s.timers.fire();
  assert.deepEqual(s.store.calls, [{ text: "A\nb", base: "a\nb" }], "my write names the body it was built on");
  assert.equal(s.store.body, "A\nB", "the store merged both changes");
  assert.deepEqual(s.shown, ["A\nB"], "the merged body is shown");
});

test("a clash with their body keeps theirs as a conflict copy; nothing is overwritten or dropped", () => {
  const s = storeSetup("a");
  s.edit("mine");
  s.saver.touch(s.read);
  s.store.body = "theirs";
  assert.equal(s.saver.receive("theirs"), false);
  s.timers.fire();
  assert.equal(s.store.body, "mine");
  assert.deepEqual(s.store.copies, ["theirs"]);
  assert.deepEqual(s.shown, [], "the store kept what we sent; nothing new to show");
});

test("their body arriving while my write is in flight is merged by the store", async () => {
  let release!: () => void;
  const s = storeSetup("a\nb", (text, base) =>
    new Promise<string>((resolve) => {
      release = () => resolve(s.update(text, base));
    }),
  );
  s.edit("A\nb");
  s.saver.flush(s.read);
  s.store.body = "a\nB";
  assert.equal(s.saver.receive("a\nB"), false);
  release();
  await tick();
  assert.equal(s.store.body, "A\nB");
  assert.deepEqual(s.shown, ["A\nB"]);
  assert.equal(s.saver.receive("A\nB"), false, "the merged body echoing back is ours");
});

test("with no change waiting, their body is shown and becomes the base of my next write", () => {
  const s = storeSetup("a");
  s.store.body = "theirs";
  assert.equal(s.saver.receive("theirs"), true);
  s.edit("theirs");
  s.saver.touch(s.read);
  s.edit("theirs+mine");
  s.saver.touch(s.read);
  s.timers.fire();
  assert.deepEqual(s.store.calls, [{ text: "theirs+mine", base: "theirs" }]);
  assert.deepEqual(s.store.copies, []);
});

test("a second change waits for the first write and names the body it stored", async () => {
  const releases: Array<() => void> = [];
  const s = storeSetup("a", (text, base) =>
    new Promise<string>((resolve) => releases.push(() => resolve(s.update(text, base)))),
  );
  s.edit("b");
  s.saver.flush(s.read);
  s.edit("c");
  s.saver.flush(s.read);
  assert.equal(releases.length, 1, "c is not sent while b is in flight");
  releases[0]!();
  await tick();
  releases[1]!();
  await tick();
  assert.deepEqual(s.store.calls, [
    { text: "b", base: "a" },
    { text: "c", base: "b" },
  ]);
  assert.deepEqual(s.store.copies, [], "my own writes never conflict with each other");
});

test("a failed write does not move the base: its retry still names the body it was built on", async () => {
  let fail = true;
  const s = storeSetup("a", (text, base) => (fail ? Promise.reject(new Error("offline")) : s.update(text, base)));
  s.edit("b");
  s.saver.flush(s.read);
  await tick();
  fail = false;
  s.timers.fire();
  await tick();
  assert.deepEqual(s.store.calls, [{ text: "b", base: "a" }]);
});

test("a change queued behind an in-flight write at dispose still gets its one attempt", async () => {
  const releases: Array<() => void> = [];
  const s = storeSetup("a", (text, base) =>
    new Promise<string>((resolve) => releases.push(() => resolve(s.update(text, base)))),
  );
  s.edit("b");
  s.saver.flush(s.read);
  s.edit("c");
  s.saver.flush(s.read);
  s.saver.dispose();
  releases[0]!();
  await tick();
  assert.equal(releases.length, 2, "the final change goes out after the write before it");
  releases[1]!();
  await tick();
  assert.equal(s.store.body, "c");
  assert.deepEqual(s.shown, [], "nothing is shown in an unmounted editor");
});

test("a merge landing while my next change still waits is not shown over it; that change merges too", async () => {
  let release!: () => void;
  let hold = true;
  const s = storeSetup("a\nb\nc", (text, base) =>
    hold ? new Promise<string>((resolve) => (release = () => resolve(s.update(text, base)))) : s.update(text, base),
  );
  s.edit("A\nb\nc");
  s.saver.flush(s.read);
  s.store.body = "a\nB\nc";
  s.edit("A\nb\nC");
  s.saver.touch(s.read);
  hold = false;
  release();
  await tick();
  assert.deepEqual(s.shown, [], "my waiting change stays on screen");
  s.timers.fire();
  assert.equal(s.store.body, "A\nB\nC", "both of mine and theirs survive");
  assert.deepEqual(s.store.copies, []);
});

test("their body applied after my in-flight write is shown when my write lands", async () => {
  let release!: () => void;
  const s = storeSetup("a", (text, base) =>
    new Promise<string>((resolve) => (release = () => resolve(s.update(text, base)))),
  );
  s.edit("mine");
  s.saver.flush(s.read);
  assert.equal(s.saver.receive("theirs"), false, "not shown over my write in flight");
  release();
  s.store.body = "theirs";
  await tick();
  assert.deepEqual(s.shown, ["theirs"], "the store's newest body is on screen");
  s.saver.touch(s.read);
  s.edit("theirs+mine");
  s.saver.touch(s.read);
  s.timers.fire();
  release();
  await tick();
  assert.deepEqual(s.store.calls.at(-1), { text: "theirs+mine", base: "theirs" });
  assert.deepEqual(s.store.copies, [], "the next change is built on theirs, so no conflict");
});

test("their body already merged into what the store kept is shown once, as the merge", async () => {
  let release!: () => void;
  const s = storeSetup("a\nb", (text, base) =>
    new Promise<string>((resolve) => (release = () => resolve(s.update(text, base)))),
  );
  s.edit("A\nb");
  s.saver.flush(s.read);
  s.store.body = "a\nB";
  s.saver.receive("a\nB");
  release();
  await tick();
  assert.deepEqual(s.shown, ["A\nB"]);
});

test("a body that arrived before my write was sent never overwrites the store's answer", async () => {
  const s = storeSetup("a\nb");
  s.edit("A\nb");
  s.saver.touch(s.read);
  s.store.body = "a\nB";
  s.saver.receive("a\nB");
  s.timers.fire();
  assert.deepEqual(s.shown, ["A\nB"], "the merge, not the older body that went into it");
});

test("a body that arrived while my write failed is answered by the retry, not shown over it", async () => {
  let fail = true;
  const s = storeSetup("a", (text, base) => (fail ? Promise.reject(new Error("offline")) : s.update(text, base)));
  s.edit("mine");
  s.saver.flush(s.read);
  await tick();
  s.store.body = "theirs";
  assert.equal(s.saver.receive("theirs"), false);
  fail = false;
  s.timers.fire();
  await tick();
  assert.equal(s.store.body, "mine");
  assert.deepEqual(s.store.copies, ["theirs"], "theirs is kept as a conflict copy");
  assert.deepEqual(s.shown, [], "the canvas keeps showing what the store holds");
});

test("their body followed by my write's echo while in flight was stored before mine and is not shown", async () => {
  let release!: () => void;
  const s = storeSetup("a", (text, base) =>
    new Promise<string>((resolve) => (release = () => resolve(s.update(text, base)))),
  );
  s.edit("mine");
  s.saver.flush(s.read);
  s.store.body = "theirs";
  s.saver.receive("theirs");
  release();
  s.saver.receive("mine");
  await tick();
  assert.equal(s.store.body, "mine");
  assert.deepEqual(s.store.copies, ["theirs"]);
  assert.deepEqual(s.shown, [], "the canvas already shows what the store holds");
});

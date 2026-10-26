/**
 * The toast store behind delete-then-undo (design D10, rule D-07). A delete
 * hides the item at once and commits only when its toast closes, so Undo needs
 * no re-create and sync sees one delete.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { TOAST_MS, MAX_TOASTS, ToastStore, type ToastClock } from "../toast-store";

/** A clock the test drives by hand. */
function fakeClock() {
  let now = 0;
  let next = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const clock: ToastClock = {
    now: () => now,
    setTimeout: (fn, ms) => {
      const id = next++;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeout: (id) => void timers.delete(id as number),
  };
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      now = due[1].at;
      due[1].fn();
    }
    now = end;
  };
  return { clock, advance };
}

function setup() {
  const { clock, advance } = fakeClock();
  return { store: new ToastStore(clock), advance };
}

test("a toast stays 8 seconds, then closes", () => {
  const { store, advance } = setup();
  assert.equal(TOAST_MS, 8000);
  store.show({ message: "Copied" });
  advance(7999);
  assert.equal(store.snapshot().length, 1);
  advance(1);
  assert.equal(store.snapshot().length, 0);
});

test("a deferred delete hides its key at once and commits only when the toast closes", () => {
  const { store, advance } = setup();
  let commits = 0;
  store.deferDelete({ keys: ["paper:1"], message: "Paper deleted", commit: () => void commits++ });
  assert.ok(store.hiddenKeys().has("paper:1"));
  assert.equal(commits, 0);
  advance(TOAST_MS);
  assert.equal(commits, 1);
  assert.equal(store.hiddenKeys().has("paper:1"), false);
});

test("Undo restores the item, never commits, and closes the toast", () => {
  const { store, advance } = setup();
  let commits = 0;
  let restored = 0;
  const id = store.deferDelete({
    keys: ["note:a"],
    message: "Note deleted",
    commit: () => void commits++,
    restore: () => void restored++,
  });
  assert.equal(store.snapshot()[0]?.actionLabel, "Undo");
  store.act(id);
  advance(TOAST_MS * 2);
  assert.equal(commits, 0);
  assert.equal(restored, 1);
  assert.equal(store.hiddenKeys().size, 0);
  assert.equal(store.snapshot().length, 0);
});

test("dismissing a delete toast commits it now", () => {
  const { store } = setup();
  let commits = 0;
  const id = store.deferDelete({ keys: ["k"], message: "x", commit: () => void commits++ });
  store.dismiss(id);
  assert.equal(commits, 1);
  store.dismiss(id);
  assert.equal(commits, 1, "a second close does not commit twice");
});

test("hover and focus pause the timer; leaving resumes with the time that was left", () => {
  const { store, advance } = setup();
  const id = store.show({ message: "m" });
  advance(5000);
  store.pause(id, "hover");
  advance(60_000);
  assert.equal(store.snapshot().length, 1);
  store.pause(id, "focus");
  store.resume(id, "hover");
  advance(60_000);
  assert.equal(store.snapshot().length, 1, "still focused");
  store.resume(id, "focus");
  advance(2999);
  assert.equal(store.snapshot().length, 1);
  advance(1);
  assert.equal(store.snapshot().length, 0);
});

test("a hidden window pauses every toast", () => {
  const { store, advance } = setup();
  store.show({ message: "a" });
  store.show({ message: "b" });
  store.setWindowHidden(true);
  advance(60_000);
  assert.equal(store.snapshot().length, 2);
  store.setWindowHidden(false);
  advance(TOAST_MS);
  assert.equal(store.snapshot().length, 0);
});

test("undoLatest undoes the newest undoable toast and reports whether it did", () => {
  const { store } = setup();
  const undone: string[] = [];
  store.deferDelete({ keys: ["1"], message: "one", commit: () => {}, restore: () => void undone.push("one") });
  store.deferDelete({ keys: ["2"], message: "two", commit: () => {}, restore: () => void undone.push("two") });
  store.show({ message: "Copied" });
  assert.equal(store.undoLatest(), true);
  assert.deepEqual(undone, ["two"]);
  assert.equal(store.undoLatest(), true);
  assert.equal(store.undoLatest(), false, "a plain toast is not undoable");
});

test("at most three toasts show; a fourth closes the oldest, which commits early", () => {
  const { store } = setup();
  const commits: string[] = [];
  for (const k of ["a", "b", "c", "d"]) {
    store.deferDelete({ keys: [k], message: k, commit: () => void commits.push(k) });
  }
  assert.equal(MAX_TOASTS, 3);
  assert.deepEqual(store.snapshot().map((t) => t.message), ["b", "c", "d"]);
  assert.deepEqual(commits, ["a"]);
});

test("a bulk delete is one toast that hides every key and commits once", () => {
  const { store } = setup();
  let commits = 0;
  const id = store.deferDelete({ keys: ["p1", "p2", "p3"], message: "3 papers deleted", commit: () => void commits++ });
  assert.equal(store.snapshot().length, 1);
  assert.deepEqual([...store.hiddenKeys()].sort(), ["p1", "p2", "p3"]);
  store.dismiss(id);
  assert.equal(commits, 1);
});

test("flush commits every pending delete (app quit)", () => {
  const { store } = setup();
  const commits: string[] = [];
  store.deferDelete({ keys: ["a"], message: "a", commit: () => void commits.push("a") });
  store.deferDelete({ keys: ["b"], message: "b", commit: () => void commits.push("b") });
  store.flush();
  assert.deepEqual(commits, ["a", "b"]);
  assert.equal(store.snapshot().length, 0);
});

test("a commit that throws still closes the toast and shows what failed", () => {
  const { store } = setup();
  const id = store.deferDelete({
    keys: ["a"],
    message: "a",
    commit: () => {
      throw new Error("offline");
    },
  });
  store.dismiss(id);
  assert.equal(store.hiddenKeys().size, 0, "the item comes back, the safe side");
  assert.match(store.snapshot()[0]?.message ?? "", /Could not delete: offline/);
});

test("a rejected async commit brings the item back and says so", async () => {
  const { store } = setup();
  const id = store.deferDelete({ keys: ["a"], message: "a", commit: () => Promise.reject(new Error("denied")) });
  store.dismiss(id);
  await new Promise((r) => setTimeout(r, 0));
  assert.match(store.snapshot()[0]?.message ?? "", /Could not delete: denied/);
});

test("subscribers hear every change and the snapshot is stable between changes", () => {
  const { store } = setup();
  let calls = 0;
  const off = store.subscribe(() => void calls++);
  const before = store.snapshot();
  assert.equal(store.snapshot(), before);
  store.show({ message: "x" });
  assert.equal(calls, 1);
  assert.notEqual(store.snapshot(), before);
  off();
  store.show({ message: "y" });
  assert.equal(calls, 1);
});

test("a toast with its own action runs it and closes", () => {
  const { store } = setup();
  let opened = 0;
  const id = store.show({ message: "Note created", action: { label: "Open", run: () => void opened++ } });
  assert.equal(store.snapshot()[0]?.actionLabel, "Open");
  store.act(id);
  assert.equal(opened, 1);
  assert.equal(store.snapshot().length, 0);
});

test("the item stays hidden until an async commit finishes, so it never flickers back", async () => {
  const { store } = setup();
  let finish!: () => void;
  const id = store.deferDelete({ keys: ["a"], message: "a", commit: () => new Promise<void>((r) => (finish = r)) });
  store.dismiss(id);
  assert.equal(store.snapshot().length, 0);
  assert.ok(store.hiddenKeys().has("a"), "hidden while the delete runs");
  finish();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(store.hiddenKeys().has("a"), false);
});

test("a failed commit can name its own verb", async () => {
  const { store } = setup();
  const id = store.deferDelete({
    keys: ["a"],
    message: "a",
    failure: "Could not merge",
    commit: () => Promise.reject(new Error("locked")),
  });
  store.dismiss(id);
  await new Promise((r) => setTimeout(r, 0));
  assert.match(store.snapshot()[0]?.message ?? "", /^Could not merge: locked$/);
});

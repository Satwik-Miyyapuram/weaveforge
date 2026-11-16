import { test } from "node:test";
import assert from "node:assert/strict";

import { CanvasSaver } from "../application/canvas-save";

/** A timer that only fires when the test says so. */
function fakeTimers() {
  let next = 1;
  const armed = new Map<number, () => void>();
  return {
    schedule: (fn: () => void) => {
      const id = next++;
      armed.set(id, fn);
      return id;
    },
    unschedule: (handle: unknown) => {
      armed.delete(handle as number);
    },
    fire: () => {
      for (const [id, fn] of [...armed]) {
        armed.delete(id);
        fn();
      }
    },
    armedCount: () => armed.size,
  };
}

function setup(initial: string) {
  const timers = fakeTimers();
  const written: string[] = [];
  const errors: unknown[] = [];
  let text = initial;
  const saver = new CanvasSaver({
    write: (t) => void written.push(t),
    onError: (e) => void errors.push(e),
    schedule: timers.schedule,
    unschedule: timers.unschedule,
  });
  const read = () => text;
  return {
    saver,
    timers,
    written,
    errors,
    read,
    edit: (next: string) => (text = next),
  };
}

test("the first touch only records the loaded text, so opening never writes", () => {
  const s = setup("A");
  s.saver.touch(s.read);
  s.timers.fire();
  s.saver.flush(s.read);
  assert.deepEqual(s.written, []);
  assert.equal(s.timers.armedCount(), 0);
});

test("a change saves once after the debounce, not on every touch", () => {
  const s = setup("A");
  s.saver.touch(s.read);
  s.edit("B");
  s.saver.touch(s.read);
  s.edit("C");
  s.saver.touch(s.read);
  assert.equal(s.timers.armedCount(), 1, "each touch re-arms the one timer");
  assert.deepEqual(s.written, []);
  s.timers.fire();
  assert.deepEqual(s.written, ["C"]);
});

test("flush writes a pending change at once and never writes the same text twice", () => {
  const s = setup("A");
  s.saver.touch(s.read);
  s.edit("B");
  s.saver.touch(s.read);
  s.saver.flush(s.read);
  s.saver.flush(s.read);
  s.timers.fire();
  assert.deepEqual(s.written, ["B"]);
  assert.equal(s.saver.hasPending(), false);
});

test("flush with nothing pending does nothing (closing an untouched canvas)", () => {
  const s = setup("A");
  s.saver.touch(s.read);
  s.saver.flush(s.read);
  assert.deepEqual(s.written, []);
});

test("halting drops the pending save: an invalid body is never overwritten", () => {
  const s = setup("A");
  s.saver.touch(s.read);
  s.edit("B");
  s.saver.touch(s.read);
  s.saver.halt();
  s.timers.fire();
  s.saver.flush(s.read);
  s.saver.touch(s.read);
  s.timers.fire();
  assert.deepEqual(s.written, [], "neither the timer nor flush may write while halted");
  assert.equal(s.saver.hasPending(), false);
});

test("resume after a halt saves again from the next change", () => {
  const s = setup("A");
  s.saver.touch(s.read);
  s.saver.halt();
  s.saver.resume();
  s.edit("B");
  s.saver.touch(s.read);
  s.timers.fire();
  assert.deepEqual(s.written, ["B"]);
});

test("a write that fails is reported through onError", async () => {
  const timers = fakeTimers();
  const errors: unknown[] = [];
  const saver = new CanvasSaver({
    write: () => Promise.reject(new Error("disk full")),
    onError: (e) => void errors.push(e),
    schedule: timers.schedule,
    unschedule: timers.unschedule,
  });
  let text = "A";
  saver.touch(() => text);
  text = "B";
  saver.flush(() => text);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(errors.map((e) => (e as Error).message), ["disk full"]);
});

test("a read that throws is reported and nothing is written", () => {
  const s = setup("A");
  s.saver.touch(s.read);
  s.edit("B");
  s.saver.flush(() => {
    throw new Error("bad canvas");
  });
  assert.deepEqual(s.written, []);
  assert.deepEqual(s.errors.map((e) => (e as Error).message), ["bad canvas"]);
});

test("a body that was just written is recognised as our own echo", () => {
  const s = setup("A");
  s.saver.touch(s.read);
  s.edit("B");
  s.saver.touch(s.read);
  s.saver.flush(s.read);
  s.edit("C");
  s.saver.touch(s.read);
  s.saver.flush(s.read);
  assert.equal(s.saver.isOwnEcho("B"), true, "an earlier save echoing back is ours");
  assert.equal(s.saver.isOwnEcho("C"), true);
  assert.equal(s.saver.isOwnEcho("elsewhere"), false);
});

test("markLoaded replaces the baseline and drops a pending save", () => {
  const s = setup("A");
  s.saver.touch(s.read);
  s.edit("B");
  s.saver.touch(s.read);
  assert.equal(s.saver.hasPending(), true);
  s.saver.markLoaded("Z");
  assert.equal(s.saver.hasPending(), false);
  s.timers.fire();
  assert.deepEqual(s.written, []);
});

test("a failed write keeps the change pending: the next touch saves the latest text", async () => {
  const timers = fakeTimers();
  const written: string[] = [];
  const errors: unknown[] = [];
  let failing = true;
  let text = "A";
  const saver = new CanvasSaver({
    write: (t) => {
      if (failing) return Promise.reject(new Error("disk full"));
      written.push(t);
      return undefined;
    },
    onError: (e) => void errors.push(e),
    schedule: timers.schedule,
    unschedule: timers.unschedule,
  });
  const read = () => text;
  saver.touch(read);
  text = "B";
  saver.touch(read);
  timers.fire();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(errors.length, 1, "the failure is reported");

  failing = false;
  text = "C";
  saver.touch(read);
  timers.fire();
  assert.deepEqual(written, ["C"], "the next change saves everything, including the failed B");
});

test("a flush after a failed write retries the same text", async () => {
  const written: string[] = [];
  let failing = true;
  const saver = new CanvasSaver({
    write: (t) => {
      if (failing) return Promise.reject(new Error("offline"));
      written.push(t);
      return undefined;
    },
    onError: () => undefined,
    schedule: fakeTimers().schedule,
    unschedule: fakeTimers().unschedule,
  });
  let text = "A";
  const read = () => text;
  saver.touch(read);
  text = "B";
  saver.flush(read);
  await new Promise((resolve) => setImmediate(resolve));

  failing = false;
  saver.flush(read);
  assert.deepEqual(written, ["B"]);
});

test("a successful write reports saved so the editor can clear its banner", async () => {
  let saved = 0;
  const saver = new CanvasSaver({
    write: () => undefined,
    onError: () => undefined,
    onSaved: () => {
      saved += 1;
    },
    schedule: fakeTimers().schedule,
    unschedule: fakeTimers().unschedule,
  });
  let text = "A";
  const read = () => text;
  saver.touch(read);
  text = "B";
  saver.flush(read);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(saved, 1);
});

const tick = () => new Promise((resolve) => setImmediate(resolve));

test("an older write landing after a newer write failed does not clear the banner", async () => {
  const timers = fakeTimers();
  const pending: Array<{ resolve: () => void; reject: (e: Error) => void }> = [];
  const errors: unknown[] = [];
  let saved = 0;
  const saver = new CanvasSaver({
    write: () =>
      new Promise((resolve, reject) => {
        pending.push({ resolve: () => resolve(undefined), reject });
      }),
    onError: (e) => void errors.push(e),
    onSaved: () => {
      saved += 1;
    },
    schedule: timers.schedule,
    unschedule: timers.unschedule,
  });
  let text = "A";
  const read = () => text;
  saver.touch(read);
  text = "B";
  saver.flush(read);
  text = "C";
  saver.flush(read);
  // C waits for B, so it is sent against the body B leaves in the store.
  pending[0]!.resolve();
  await tick();
  pending[1]!.reject(new Error("disk full"));
  await tick();
  assert.equal(saved, 0, "B landed but C is still unsaved on screen, so the banner stays");
  assert.equal(errors.length, 1);
  assert.equal(timers.armedCount(), 1, "C's failure schedules a retry");
});

test("a failed write is retried by a timer without any further edit", async () => {
  const timers = fakeTimers();
  const written: string[] = [];
  let attempts = 0;
  const saver = new CanvasSaver({
    write: (t) => {
      attempts += 1;
      if (attempts === 1) return Promise.reject(new Error("offline"));
      written.push(t);
      return undefined;
    },
    onError: () => undefined,
    schedule: timers.schedule,
    unschedule: timers.unschedule,
  });
  let text = "A";
  const read = () => text;
  saver.touch(read);
  text = "B";
  saver.flush(read);
  await tick();
  assert.equal(timers.armedCount(), 1, "the failure arms a retry");
  timers.fire();
  await tick();
  assert.deepEqual(written, ["B"], "the same text is written again");
});

test("retries back off, doubling from the debounce delay", async () => {
  const delays: number[] = [];
  let retry: (() => void) | null = null;
  let attempts = 0;
  const saver = new CanvasSaver({
    write: () => {
      attempts += 1;
      return Promise.reject(new Error("offline"));
    },
    onError: () => undefined,
    schedule: (fn: () => void, ms: number) => {
      delays.push(ms);
      retry = fn;
      return 1;
    },
    unschedule: () => {
      retry = null;
    },
  });
  let text = "A";
  const read = () => text;
  saver.touch(read);
  text = "B";
  saver.flush(read);
  await tick();
  retry!();
  await tick();
  retry!();
  await tick();
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [600, 1200, 2400], "each failed attempt doubles the wait before the next retry");
});

test("a save that keeps failing is reported once, not on every retry", async () => {
  const timers = fakeTimers();
  const errors: unknown[] = [];
  const saver = new CanvasSaver({
    write: () => Promise.reject(new Error("offline")),
    onError: (e) => void errors.push(e),
    schedule: timers.schedule,
    unschedule: timers.unschedule,
  });
  let text = "A";
  const read = () => text;
  saver.touch(read);
  text = "B";
  saver.flush(read);
  await tick();
  for (let i = 0; i < 4; i++) {
    timers.fire();
    await tick();
  }
  assert.equal(errors.length, 1, "retries of the same failing text stay quiet");
  text = "C";
  saver.flush(read);
  await tick();
  assert.equal(errors.length, 1, "still failing: the banner is already up");
});

test("retries do not fill the echo memory with the same text", async () => {
  const timers = fakeTimers();
  const saver = new CanvasSaver({
    write: (t) => (t === "B" ? Promise.reject(new Error("offline")) : undefined),
    onError: () => undefined,
    loaded: "A",
    schedule: timers.schedule,
    unschedule: timers.unschedule,
  });
  let text = "A";
  const read = () => text;
  saver.touch(read);
  text = "B";
  saver.flush(read);
  await tick();
  for (let i = 0; i < 10; i++) {
    timers.fire();
    await tick();
  }
  assert.equal(saver.isOwnEcho("A"), true, "the loaded body is still remembered after many retries");
});

test("our own echo arriving is not shown and leaves a waiting change alone", () => {
  const s = setup("A");
  s.saver.touch(s.read);
  s.edit("B");
  s.saver.flush(s.read);
  s.edit("C");
  s.saver.touch(s.read);
  assert.equal(s.saver.receive("B"), false);
  s.timers.fire();
  assert.deepEqual(s.written, ["B", "C"]);
});

test("an echo is forgotten once seen, so a later revert to that body is someone else's", () => {
  const s = setup("A");
  s.saver.touch(s.read);
  s.edit("B");
  s.saver.flush(s.read);
  assert.equal(s.saver.isOwnEcho("B"), true);
  assert.equal(s.saver.isOwnEcho("B"), false, "B coming back a second time is a revert, not our save");
});

test("a body loaded from outside is not remembered as ours", () => {
  const s = setup("A");
  assert.equal(s.saver.receive("Z"), true);
  assert.equal(s.saver.receive("Y"), true);
  assert.equal(s.saver.receive("Z"), true, "a revert to Z is shown");
});

test("dispose stops a waiting save and its timer", () => {
  const s = setup("A");
  s.saver.touch(s.read);
  s.edit("B");
  s.saver.touch(s.read);
  s.saver.dispose();
  assert.equal(s.timers.armedCount(), 0);
  assert.equal(s.saver.hasPending(), false);
});

test("the final flush before dispose gets one attempt; its failure is neither retried nor reported", async () => {
  const timers = fakeTimers();
  const errors: unknown[] = [];
  let attempts = 0;
  const saver = new CanvasSaver({
    write: () => {
      attempts += 1;
      return Promise.reject(new Error("offline"));
    },
    onError: (e) => void errors.push(e),
    schedule: timers.schedule,
    unschedule: timers.unschedule,
  });
  let text = "A";
  const read = () => text;
  saver.touch(read);
  text = "B";
  saver.flush(read);
  saver.dispose();
  await tick();
  assert.equal(attempts, 1, "the final flush was sent");
  assert.equal(timers.armedCount(), 0, "no retry outlives the editor");
  assert.deepEqual(errors, [], "nothing is reported to an unmounted editor");
});

test("a retry already armed is cancelled by dispose", async () => {
  const timers = fakeTimers();
  let attempts = 0;
  const saver = new CanvasSaver({
    write: () => {
      attempts += 1;
      return Promise.reject(new Error("offline"));
    },
    onError: () => undefined,
    schedule: timers.schedule,
    unschedule: timers.unschedule,
  });
  let text = "A";
  const read = () => text;
  saver.touch(read);
  text = "B";
  saver.flush(read);
  await tick();
  assert.equal(timers.armedCount(), 1);
  saver.dispose();
  timers.fire();
  await tick();
  assert.equal(attempts, 1);
});

test("a write landing after dispose does not call onSaved", async () => {
  let saved = 0;
  const saver = new CanvasSaver({
    write: () => Promise.resolve(),
    onError: () => undefined,
    onSaved: () => void (saved += 1),
    schedule: fakeTimers().schedule,
    unschedule: fakeTimers().unschedule,
  });
  let text = "A";
  const read = () => text;
  saver.touch(read);
  text = "B";
  saver.flush(read);
  saver.dispose();
  await tick();
  assert.equal(saved, 0);
});

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

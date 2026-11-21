import { test } from "node:test";
import assert from "node:assert/strict";

import { CanvasSaver } from "../application/canvas-save";
import { fakeTimers, tick } from "./canvas-save-timers";

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

// P2-153: a write in flight when the canvas halts must not send the change
// queued behind it, or the body the halt protects is overwritten.
test("a write that lands after a halt does not send the newer pending body", async () => {
  const written: string[] = [];
  let land: () => void = () => {};
  let text = "A";
  const saver = new CanvasSaver({
    write: (t) => {
      written.push(t);
      return new Promise<void>((resolve) => (land = resolve));
    },
    onError: () => {},
    schedule: fakeTimers().schedule,
    unschedule: () => {},
  });
  const read = () => text;
  saver.touch(read);
  text = "B";
  saver.flush(read);
  text = "C";
  saver.flush(read);
  assert.deepEqual(written, ["B"], "C waits for B to land");
  saver.halt();
  land();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(written, ["B"], "nothing is sent while halted");
});

test("busy covers the debounce and a write still on its way, for the desktop close", async () => {
  let land: () => void = () => {};
  let text = "A";
  const timers = fakeTimers();
  const saver = new CanvasSaver({
    write: () => new Promise<void>((resolve) => (land = resolve)),
    onError: () => {},
    schedule: timers.schedule,
    unschedule: timers.unschedule,
  });
  const read = () => text;
  saver.touch(read);
  assert.equal(saver.busy(), false, "opening is not a write");
  text = "B";
  saver.touch(read);
  assert.equal(saver.busy(), true, "a change waits for the debounce");
  saver.flush(read);
  assert.equal(saver.hasPending(), false);
  assert.equal(saver.busy(), true, "the write has not landed yet");
  land();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(saver.busy(), false);
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

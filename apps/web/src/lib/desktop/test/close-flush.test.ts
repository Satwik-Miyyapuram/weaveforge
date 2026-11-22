/**
 * Closing or quitting the desktop app waits for the page's writes. The shell
 * runs its flush script; the page fires `pagehide` (the editors start their
 * last writes), waits while any registered probe says a write is still on its
 * way, at most CLOSE_FLUSH_CAP_MS, and then tells the shell it may close.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { CLOSE_FLUSH_CAP_MS, flushForClose, holdCloseWhile } from "../close-flush";

const shell = readFileSync(new URL("../../../../../shell/src/close_flush.rs", import.meta.url), "utf8");

/** A clock the waits advance, so no test sleeps for real. */
function fakeClock() {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
      await Promise.resolve();
    },
  };
}

test("pagehide is fired and the flush ends once no write is on its way", async () => {
  const win = new EventTarget();
  const clock = fakeClock();
  let writing = false;
  win.addEventListener("pagehide", () => {
    writing = true;
  });
  const stop = holdCloseWhile(() => writing, undefined);
  let polls = 0;
  const done = flushForClose(win, {
    ...clock,
    sleep: async (ms: number) => {
      polls += 1;
      if (polls === 3) writing = false;
      await clock.sleep(ms);
    },
  });
  await done;
  assert.equal(writing, false);
  assert.ok(polls >= 3, "it waited for the write");
  assert.ok(clock.now() < CLOSE_FLUSH_CAP_MS);
  stop();
});

test("a write that never lands holds the close only up to the cap", async () => {
  const clock = fakeClock();
  const stop = holdCloseWhile(() => true, undefined);
  await flushForClose(new EventTarget(), clock);
  assert.ok(clock.now() >= CLOSE_FLUSH_CAP_MS);
  assert.ok(clock.now() < CLOSE_FLUSH_CAP_MS + 100);
  stop();
});

test("a stopped probe is not waited for", async () => {
  const clock = fakeClock();
  const stop = holdCloseWhile(() => true, undefined);
  stop();
  await flushForClose(new EventTarget(), clock);
  assert.ok(clock.now() < 100);
});

test("a probe that throws does not hold the close", async () => {
  const clock = fakeClock();
  const stop = holdCloseWhile(() => {
    throw new Error("gone");
  }, undefined);
  await flushForClose(new EventTarget(), clock);
  assert.ok(clock.now() < 100);
  stop();
});

test("holding a close installs the page's answer to the shell's flush", () => {
  const win = new EventTarget() as EventTarget & { __wfFlushForClose?: () => Promise<void> };
  const stop = holdCloseWhile(() => false, win);
  assert.equal(typeof win.__wfFlushForClose, "function");
  stop();
});

/** The shell's flush script, run against a fake page. */
function runShellScript(page: { __wfFlushForClose?: () => Promise<void> }) {
  const script = /const FLUSH_SCRIPT: &str =\s*"([^"]*)";/.exec(shell)?.[1];
  assert.ok(script, "close_flush.rs defines FLUSH_SCRIPT");
  const events: string[] = [];
  const internals = {
    invoke: async (cmd: string, args: { event: string }) => {
      events.push(`${cmd} ${args.event}`);
    },
  };
  const dispatchEvent = (e: Event) => {
    events.push(e.type);
    return true;
  };
  const run = new Function("__wfFlushForClose", "dispatchEvent", "__TAURI_INTERNALS__", `return ${script};`);
  return { events, done: run(page.__wfFlushForClose, dispatchEvent, internals) as Promise<unknown> };
}

test("the shell's script tells the shell once the page's flush is done", async () => {
  let release: () => void = () => {};
  const page = { __wfFlushForClose: () => new Promise<void>((r) => (release = r)) };
  const { events, done } = runShellScript(page);
  await Promise.resolve();
  assert.deepEqual(events, [], "no answer while the page still writes");
  release();
  await done;
  assert.deepEqual(events, ["plugin:event|emit wf://close-flushed"]);
  assert.match(shell, /const FLUSHED: &str = "wf:\/\/close-flushed";/);
});

test("a page without the hook still gets pagehide and answers at once", async () => {
  const { events, done } = runShellScript({});
  await done;
  assert.deepEqual(events, ["pagehide", "plugin:event|emit wf://close-flushed"]);
});

test("a failing flush still answers, so the close is never stuck on it", async () => {
  const { events, done } = runShellScript({ __wfFlushForClose: () => Promise.reject(new Error("x")) });
  await done;
  assert.deepEqual(events, ["plugin:event|emit wf://close-flushed"]);
});

test("the editors register what their close waits for", () => {
  const src = (p: string) => readFileSync(new URL(`../../../features/${p}`, import.meta.url), "utf8");
  assert.match(src("ink/ui/use-ink-note-store.ts"), /holdCloseWhile\(\(\) => getInkSaveStatus\(\)\.pending > 0\)/);
  assert.match(src("collab/application/parts.ts"), /holdCloseWhile\(\(\) => saver\.busy\(\)/);
  assert.match(src("canvas/ui/canvas-editor.tsx"), /holdCloseWhile\(\(\) => saver\.busy\(\)\)/);
  assert.match(src("workspace/ui/workspace-settings-sync.tsx"), /holdCloseWhile\(\(\) => workspaceSettings\.busy\(\)\)/);
});

/**
 * The download at setup, and the mode it must not run in (explorer plan §8).
 *
 * A workspace folder is what makes the library walk happen: with one open the
 * app pre-downloads every paper into `papers/pdf/<id>.pdf`, and without one —
 * which is every browser session — it must never start, because a background
 * bulk fetch is what exhausts a browser's storage quota and somebody else's
 * bandwidth for papers nobody has opened.
 *
 * This suite runs with no folder connected, and the assertion that cannot pass
 * by accident is the implicit one: `getContainer()` throws when no container
 * has been bootstrapped, so a walk that reached it would fail here rather than
 * quietly doing nothing.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { activeWorkspaceFs } from "@/features/workspace/application/workspace-folder";
import {
  downloadLibraryPdfs,
  downloadPaperPdf,
  serialPdfQueue,
} from "../application/parts-1";

test("with no folder open the library walk is over before it reads anything", async () => {
  assert.equal(
    activeWorkspaceFs(),
    null,
    "this suite must run with no folder connected: the point is the absent one",
  );

  const progress = await downloadLibraryPdfs();
  assert.deepEqual(progress, { done: 0, total: 0, fetched: 0, skipped: 0 });
});

test("with no folder open one paper is not fetched either", async () => {
  const original = globalThis.fetch;
  let attempted = 0;
  globalThis.fetch = (async () => {
    attempted += 1;
    return new Response(null, { status: 200 });
  }) as typeof fetch;
  try {
    assert.equal(await downloadPaperPdf("paper-1"), false);
  } finally {
    globalThis.fetch = original;
  }
  assert.equal(attempted, 0, "the web build fetches on open, never in the background");
});

test("queued downloads run one at a time with a pause between starts (P2-178)", async () => {
  const pauseMs = 25;
  let inFlight = 0;
  let maxInFlight = 0;
  const starts: number[] = [];
  const enqueue = serialPdfQueue(async () => {
    starts.push(Date.now());
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight -= 1;
    return true;
  }, pauseMs);

  const done = ["p1", "p2", "p3", "p4", "p5"].map((id) => enqueue(id));
  await Promise.all(done);

  assert.equal(starts.length, 5, "every queued paper is fetched");
  assert.equal(maxInFlight, 1, "never two fetches at once");
  for (let i = 1; i < starts.length; i += 1) {
    // Timers can fire a millisecond early on Windows.
    assert.ok(starts[i]! - starts[i - 1]! >= pauseMs - 2, `gap ${i} is ${starts[i]! - starts[i - 1]!}ms`);
  }
});

test("a failed queued download does not stop the next one (P2-178)", async () => {
  const seen: string[] = [];
  const enqueue = serialPdfQueue(async (id) => {
    seen.push(id);
    if (id === "bad") throw new Error("boom");
    return true;
  }, 0);
  await Promise.all([enqueue("bad"), enqueue("good")]);
  assert.deepEqual(seen, ["bad", "good"]);
});
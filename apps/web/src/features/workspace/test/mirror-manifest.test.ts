import assert from "node:assert/strict";
import { test } from "node:test";

import { MemoryWorkspaceFs } from "@weaveforge/core/testing";

import {
  MIRROR_MANIFEST_PATH,
  createCoalescer,
  nextManifest,
  readMirrorManifest,
  writeMirrorManifest,
} from "../application/mirror-manifest";

test("a manifest round trips, sorted and deduplicated", async () => {
  const fs = new MemoryWorkspaceFs();
  await writeMirrorManifest(fs, ["b.md", "a.md", "b.md"]);
  assert.deepEqual(await readMirrorManifest(fs), ["a.md", "b.md"]);
});

test("an absent manifest reads as remove-nothing rather than throwing", async () => {
  assert.deepEqual(await readMirrorManifest(new MemoryWorkspaceFs()), []);
});

test("a truncated or foreign manifest also removes nothing", async () => {
  const fs = new MemoryWorkspaceFs();
  await fs.mkdirp(MIRROR_MANIFEST_PATH.split("/")[0]!);

  await fs.writeFile(MIRROR_MANIFEST_PATH, '{"paths": ["a.md"');
  assert.deepEqual(await readMirrorManifest(fs), []);

  // Valid JSON, wrong shape — something else's file living at our path.
  await fs.writeFile(MIRROR_MANIFEST_PATH, '{"files": ["a.md"]}');
  assert.deepEqual(await readMirrorManifest(fs), []);
});

test("non-string entries are dropped rather than trusted", async () => {
  const fs = new MemoryWorkspaceFs();
  await fs.mkdirp(MIRROR_MANIFEST_PATH.split("/")[0]!);
  await fs.writeFile(MIRROR_MANIFEST_PATH, '{"paths": ["a.md", 7, null, "b.md"]}');
  assert.deepEqual(await readMirrorManifest(fs), ["a.md", "b.md"]);
});

test("the next manifest keeps what stayed, drops what left, adds what was written", () => {
  assert.deepEqual(
    nextManifest(["kept.md", "gone.md"], { written: ["new.md"], removed: ["gone.md"] }).sort(),
    ["kept.md", "new.md"],
  );
});

test("a file rewritten in place is not listed twice", () => {
  assert.deepEqual(nextManifest(["a.md"], { written: ["a.md"], removed: [] }), ["a.md"]);
});

/** A coalescer whose clock this test owns. */
function harness(run: () => Promise<unknown>, onError?: (error: unknown) => void) {
  const timers: (() => void)[] = [];
  const coalescer = createCoalescer({
    run,
    debounceMs: 5,
    ...(onError ? { onError } : {}),
    setTimeoutFn: (fn) => {
      timers.push(fn);
      return timers.length;
    },
    clearTimeoutFn: () => timers.pop(),
  });
  return { coalescer, fire: () => timers.splice(0).forEach((fire) => fire()) };
}

test("a burst of requests is one run", async () => {
  let runs = 0;
  const { coalescer, fire } = harness(async () => {
    runs += 1;
  });

  coalescer.request();
  coalescer.request();
  coalescer.request();
  fire();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runs, 1);
});

test("a request landing mid-run is honoured afterwards", async () => {
  let runs = 0;
  const gate: { release?: () => void } = {};
  const { coalescer, fire } = harness(async () => {
    runs += 1;
    if (runs === 1) {
      await new Promise<void>((resolve) => {
        gate.release = resolve;
      });
    }
  });

  coalescer.request();
  fire();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runs, 1);

  // Second request arrives while the first run is still going.
  coalescer.request();
  fire();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runs, 1, "the second run should wait rather than overlap");

  gate.release?.();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runs, 2);
});

test("a suspended coalescer stands down", async () => {
  let runs = 0;
  const { coalescer, fire } = harness(async () => {
    runs += 1;
  });

  coalescer.suspended = true;
  coalescer.request();
  fire();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runs, 0);

  coalescer.suspended = false;
  coalescer.request();
  fire();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runs, 1);
});

test("cancelling drops a pending request", async () => {
  let runs = 0;
  const { coalescer, fire } = harness(async () => {
    runs += 1;
  });

  coalescer.request();
  coalescer.cancel();
  fire();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runs, 0);
});

test("a failing run is reported, not thrown", async () => {
  const seen: unknown[] = [];
  const { coalescer, fire } = harness(async () => {
    throw new Error("disk unplugged");
  }, (error) => seen.push(error));

  coalescer.request();
  fire();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(seen.length, 1);

  // And the coalescer is still usable afterwards.
  coalescer.request();
  fire();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(seen.length, 2);
});

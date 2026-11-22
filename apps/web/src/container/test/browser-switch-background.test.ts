import assert from "node:assert/strict";
import { test } from "node:test";
import { openFilesIfSwitched, runBrowserSwitchInBackground } from "../browser-switch-background";
import type { SwitchDecision } from "../browser-export-switch";
import { MemorySink } from "../../features/migration-097/infrastructure/memory-sink";
import { SWITCH_MARKER_PATH, writeSwitchMarker } from "../../features/migration-097/domain/switch-marker";

const MARKED = { switchedAt: "2026-11-22T00:00:00.000Z", deviceId: "dev-1" };
const WIRING = { wiring: true, close: async () => {} } as never;

/**
 * P2-4. The 0.9.7 export runs off the startup path: the caller gets a promise it can ignore,
 * a hung export settles to null at the timeout, and a failing export never rejects.
 */

test("(P2-4) container starts when the export hangs: the call returns at once and the run is started", async () => {
  let started = 0;
  let resolveRun: (d: SwitchDecision) => void = () => {};
  const run = () => {
    started += 1;
    return new Promise<SwitchDecision>((resolve) => {
      resolveRun = resolve;
    });
  };
  const pending = runBrowserSwitchInBackground(run, 1000);
  assert.equal(started, 1);
  let settled = false;
  void pending.then(() => {
    settled = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(settled, false);
  resolveRun({ switch: false, reason: "no-session" });
  assert.deepEqual(await pending, { switch: false, reason: "no-session" });
});

test("(P2-4) a run that outlives the timeout settles to null, so the caller can fall back", async () => {
  const out = await runBrowserSwitchInBackground(() => new Promise<SwitchDecision>(() => {}), 20);
  assert.equal(out, null);
});

test("(098 P2 hung) the timeout aborts the run's signal; a run in time never sees an abort", async () => {
  let hungSignal: AbortSignal | undefined;
  const out = await runBrowserSwitchInBackground((signal) => {
    hungSignal = signal;
    return new Promise<SwitchDecision>(() => {});
  }, 10);
  assert.equal(out, null);
  assert.equal(hungSignal?.aborted, true, "the export is told to stop at the timeout");
  let quickSignal: AbortSignal | undefined;
  await runBrowserSwitchInBackground(async (signal) => {
    quickSignal = signal;
    return { switch: false, reason: "not-verified" };
  }, 1000);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(quickSignal?.aborted, false);
});

test("(098 P2) a switch that lands after the timeout has its files wiring closed and its result dropped", async () => {
  let closed = 0;
  let land: (d: SwitchDecision) => void = () => {};
  const late = { close: async () => void (closed += 1) } as never;
  const out = await runBrowserSwitchInBackground(
    () =>
      new Promise<SwitchDecision>((resolve) => {
        land = resolve;
      }),
    10,
  );
  assert.equal(out, null, "the caller sees the timeout, not the late switch");
  land({ switch: true, wiring: late });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(closed, 1, "the late wiring is closed, so no OPFS handle stays open");
});

test("(098 P2) a late close that rejects is swallowed: nothing rejects after the timeout", async () => {
  let land: (d: SwitchDecision) => void = () => {};
  const unhandled: unknown[] = [];
  const onUnhandled = (err: unknown) => unhandled.push(err);
  process.on("unhandledRejection", onUnhandled);
  try {
    const out = await runBrowserSwitchInBackground(
      () =>
        new Promise<SwitchDecision>((resolve) => {
          land = resolve;
        }),
      10,
    );
    assert.equal(out, null);
    land({ switch: true, wiring: { close: async () => Promise.reject(new Error("locked")) } as never });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(unhandled, []);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});

test("(098 P2) a late non-switch after the timeout closes nothing and is dropped", async () => {
  let land: (d: SwitchDecision) => void = () => {};
  const out = await runBrowserSwitchInBackground(
    () =>
      new Promise<SwitchDecision>((resolve) => {
        land = resolve;
      }),
    10,
  );
  assert.equal(out, null);
  land({ switch: false, reason: "not-verified" });
  await new Promise((resolve) => setTimeout(resolve, 5));
});

test("(098 P2) a switch in time keeps its wiring open for the caller", async () => {
  let closed = 0;
  const wiring = { close: async () => void (closed += 1) } as never;
  const out = await runBrowserSwitchInBackground(async () => ({ switch: true, wiring }), 1000);
  assert.deepEqual(out, { switch: true, wiring });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(closed, 0);
});

test("(P2-4) a run that throws settles to null and never rejects", async () => {
  const out = await runBrowserSwitchInBackground(async () => {
    throw new Error("opfs locked");
  }, 1000);
  assert.equal(out, null);
});

test("(P2-4) a verified run passes its decision through unchanged", async () => {
  const decision: SwitchDecision = { switch: false, reason: "not-verified" };
  assert.deepEqual(await runBrowserSwitchInBackground(async () => decision, 1000), decision);
});

/**
 * Item 1 call site. A marker written by a verified switch means this browser opens files directly.
 * An absent or unreadable marker leaves the caller on the server path.
 */

test("(item1) a present marker opens the files wiring", async () => {
  const sink = new MemorySink();
  await writeSwitchMarker(sink, MARKED);
  let opened = 0;
  const out = await openFilesIfSwitched(sink, "dev-1", async () => {
    opened += 1;
    return WIRING;
  });
  assert.deepEqual(out, { state: "opened", wiring: WIRING });
  assert.equal(opened, 1);
});

test("(item1) no marker: the files wiring is not opened and the caller stays on the server", async () => {
  let opened = 0;
  const out = await openFilesIfSwitched(new MemorySink(), "dev-1", async () => {
    opened += 1;
    return WIRING;
  });
  assert.deepEqual(out, { state: "absent" });
  assert.equal(opened, 0);
});

test("(item1) an unreadable marker counts as absent: nothing opens and the server path stays", async () => {
  const sink = new MemorySink();
  await sink.write(SWITCH_MARKER_PATH, "{not json");
  let opened = 0;
  const out = await openFilesIfSwitched(sink, "dev-1", async () => {
    opened += 1;
    return WIRING;
  });
  assert.deepEqual(out, { state: "absent" });
  assert.equal(opened, 0);
});

test("(P2) a marker from another install is no marker: this browser stays on the server", async () => {
  const sink = new MemorySink();
  await writeSwitchMarker(sink, { ...MARKED, deviceId: "dev-other" });
  let opened = 0;
  const out = await openFilesIfSwitched(sink, "dev-me", async () => {
    opened += 1;
    return WIRING;
  });
  assert.deepEqual(out, { state: "absent" });
  assert.equal(opened, 0);
});

test("(item6) a marker whose files fail to open is 'failed', not 'absent', and never throws", async () => {
  const sink = new MemorySink();
  await writeSwitchMarker(sink, MARKED);
  const out = await openFilesIfSwitched(sink, "dev-1", async () => {
    throw new Error("opfs locked");
  });
  assert.deepEqual(out, { state: "failed" });
});

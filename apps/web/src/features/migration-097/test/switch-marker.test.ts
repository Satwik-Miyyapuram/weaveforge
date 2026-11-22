import assert from "node:assert/strict";
import { test } from "node:test";
import { MemorySink } from "../infrastructure/memory-sink";
import { SWITCH_MARKER_PATH, readSwitchMarker, writeSwitchMarker } from "../domain/switch-marker";

/**
 * Item 1. `.weaveforge/migration-0.9.8/switched.json` records that this browser switched to OPFS
 * files. Present means open files directly; an unreadable or incomplete marker counts as absent.
 */

test("(item1) the marker lives under .weaveforge/migration-0.9.8", () => {
  assert.equal(SWITCH_MARKER_PATH, ".weaveforge/migration-0.9.8/switched.json");
});

test("(item1) a written marker reads back with switchedAt and deviceId", async () => {
  const sink = new MemorySink();
  await writeSwitchMarker(sink, { switchedAt: "2026-11-22T00:00:00.000Z", deviceId: "dev-1" });
  assert.deepEqual(await readSwitchMarker(sink), { switchedAt: "2026-11-22T00:00:00.000Z", deviceId: "dev-1" });
});

test("(item1) no marker reads as absent", async () => {
  assert.equal(await readSwitchMarker(new MemorySink()), null);
});

test("(item1) an unparseable marker counts as absent", async () => {
  const sink = new MemorySink();
  await sink.write(SWITCH_MARKER_PATH, "{not json");
  assert.equal(await readSwitchMarker(sink), null);
});

test("(item1) a marker without switchedAt counts as absent", async () => {
  const sink = new MemorySink();
  await sink.write(SWITCH_MARKER_PATH, JSON.stringify({ deviceId: "dev-1" }));
  assert.equal(await readSwitchMarker(sink), null);
});

test("(item1) a null deviceId is allowed: a browser with no desktop device still switches", async () => {
  const sink = new MemorySink();
  await writeSwitchMarker(sink, { switchedAt: "2026-11-22T00:00:00.000Z", deviceId: null });
  assert.deepEqual(await readSwitchMarker(sink), { switchedAt: "2026-11-22T00:00:00.000Z", deviceId: null });
});

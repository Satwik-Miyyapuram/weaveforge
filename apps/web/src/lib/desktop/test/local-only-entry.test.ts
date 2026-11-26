import assert from "node:assert/strict";
import { test } from "node:test";

import { enterLocalOnly, type LocalOnlyBridge } from "../local-only-entry";
import type { ExportReply, ExportRunner } from "../migrate-097-upgrade";

const FOLDER = "C:\\Users\\me\\Documents\\WeaveForge";

type Report = { state: string; ownRunVerified?: boolean; exportedHere?: boolean; removingDeviceId?: string; deviceId?: string };

/** A bridge whose database calls fail the test if the local-only route ever reaches them. */
function fakeBridge(over: { state?: string; report?: Report; picks?: boolean } = {}) {
  const calls: string[] = [];
  const bridge = {
    chooseVaultRoot: async () => {
      calls.push("chooseVaultRoot");
      return over.picks === false ? null : { path: FOLDER };
    },
    migrate097Status: async (folder: string) => {
      calls.push(`status:${folder}`);
      if (over.report) return over.report;
      // A folder counts as verified only with its own run's proof (ownRunVerified), as migrate-097.ts reads it.
      return over.state === "verified" ? { state: "verified", ownRunVerified: true, exportedHere: true } : { state: over.state ?? "none" };
    },
    queryLocalDb: async () => {
      calls.push("queryLocalDb");
      throw new Error("the local-only route must not reach the database");
    },
    resetLocalDb: async () => {
      calls.push("resetLocalDb");
      throw new Error("the local-only route must not reach the database");
    },
  };
  return { bridge: bridge as LocalOnlyBridge, calls };
}

/** An exporter that records the folders it ran for and answers `state`. */
function fakeRunner(state: ExportReply["state"] = "verified") {
  const runs: string[] = [];
  const run: ExportRunner = async (folder) => {
    runs.push(folder);
    return { state };
  };
  return { run, runs };
}

test("a cancelled folder picker changes nothing and reports cancelled", async () => {
  const { bridge, calls } = fakeBridge({ picks: false });
  const { run, runs } = fakeRunner();
  assert.equal(await enterLocalOnly(bridge, run), "cancelled");
  assert.deepEqual(calls, ["chooseVaultRoot"]);
  assert.deepEqual(runs, []);
});

test("a verified folder is opened straight away, without another export", async () => {
  const { bridge, calls } = fakeBridge({ state: "verified" });
  const { run, runs } = fakeRunner();
  assert.equal(await enterLocalOnly(bridge, run), "reload");
  assert.deepEqual(runs, []);
  assert.deepEqual(calls, ["chooseVaultRoot", `status:${FOLDER}`]);
});

test("a device with no old database (removed by this device) opens on the files, without an export", async () => {
  const { bridge } = fakeBridge({ report: { state: "removed", removingDeviceId: "dev-a", deviceId: "dev-a" } });
  const { run, runs } = fakeRunner();
  assert.equal(await enterLocalOnly(bridge, run), "reload");
  assert.deepEqual(runs, []);
});

test("this device's own verified removal in progress opens on the files, without an export", async () => {
  const { bridge } = fakeBridge({ report: { state: "removing", removingDeviceId: "dev-a", deviceId: "dev-a", ownRunVerified: true } });
  const { run, runs } = fakeRunner();
  assert.equal(await enterLocalOnly(bridge, run), "reload");
  assert.deepEqual(runs, []);
});

test("a folder that is not exported runs the export for that folder, then reloads", async () => {
  const { bridge } = fakeBridge({ state: "none" });
  const { run, runs } = fakeRunner();
  assert.equal(await enterLocalOnly(bridge, run), "reload");
  assert.deepEqual(runs, [FOLDER]);
});

test("an incomplete export still reloads, so the upgrade screen can show", async () => {
  const { bridge } = fakeBridge({ state: "incomplete" });
  const { run, runs } = fakeRunner("incomplete");
  assert.equal(await enterLocalOnly(bridge, run), "reload");
  assert.deepEqual(runs, [FOLDER]);
});

test("another device's removal on a device that never exported runs this device's export", async () => {
  const { bridge } = fakeBridge({ report: { state: "removed", removingDeviceId: "dev-b", deviceId: "dev-a" } });
  const { run, runs } = fakeRunner();
  assert.equal(await enterLocalOnly(bridge, run), "reload");
  assert.deepEqual(runs, [FOLDER]);
});

test("no exporter (outside the shell) is unavailable, never a silent wiring", async () => {
  const { bridge } = fakeBridge({ state: "none" });
  assert.equal(await enterLocalOnly(bridge, null), "unavailable");
});

test("an unavailable folder status is never exported: the run is skipped and unavailable returned", async () => {
  const { bridge } = fakeBridge({ state: "unavailable" });
  const { run, runs } = fakeRunner();
  assert.equal(await enterLocalOnly(bridge, run), "unavailable");
  assert.deepEqual(runs, []);
});

test("another device's running removal is never exported here: unavailable", async () => {
  const { bridge } = fakeBridge({ report: { state: "removing", removingDeviceId: "dev-b", deviceId: "dev-a" } });
  const { run, runs } = fakeRunner();
  assert.equal(await enterLocalOnly(bridge, run), "unavailable");
  assert.deepEqual(runs, []);
});

test("an export that throws is unavailable and does not reach the database", async () => {
  const { bridge, calls } = fakeBridge({ state: "none" });
  const run: ExportRunner = async () => {
    throw new Error("disk full");
  };
  assert.equal(await enterLocalOnly(bridge, run), "unavailable");
  assert.ok(!calls.includes("queryLocalDb") && !calls.includes("resetLocalDb"));
});

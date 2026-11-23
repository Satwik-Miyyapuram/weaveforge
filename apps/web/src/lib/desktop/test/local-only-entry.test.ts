import assert from "node:assert/strict";
import { test } from "node:test";

import { enterLocalOnly, type LocalOnlyBridge } from "../local-only-entry";

const FOLDER = "C:\\Users\\me\\Documents\\WeaveForge";

/** A bridge whose database calls fail the test if the local-only route ever reaches them. */
function fakeBridge(over: Partial<LocalOnlyBridge> & { state?: string; picks?: boolean } = {}) {
  const calls: string[] = [];
  const bridge = {
    chooseVaultRoot: async () => {
      calls.push("chooseVaultRoot");
      return over.picks === false ? null : { path: FOLDER };
    },
    migrate097Status: async (folder: string) => {
      calls.push(`status:${folder}`);
      // A folder counts as verified only with its own run's proof (ownRunVerified), as migrate-097.ts reads it.
      return over.state === "verified" ? { state: "verified", ownRunVerified: true, exportedHere: true } : { state: over.state ?? "none" };
    },
    migrate097Run: over.migrate097Run,
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

test("a cancelled folder picker changes nothing and reports cancelled", async () => {
  const { bridge, calls } = fakeBridge({ picks: false });
  assert.equal(await enterLocalOnly(bridge), "cancelled");
  assert.deepEqual(calls, ["chooseVaultRoot"]);
});

test("a verified folder is opened straight away, without another migration run", async () => {
  let ran = false;
  const { bridge, calls } = fakeBridge({
    state: "verified",
    migrate097Run: async () => {
      ran = true;
      return { state: "verified" };
    },
  });
  assert.equal(await enterLocalOnly(bridge), "reload");
  assert.equal(ran, false);
  assert.deepEqual(calls, ["chooseVaultRoot", `status:${FOLDER}`]);
});

test("a folder that is not verified enters the migration run for that folder, then reloads", async () => {
  const runs: string[] = [];
  const { bridge } = fakeBridge({
    state: "none",
    migrate097Run: async (folder: string) => {
      runs.push(folder);
      return { state: "verified" };
    },
  });
  assert.equal(await enterLocalOnly(bridge), "reload");
  assert.deepEqual(runs, [FOLDER]);
});

test("an incomplete run still reloads, so the upgrade screen can show", async () => {
  const { bridge } = fakeBridge({
    state: "incomplete",
    migrate097Run: async () => ({ state: "incomplete" }),
  });
  assert.equal(await enterLocalOnly(bridge), "reload");
});

test("an old shell without the migration run is unavailable, never a silent wiring", async () => {
  const { bridge } = fakeBridge({ state: "none" });
  assert.equal(await enterLocalOnly(bridge), "unavailable");
});

test("an unavailable folder status is never migrated: the run is skipped and unavailable returned", async () => {
  const runs: string[] = [];
  const { bridge } = fakeBridge({
    state: "unavailable",
    migrate097Run: async (folder: string) => {
      runs.push(folder);
      return { state: "verified" };
    },
  });
  assert.equal(await enterLocalOnly(bridge), "unavailable");
  assert.deepEqual(runs, []);
});

test("a migration run that throws is unavailable and does not reach the database", async () => {
  const { bridge, calls } = fakeBridge({
    state: "none",
    migrate097Run: async () => {
      throw new Error("disk full");
    },
  });
  assert.equal(await enterLocalOnly(bridge), "unavailable");
  assert.ok(!calls.includes("queryLocalDb") && !calls.includes("resetLocalDb"));
});

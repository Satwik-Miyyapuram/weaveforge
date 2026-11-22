import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { runCycleIfAllowed, syncAllowedHere, syncMayRun } from "@/features/offline-sync/ui/sync-gate";
import type { Migrate097Resolved } from "@/lib/desktop/migrate-097";

/**
 * Sync runs only in a folder whose 0.9.7 migration state is "none".
 *
 * Every other state (verified, incomplete, removing, removed, unexported,
 * removing-other, unavailable) keeps sync off, so the old database is never
 * pushed from a folder that has moved to files.
 */

const FOLDER = "C:/Users/me/Documents/WeaveForge";
const globals = globalThis as unknown as { window?: unknown };

afterEach(() => {
  delete globals.window;
});

function withShell(status: () => Promise<unknown>) {
  globals.window = {
    weaveforge: {
      fetchTitle: () => undefined,
      vaultRoot: async () => ({ path: FOLDER }),
      migrate097Status: status,
    },
  };
}

const EVERY_STATE: Migrate097Resolved[] = [
  "none",
  "verified",
  "incomplete",
  "removing",
  "removed",
  "unavailable",
  "removing-other",
  "unexported",
];

test("sync may run only when the migration state is none", () => {
  for (const state of EVERY_STATE) {
    assert.equal(syncMayRun(state), state === "none", state);
  }
});

test("the desktop gate reads the folder and allows sync only for a folder that was never migrated", async () => {
  withShell(async () => ({ state: "none" }));
  assert.equal(await syncAllowedHere(), true);

  const blocked: unknown[] = [
    { state: "incomplete" },
    { state: "verified", ownRunVerified: true, deviceId: "dev-a" },
    { state: "removed", ownRunVerified: true, deviceId: "dev-a" },
    { state: "removing", removingDeviceId: "dev-a", deviceId: "dev-a", ownRunVerified: true },
    { state: "verified", ownRunVerified: false, deviceId: "dev-a" },
    { state: "garbage" },
  ];
  for (const report of blocked) {
    withShell(async () => report);
    assert.equal(await syncAllowedHere(), false, JSON.stringify(report));
  }
});

test("a shell that cannot answer keeps sync off", async () => {
  withShell(async () => {
    throw new Error("shell gone");
  });
  assert.equal(await syncAllowedHere(), false);
});

test("outside the desktop shell there is no folder migration, so the gate does not apply", async () => {
  assert.equal(await syncAllowedHere(), true);
});

test("a cycle runs only while the gate allows it, so a folder that migrates mid-session stops syncing", async () => {
  let allowed = true;
  let cycles = 0;
  const cycle = async () => {
    cycles += 1;
  };
  assert.equal(await runCycleIfAllowed(async () => allowed, cycle), true);
  allowed = false;
  assert.equal(await runCycleIfAllowed(async () => allowed, cycle), false);
  assert.equal(cycles, 1, "the refused cycle never ran");
});

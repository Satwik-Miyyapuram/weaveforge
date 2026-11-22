import assert from "node:assert/strict";
import { test } from "node:test";

import { migrate097Status, usesFileBackend } from "../migrate-097";

const FOLDER = "C:\Users\me\Documents\WeaveForge";

test("a verified migration report is the only state that wires the file backend", async () => {
  const bridge = { migrate097Status: async () => ({ state: "verified" }) };
  assert.equal(await migrate097Status(bridge, FOLDER), "verified");
  assert.equal(usesFileBackend("verified"), true);
});

test("none and incomplete keep their own state", async () => {
  assert.equal(await migrate097Status({ migrate097Status: async () => ({ state: "none" }) }, FOLDER), "none");
  assert.equal(
    await migrate097Status({ migrate097Status: async () => ({ state: "incomplete" }) }, FOLDER),
    "incomplete",
  );
});

test("an unknown or missing shell state is unavailable, never none and never verified", async () => {
  for (const state of ["garbage", undefined, null, 42]) {
    const bridge = { migrate097Status: async () => ({ state }) as never };
    const resolved = await migrate097Status(bridge, FOLDER);
    assert.equal(resolved, "unavailable", `state ${String(state)} must be unavailable`);
    assert.equal(usesFileBackend(resolved), false);
  }
});

test("an old shell without the member, a null bridge or a throwing shell is unavailable", async () => {
  assert.equal(await migrate097Status(null, FOLDER), "unavailable");
  assert.equal(await migrate097Status({}, FOLDER), "unavailable");
  assert.equal(
    await migrate097Status(
      {
        migrate097Status: async () => {
          throw new Error("shell gone");
        },
      },
      FOLDER,
    ),
    "unavailable",
  );
  assert.equal(usesFileBackend("unavailable"), false);
});

test("a status that never answers within 3 s is unavailable", async () => {
  const bridge = { migrate097Status: () => new Promise<{ state: unknown }>(() => {}) };
  const started = Date.now();
  assert.equal(await migrate097Status(bridge, FOLDER), "unavailable");
  const waited = Date.now() - started;
  assert.ok(waited >= 2_900 && waited < 5_000, `waited ${waited} ms`);
});

test("no folder means there is nothing to migrate and nothing to wire", async () => {
  let called = false;
  const bridge = {
    migrate097Status: async () => {
      called = true;
      return { state: "verified" };
    },
  };
  assert.equal(await migrate097Status(bridge, null), "unavailable");
  assert.equal(called, false);
});

test("a removed migration wires the file backend: the old data is gone, so the old backend would be empty", async () => {
  const bridge = { migrate097Status: async () => ({ state: "removed" }) };
  assert.equal(await migrate097Status(bridge, FOLDER), "removed");
  assert.equal(usesFileBackend("removed"), true);
});

test("a removing migration on this device wires files; a removing migration on another device stays fail-closed", async () => {
  const own = { migrate097Status: async () => ({ state: "removing", removingDeviceId: "dev-a", deviceId: "dev-a" }) };
  assert.equal(await migrate097Status(own, FOLDER), "removing");
  assert.equal(usesFileBackend("removing"), true);

  const other = { migrate097Status: async () => ({ state: "removing", removingDeviceId: "dev-b", deviceId: "dev-a" }) };
  const resolved = await migrate097Status(other, FOLDER);
  assert.equal(resolved, "removing-other");
  assert.equal(usesFileBackend(resolved), false);
});

test("a removing report that cannot name this device is treated as another device's", async () => {
  const bridge = { migrate097Status: async () => ({ state: "removing", removingDeviceId: "dev-a" }) };
  assert.equal(await migrate097Status(bridge, FOLDER), "removing-other");
});

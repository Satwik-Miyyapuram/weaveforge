import assert from "node:assert/strict";
import { test } from "node:test";

import { migrate097Status, usesFileBackend } from "../migrate-097";

const FOLDER = "C:\Users\me\Documents\WeaveForge";

test("a verified migration report is the only state that wires the file backend", async () => {
  const bridge = {
    migrate097Status: async () => ({ state: "verified", deviceId: "dev-a", ownRunVerified: true, exportedHere: true }),
  };
  assert.equal(await migrate097Status(bridge, FOLDER), "verified");
  assert.equal(usesFileBackend("verified"), true);
});

test("a verified report without this folder's exported-to.json (a crash before the desktop mark) offers the export again", async () => {
  for (const exportedHere of [false, undefined]) {
    const bridge = { migrate097Status: async () => ({ state: "verified", deviceId: "dev-a", ownRunVerified: true, exportedHere }) };
    const resolved = await migrate097Status(bridge, FOLDER);
    assert.equal(resolved, "unexported", String(exportedHere));
    assert.equal(usesFileBackend(resolved), false);
  }
});

test("a verified report that this device did not verify itself never wires files on this device", async () => {
  const otherDevice = { migrate097Status: async () => ({ state: "verified", deviceId: "dev-a", ownRunVerified: false }) };
  const resolved = await migrate097Status(otherDevice, FOLDER);
  assert.notEqual(resolved, "verified");
  assert.equal(usesFileBackend(resolved), false);
  const missingFlag = { migrate097Status: async () => ({ state: "verified", deviceId: "dev-a" }) };
  assert.equal(usesFileBackend(await migrate097Status(missingFlag, FOLDER)), false);
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

test("a removed migration wires files only on a device that verified its own run or ran the removal", async () => {
  const ownRun = { migrate097Status: async () => ({ state: "removed", ownRunVerified: true, deviceId: "dev-a" }) };
  assert.equal(await migrate097Status(ownRun, FOLDER), "removed");
  assert.equal(usesFileBackend("removed"), true);

  const remover = {
    migrate097Status: async () => ({ state: "removed", removingDeviceId: "dev-a", deviceId: "dev-a", ownRunVerified: false }),
  };
  assert.equal(await migrate097Status(remover, FOLDER), "removed");

  // Folder-wide "removed" from another device's removal: this device never exported its own data.
  const other = {
    migrate097Status: async () => ({ state: "removed", removingDeviceId: "dev-b", deviceId: "dev-a", ownRunVerified: false }),
  };
  const resolved = await migrate097Status(other, FOLDER);
  assert.equal(resolved, "unexported");
  assert.equal(usesFileBackend(resolved), false);
});

test("a removed report that cannot name this device or its own run stays fail-closed", async () => {
  const bridge = { migrate097Status: async () => ({ state: "removed" }) };
  const resolved = await migrate097Status(bridge, FOLDER);
  assert.notEqual(resolved, "removed");
  assert.equal(usesFileBackend(resolved), false);
});

test("an unreadable report never wires the database-free backend, whatever the reason", async () => {
  const shells = [
    null,
    { migrate097Status: async () => undefined },
    { migrate097Status: async () => "verified" as never },
    { migrate097Status: async () => ({ state: "removed", ownRunVerified: "yes" }) as never },
  ];
  for (const bridge of shells) {
    const resolved = await migrate097Status(bridge as never, FOLDER);
    assert.equal(usesFileBackend(resolved), false, `${JSON.stringify(bridge)} must not wire files`);
  }
});

test("a removing migration on this device wires files only when this device verified its own run", async () => {
  const own = {
    migrate097Status: async () => ({ state: "removing", removingDeviceId: "dev-a", deviceId: "dev-a", ownRunVerified: true }),
  };
  assert.equal(await migrate097Status(own, FOLDER), "removing");
  assert.equal(usesFileBackend("removing"), true);

  const ownUnverified = { migrate097Status: async () => ({ state: "removing", removingDeviceId: "dev-a", deviceId: "dev-a" }) };
  const resolved = await migrate097Status(ownUnverified, FOLDER);
  assert.equal(usesFileBackend(resolved), false, "this device's removal without its own verified export never wires files");
});

test("a removing migration started by another device never wires files, verified or not", async () => {
  for (const ownRunVerified of [true, false, undefined]) {
    const other = {
      migrate097Status: async () => ({ state: "removing", removingDeviceId: "dev-b", deviceId: "dev-a", ownRunVerified }),
    };
    const resolved = await migrate097Status(other, FOLDER);
    assert.equal(resolved, "removing-other", `ownRunVerified ${String(ownRunVerified)}`);
    assert.equal(usesFileBackend(resolved), false);
  }
});

test("a removing report that cannot name this device is treated as another device's", async () => {
  const bridge = { migrate097Status: async () => ({ state: "removing", removingDeviceId: "dev-a" }) };
  assert.equal(await migrate097Status(bridge, FOLDER), "removing-other");
});

test("a shell report of unexported resolves to unexported, which never wires files", async () => {
  const bridge = { migrate097Status: async () => ({ state: "unexported" }) };
  const resolved = await migrate097Status(bridge, FOLDER);
  assert.equal(resolved, "unexported");
  assert.equal(usesFileBackend(resolved), false);
});

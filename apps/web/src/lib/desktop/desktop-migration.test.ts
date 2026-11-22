import assert from "node:assert/strict";
import { test } from "node:test";
import { desktopMigrationFromBridge, type MigrationBridge } from "./desktop-migration";

test("backup maps the shell's dumpPath to the engine's dump and drops the folder argument", async () => {
  const calls: string[] = [];
  const bridge: MigrationBridge = {
    migrate097Backup: async () => {
      calls.push("backup");
      return { deviceId: "dev-1", dumpPath: "C:/data/pre-097.sql" };
    },
    migrate097MarkExported: async () => {},
  };
  const migration = desktopMigrationFromBridge(bridge);
  assert.deepEqual(await migration.backup("C:/folder"), { deviceId: "dev-1", dump: "C:/data/pre-097.sql" });
  assert.deepEqual(calls, ["backup"]);
});

test("backup failure propagates and no mark is written", async () => {
  let marked = false;
  const bridge: MigrationBridge = {
    migrate097Backup: async () => {
      throw new Error("dump failed");
    },
    migrate097MarkExported: async () => {
      marked = true;
    },
  };
  await assert.rejects(desktopMigrationFromBridge(bridge).backup("C:/folder"), /dump failed/);
  assert.equal(marked, false);
});

test("markExported passes the folder through to the shell", async () => {
  const marks: string[] = [];
  const bridge: MigrationBridge = {
    migrate097Backup: async () => ({ deviceId: "d", dumpPath: "p" }),
    migrate097MarkExported: async (folder) => {
      marks.push(folder);
    },
  };
  await desktopMigrationFromBridge(bridge).markExported("C:/folder");
  assert.deepEqual(marks, ["C:/folder"]);
});

test("a missing bridge refuses loudly instead of passing", async () => {
  const migration = desktopMigrationFromBridge(null);
  await assert.rejects(migration.backup("C:/folder"), /not available/);
  await assert.rejects(migration.markExported("C:/folder"), /not available/);
});

test("a bridge without the backup or mark method refuses loudly", async () => {
  const migration = desktopMigrationFromBridge({});
  await assert.rejects(migration.backup("C:/folder"), /not available/);
  await assert.rejects(migration.markExported("C:/folder"), /not available/);
});

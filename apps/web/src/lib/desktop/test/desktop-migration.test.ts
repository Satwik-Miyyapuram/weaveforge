import assert from "node:assert/strict";
import { test } from "node:test";
import { desktopMigrationFromBridge, type MigrationBridge } from "../desktop-migration";

test("backup passes the folder and maps the shell's dumpPath to a plain dump file name", async () => {
  const calls: string[] = [];
  const bridge: MigrationBridge = {
    migrate097Backup: async (folder) => {
      calls.push(`backup:${folder}`);
      return { deviceId: "dev-1", dumpPath: "C:/data/pre-097.sql" };
    },
    migrate097MarkExported: async () => {},
  };
  const migration = desktopMigrationFromBridge(bridge);
  assert.deepEqual(await migration.backup("C:/folder"), { deviceId: "dev-1", dump: "pre-097.sql" });
  assert.deepEqual(calls, ["backup:C:/folder"]);
});

test("backup names the migration-folder dump by its file name only, as the shell's remove step requires", async () => {
  const bridge: MigrationBridge = {
    migrate097Backup: async () => ({ deviceId: "d", dumpPath: "C:\\ws\\.weaveforge/migration-0.9.7\\pre-migration-1.dump" }),
  };
  assert.equal((await desktopMigrationFromBridge(bridge).backup("C:/folder")).dump, "pre-migration-1.dump");
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

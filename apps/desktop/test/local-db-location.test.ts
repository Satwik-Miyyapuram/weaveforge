import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

import { databaseDirFor, isDatabase, relocateDatabaseOnce, StrandedDatabaseError } from "../src/local-db-location";

/**
 * The relocation's safety properties.
 *
 * These exist because the first version of this feature destroyed a database:
 * it ran on every launch, so a failure was retried forever, and the failure was
 * answered by throwing the result away. The tests below are the rules that make
 * that impossible — once ever, source never deleted, destination proven before
 * it is adopted — plus the steady-state behaviour that keeps the ordinary launch
 * free of any engine work at all.
 *
 * The engine is injected throughout: what is under test is the *policy*, not
 * PGlite. The round trip itself is checked separately against a real engine.
 */

const made: string[] = [];

function scratch(): { app: string; meta: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wf-loc-"));
  made.push(root);
  const app = path.join(root, "app-db");
  const meta = path.join(root, "workspace", ".weaveforge");
  fs.mkdirSync(app, { recursive: true });
  fs.writeFileSync(path.join(app, "PG_VERSION"), "17\n", "utf8");
  return { app, meta };
}

/** An engine that writes a plausible destination. */
function engine(options: { failLoad?: boolean; failVerify?: boolean; dumps?: string[] } = {}) {
  return {
    dump: async (dir: string) => {
      options.dumps?.push(dir);
      return { bytes: { fake: true }, close: async () => {} };
    },
    load: async (target: string) => {
      if (options.failLoad) throw new Error("load failed");
      fs.mkdirSync(target, { recursive: true });
      fs.writeFileSync(path.join(target, "PG_VERSION"), "17\n", "utf8");
    },
    verify: async () => !options.failVerify,
  };
}

after(() => {
  for (const dir of made) fs.rmSync(dir, { recursive: true, force: true });
});

describe("relocating the database into the workspace", () => {
  it("moves it, writes the destination, and reports where it went", async () => {
    const { app, meta } = scratch();
    const result = await relocateDatabaseOnce({ appDir: app, workspaceMetaDir: meta, ...engine() });

    assert.equal(result.moved, true);
    assert.equal(result.dir, path.join(meta, "db"));
    assert.equal(isDatabase(path.join(meta, "db")), true);
  });

  it("leaves the source in place — it is the fallback, not a thing to consume", async () => {
    const { app, meta } = scratch();
    await relocateDatabaseOnce({ appDir: app, workspaceMetaDir: meta, ...engine() });

    // The whole reason a failed move is survivable.
    assert.equal(isDatabase(app), true, "the app directory still holds a database");
  });

  it("removes a half-written destination and falls back when the load fails", async () => {
    const { app, meta } = scratch();
    const result = await relocateDatabaseOnce({
      appDir: app,
      workspaceMetaDir: meta,
      ...engine({ failLoad: true }),
    });

    assert.equal(result.moved, false);
    assert.equal(result.dir, app);
    // A directory left behind would be found by `databaseDirFor` on the next
    // launch and opened as if it were the reader's database.
    assert.equal(fs.existsSync(path.join(meta, "db")), false);
    assert.equal(isDatabase(app), true);
  });

  it("rejects a destination that loads but does not reopen", async () => {
    // This is the bug that shipped unnoticed: a directory that exists, looks
    // initialized, and cannot be opened. The move must not adopt it.
    const { app, meta } = scratch();
    const result = await relocateDatabaseOnce({
      appDir: app,
      workspaceMetaDir: meta,
      ...engine({ failVerify: true }),
    });

    assert.equal(result.moved, false);
    assert.equal(result.dir, app);
    assert.equal(fs.existsSync(path.join(meta, "db")), false);
  });

  it("does not try a second time for a folder where it failed", async () => {
    // The property that turns a crash loop into a log line.
    const { app, meta } = scratch();
    const dumps: string[] = [];
    await relocateDatabaseOnce({ appDir: app, workspaceMetaDir: meta, ...engine({ failLoad: true, dumps }) });
    assert.equal(dumps.length, 1);

    // A later launch: even with a working engine, it must not retry.
    const again = await relocateDatabaseOnce({ appDir: app, workspaceMetaDir: meta, ...engine({ dumps }) });
    assert.equal(dumps.length, 1, "the move was not attempted again");
    assert.equal(again.moved, false);
    assert.equal(again.dir, app);
  });

  it("does no engine work at all once the database is already in the workspace", async () => {
    // The steady state for every launch after a successful move. If this ever
    // dumps, the ordinary boot is paying for a migration that already happened.
    const { app, meta } = scratch();
    fs.mkdirSync(path.join(meta, "db"), { recursive: true });
    fs.writeFileSync(path.join(meta, "db", "PG_VERSION"), "17\n", "utf8");

    const dumps: string[] = [];
    const result = await relocateDatabaseOnce({ appDir: app, workspaceMetaDir: meta, ...engine({ dumps }) });
    assert.equal(result.dir, path.join(meta, "db"));
    assert.equal(result.moved, false);
    assert.deepEqual(dumps, [], "no dump was taken");
  });

  it("says so and does nothing when there is no database to move", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "wf-loc-empty-"));
    made.push(root);
    const app = path.join(root, "app-db");
    fs.mkdirSync(app, { recursive: true });
    const meta = path.join(root, "ws", ".weaveforge");

    const result = await relocateDatabaseOnce({ appDir: app, workspaceMetaDir: meta, ...engine() });
    assert.equal(result.moved, false);
    assert.equal(result.dir, app);
    assert.equal(fs.existsSync(path.join(meta, "db")), false);
  });
});

describe("choosing which directory to open", () => {
  it("uses the workspace when a database is there", () => {
    const { app, meta } = scratch();
    fs.mkdirSync(path.join(meta, "db"), { recursive: true });
    fs.writeFileSync(path.join(meta, "db", "PG_VERSION"), "17\n", "utf8");
    assert.equal(databaseDirFor(app, meta), path.join(meta, "db"));
  });

  it("uses the app directory only when no folder is chosen", () => {
    const { app } = scratch();
    assert.equal(databaseDirFor(app, null), app);
  });

  it("starts a fresh database in the workspace when there is none anywhere", () => {
    const { app, meta } = scratch();
    fs.rmSync(app, { recursive: true });
    assert.equal(databaseDirFor(app, meta), path.join(meta, "db"));
  });

  it("refuses to fall back to the app copy when the workspace has none", () => {
    const { app, meta } = scratch();
    assert.throws(() => databaseDirFor(app, meta), StrandedDatabaseError);
  });
});

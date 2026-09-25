import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

import { databaseDirFor, isDatabase, relocateDatabaseOnce } from "../src/local-db-location";

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
  it("prefers the workspace when a database is there", async () => {
    const { app, meta } = scratch();
    fs.mkdirSync(path.join(meta, "db"), { recursive: true });
    fs.writeFileSync(path.join(meta, "db", "PG_VERSION"), "17\n", "utf8");
    assert.equal(await databaseDirFor(app, meta, async () => true), path.join(meta, "db"));
  });

  it("falls back to the app directory when there is none, or no folder at all", async () => {
    const { app, meta } = scratch();
    assert.equal(await databaseDirFor(app, meta, async () => true), app);
    assert.equal(await databaseDirFor(app, null, async () => true), app);
  });

  it("does not mistake an empty directory for a database", async () => {
    // A destination whose load was interrupted can leave the folder without
    // PG_VERSION behind. Trusting the name alone would open it.
    const { app, meta } = scratch();
    fs.mkdirSync(path.join(meta, "db"), { recursive: true });
    assert.equal(await databaseDirFor(app, meta, async () => true), app);
  });

  it("refuses a copy that looks like a database but will not open", async () => {
    /*
     * The second crash loop this feature caused, pinned.
     *
     * The workspace held a real 318 MB database with a `PG_VERSION` file, and it
     * was declared "already in the workspace folder" — but the engine could not
     * open it at boot, because the process being replaced still held it. The
     * guard asked whether the directory *looked* right and never asked whether
     * it *opened*, so every launch chose it, failed, and let `recover` move it
     * aside: one 318 MB database discarded per launch.
     *
     * A copy that will not open must fall back to the app's own directory. That
     * is temporary on purpose — no marker is written — so once the lock clears
     * the workspace copy is used again.
     */
    const { app, meta } = scratch();
    fs.mkdirSync(path.join(meta, "db"), { recursive: true });
    fs.writeFileSync(path.join(meta, "db", "PG_VERSION"), "17\n", "utf8");

    assert.equal(await databaseDirFor(app, meta, async () => false), app);
  });

  it("treats a verification that throws as a refusal, not as consent", async () => {
    // Fail closed: an engine that cannot answer the question is not a reason to
    // open a directory anyway.
    const { app, meta } = scratch();
    fs.mkdirSync(path.join(meta, "db"), { recursive: true });
    fs.writeFileSync(path.join(meta, "db", "PG_VERSION"), "17\n", "utf8");

    assert.equal(
      await databaseDirFor(app, meta, async () => {
        throw new Error("engine unavailable");
      }),
      app,
    );
  });

  it("falls back to the name check when the caller has no engine", async () => {
    // No verifier means no way to ask, so `isDatabase` is all there is. Recorded
    // rather than asserted as desirable: the shell always passes one, and this
    // documents what the fallback is rather than implying it is a good idea.
    const { app, meta } = scratch();
    fs.mkdirSync(path.join(meta, "db"), { recursive: true });
    fs.writeFileSync(path.join(meta, "db", "PG_VERSION"), "17\n", "utf8");

    assert.equal(await databaseDirFor(app, meta), path.join(meta, "db"));
  });
});

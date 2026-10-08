import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { LocalDbBackups, backupFileName, readBackup } from "../src/local-db-backup";

/**
 * Backups are files: what is asserted is which files exist after which calls,
 * on a real temporary directory. The engine is a stub that hands over bytes,
 * because `dumpDataDir` is PGlite's and what matters here is what is done
 * with what it returns.
 */

function scratch(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "wf-backup-"));
}

function dumping(bytes: string) {
  return { dumpDataDir: async () => new Blob([bytes]) };
}

/** A clock that ticks one second per call, so names sort the way time does. */
function ticking(start = Date.UTC(2026, 8, 17, 10, 0, 0)) {
  let t = start;
  return () => new Date((t += 1000));
}

test("backup: written to every place, and read back whole", async () => {
  const a = path.join(scratch(), "a");
  const b = path.join(scratch(), "nested", "b");
  const backups = new LocalDbBackups({ dirs: () => [a, b], now: ticking() });

  const written = await backups.take(dumping("data-1"));
  assert.equal(written.length, 2);
  assert.equal(path.basename(written[0]!), path.basename(written[1]!));
  assert.ok(fs.existsSync(written[1]!), "a place that did not exist is made");
  assert.equal(await (await readBackup(written[0]!)).text(), "data-1");
  assert.deepEqual(
    fs.readdirSync(a).filter((n) => n.endsWith(".part")),
    [],
    "no draft is left behind",
  );
});

test("backup: the newest few are kept, the rest go", async () => {
  const dir = scratch();
  const backups = new LocalDbBackups({ dirs: () => [dir], keep: 2, now: ticking() });
  for (const n of [1, 2, 3, 4]) await backups.take(dumping(`data-${n}`));

  const kept = fs.readdirSync(dir).sort();
  assert.equal(kept.length, 2);
  assert.equal(await (await readBackup(path.join(dir, kept[1]!))).text(), "data-4");
  assert.equal(await (await readBackup(path.join(dir, kept[0]!))).text(), "data-3");
});

test("backup: latest is the newest across places, or null", async () => {
  const a = scratch();
  const b = scratch();
  const backups = new LocalDbBackups({ dirs: () => [a, b], now: ticking() });
  assert.equal(await backups.latest(), null);

  await backups.take(dumping("old"));
  // Only `b` gets the next one, as a folder that was chosen later would.
  const later = new LocalDbBackups({ dirs: () => [b], now: ticking(Date.UTC(2026, 8, 17, 11)) });
  await later.take(dumping("new"));

  const latest = await backups.latest();
  assert.ok(latest && latest.startsWith(b), String(latest));
  assert.equal(await (await readBackup(latest)).text(), "new");
});

test("backup: a place that cannot be written is skipped, not fatal", async () => {
  const good = scratch();
  const file = path.join(scratch(), "not-a-dir");
  fs.writeFileSync(file, "");
  const bad = path.join(file, "under-a-file");
  const backups = new LocalDbBackups({ dirs: () => [bad, good], now: ticking() });

  const written = await backups.take(dumping("data"));
  assert.equal(written.length, 1);
  assert.ok(written[0]!.startsWith(good));
});

test("backup: a draft from an interrupted write is not a backup", async () => {
  const dir = scratch();
  fs.writeFileSync(path.join(dir, `${backupFileName(new Date())}.part`), "half");
  const backups = new LocalDbBackups({ dirs: () => [dir] });
  assert.equal(await backups.latest(), null);
});

test("backup: file names sort by time and are legal on every filesystem", () => {
  const earlier = backupFileName(new Date("2026-09-17T10:00:00.000Z"));
  const later = backupFileName(new Date("2026-09-17T10:00:01.000Z"));
  assert.ok(earlier < later);
  assert.doesNotMatch(earlier, /:/);
  assert.equal(earlier, "local-db-2026-09-17T10-00-00-000.tar.gz");
});

test("backup: past the newest few, one per day is kept for the last few days", async () => {
  const dir = scratch();
  const day = 24 * 3600 * 1000;
  // Ten days, two a day, so a bad run in the newest ones still leaves older days.
  for (let d = 0; d < 10; d++) {
    const backups = new LocalDbBackups({
      dirs: () => [dir],
      keep: 3,
      dailyKeep: 4,
      now: ticking(Date.UTC(2026, 9, 1) + d * day),
    });
    await backups.take(dumping(`day-${d}-a`));
    await backups.take(dumping(`day-${d}-b`));
  }
  const kept = await Promise.all(
    fs.readdirSync(dir).sort().map(async (n) => (await readBackup(path.join(dir, n))).text()),
  );
  assert.deepEqual(kept, ["day-6-b", "day-7-b", "day-8-b", "day-9-a", "day-9-b"]);
});

test("backup: all lists every place's backups, newest first", async () => {
  const a = scratch();
  const b = scratch();
  await new LocalDbBackups({ dirs: () => [a], now: ticking() }).take(dumping("old"));
  await new LocalDbBackups({ dirs: () => [b], now: ticking(Date.UTC(2026, 8, 18)) }).take(dumping("new"));
  const all = await new LocalDbBackups({ dirs: () => [a, b] }).all();
  assert.deepEqual(
    await Promise.all(all.map(async (f) => (await readBackup(f)).text())),
    ["new", "old"],
  );
});

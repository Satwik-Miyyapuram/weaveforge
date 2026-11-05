import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import zlib from "node:zlib";

import { PGlite } from "@electric-sql/pglite";

import { dumpOnDisk, writeDataDirTarGz } from "../src/local-db-tar";

/**
 * The backup is written from the data directory on disk, as the same tarball
 * PGlite's own `dumpDataDir` makes, instead of from a dump PGlite builds in
 * memory (M02). What is asserted: the tarball is one PGlite loads back, it
 * names the same entries PGlite's own dump does, and making it does not cost
 * main a copy of the database.
 */

function scratch(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "wf-tar-"));
}

interface Entry {
  name: string;
  type: string;
  body: Buffer;
}

/** A minimal ustar reader: enough to check what was written. */
function readTar(gz: Buffer): Entry[] {
  const tar = zlib.gunzipSync(gz);
  const entries: Entry[] = [];
  let off = 0;
  while (off + 512 <= tar.length) {
    const h = tar.subarray(off, off + 512);
    if (h.every((b) => b === 0)) break;
    const str = (at: number, n: number) => h.subarray(at, at + n).toString("utf8").replace(/\0.*$/s, "");
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : h[i]!;
    assert.equal(parseInt(str(148, 8).trim(), 8), sum, `checksum of ${str(0, 100)}`);
    assert.equal(str(257, 6), "ustar");
    const prefix = str(345, 155);
    const size = parseInt(str(124, 12).trim() || "0", 8);
    entries.push({
      name: prefix ? `${prefix}/${str(0, 100)}` : str(0, 100),
      type: str(156, 1) || "0",
      body: tar.subarray(off + 512, off + 512 + size),
    });
    off += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
}

test("tar: every directory and file under the data directory, named from its root", async () => {
  const dir = scratch();
  fs.mkdirSync(path.join(dir, "base", "1"), { recursive: true });
  fs.mkdirSync(path.join(dir, "empty"));
  fs.writeFileSync(path.join(dir, "PG_VERSION"), "17\n");
  fs.writeFileSync(path.join(dir, "base", "1", "112"), Buffer.alloc(8192, 7));
  fs.writeFileSync(path.join(dir, "base", "1", "zero"), "");
  const odd = Buffer.from(Array.from({ length: 1000 }, (_, i) => i & 0xff));
  fs.writeFileSync(path.join(dir, "base", "odd"), odd);
  const out = path.join(scratch(), "x.tar.gz");

  await writeDataDirTarGz(dir, out);
  const entries = readTar(fs.readFileSync(out));

  assert.deepEqual(
    entries.map((e) => `${e.type} ${e.name}`).sort(),
    [
      "0 /PG_VERSION",
      "0 /base/1/112",
      "0 /base/1/zero",
      "0 /base/odd",
      "5 /base",
      "5 /base/1",
      "5 /empty",
    ],
  );
  const byName = new Map(entries.map((e) => [e.name, e]));
  assert.equal(byName.get("/PG_VERSION")!.body.toString(), "17\n");
  assert.ok(byName.get("/base/1/112")!.body.equals(Buffer.alloc(8192, 7)));
  assert.equal(byName.get("/base/1/zero")!.body.length, 0);
  assert.ok(byName.get("/base/odd")!.body.equals(odd), "a size that is not a whole block");
  const at = (name: string) => entries.findIndex((e) => e.name === name);
  assert.ok(at("/base") < at("/base/1") && at("/base/1") < at("/base/1/112"), "a directory comes before what is in it");
});

test("tar: a path longer than the name field is split into the prefix field", async () => {
  const dir = scratch();
  const deep = path.join(dir, "a".repeat(60), "b".repeat(60));
  fs.mkdirSync(deep, { recursive: true });
  fs.writeFileSync(path.join(deep, "c".repeat(30)), "deep");
  const out = path.join(scratch(), "x.tar.gz");

  await writeDataDirTarGz(dir, out);
  const file = readTar(fs.readFileSync(out)).find((e) => e.type === "0")!;
  assert.equal(file.name, `/${"a".repeat(60)}/${"b".repeat(60)}/${"c".repeat(30)}`);
  assert.equal(file.body.toString(), "deep");
});

test("tar: a data directory that is not there fails, and leaves nothing behind", async () => {
  const out = path.join(scratch(), "x.tar.gz");
  await assert.rejects(writeDataDirTarGz(path.join(scratch(), "missing"), out));
  assert.equal(fs.existsSync(out), false);
});

test("tar: a dump from disk loads back into PGlite, with the entries PGlite's own dump has", async () => {
  const dir = scratch();
  const db = await PGlite.create({ dataDir: dir });
  await db.exec("create table t(id int, body text); insert into t select g, md5(g::text) from generate_series(1, 2000) g");
  const out = path.join(scratch(), "x.tar.gz");
  try {
    await dumpOnDisk(db, dir, out);
    const own = readTar(Buffer.from(await (await db.dumpDataDir("gzip")).arrayBuffer()));
    const ours = readTar(fs.readFileSync(out));
    assert.deepEqual(
      ours.map((e) => `${e.type} ${e.name}`).sort(),
      own.map((e) => `${e.type} ${e.name}`).sort(),
    );
    // Still usable after the dump: the lock it held was let go.
    await db.exec("insert into t values (2001, 'after')");
  } finally {
    await db.close();
  }

  const back = await PGlite.create({ loadDataDir: await fs.openAsBlob(out) });
  try {
    const { rows } = await back.query<{ n: number }>("select count(*)::int n from t");
    assert.equal(rows[0]!.n, 2000);
  } finally {
    await back.close();
  }
});

test("tar: a dump taken among running queries holds what was committed before it", async () => {
  const dir = scratch();
  const db = await PGlite.create({ dataDir: dir });
  const out = path.join(scratch(), "x.tar.gz");
  try {
    await db.exec("create table t(x int)");
    await Promise.all([
      db.query("insert into t select generate_series(1, 20000)"),
      dumpOnDisk(db, dir, out),
      db.query("insert into t values (0)"),
    ]);
  } finally {
    await db.close();
  }
  const back = await PGlite.create({ loadDataDir: await fs.openAsBlob(out) });
  try {
    const { rows } = await back.query<{ n: number }>("select count(*)::int n from t");
    assert.ok([20000, 20001].includes(rows[0]!.n), String(rows[0]!.n));
  } finally {
    await back.close();
  }
});

test("tar: backing up a database over 50 MB keeps main's memory near flat", async () => {
  const dir = scratch();
  const db = await PGlite.create({ dataDir: dir });
  try {
    await db.exec(
      "create table t(id int, body text); insert into t select g, md5(g::text)||md5((g*7)::text)||md5((g*13)::text) from generate_series(1, 500000) g",
    );
    const onDisk = (d: string): number =>
      fs.readdirSync(d, { withFileTypes: true }).reduce(
        (sum, e) => sum + (e.isDirectory() ? onDisk(path.join(d, e.name)) : fs.statSync(path.join(d, e.name)).size),
        0,
      );
    assert.ok(onDisk(dir) > 50e6, `test database is ${onDisk(dir)} bytes`);

    const before = process.memoryUsage().rss;
    let peak = before;
    const sample = setInterval(() => (peak = Math.max(peak, process.memoryUsage().rss)), 2);
    await dumpOnDisk(db, dir, path.join(scratch(), "x.tar.gz"));
    clearInterval(sample);
    peak = Math.max(peak, process.memoryUsage().rss);
    // PGlite's own in-memory dump of this database costs main ~380 MB.
    assert.ok(peak - before < 64e6, `main grew ${Math.round((peak - before) / 1e6)} MB`);
  } finally {
    await db.close();
  }
});

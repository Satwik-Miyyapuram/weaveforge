import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { postgresFiles, stagePostgres } from "./stage-postgres.mjs";

function tree(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wf-pg-stage-"));
  for (const rel of files) {
    const p = path.join(root, ...rel.split("/"));
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, rel);
  }
  return root;
}

const WIN = [
  "bin/postgres.exe", "bin/initdb.exe", "bin/pg_ctl.exe", "bin/pg_dump.exe", "bin/pg_restore.exe",
  "bin/psql.exe", "bin/pgbench.exe", "bin/python.exe",
  "bin/libpq.dll", "bin/libssl-3-x64.dll", "bin/icuuc78.dll", "bin/zstd.dll",
  "bin/python3.dll", "bin/python314.dll", "bin/pkgconf-8.dll", "bin/libecpg.dll", "bin/libecpg_compat.dll",
  "bin/libpgtypes.dll", "bin/libxslt.dll", "bin/libexslt.dll", "bin/DLLs/_ssl.pyd", "bin/Lib/os.py",
  "lib/plpgsql.dll", "lib/pgcrypto.dll", "lib/dict_snowball.dll", "lib/utf8_and_win.dll",
  "lib/latin2_and_win1250.dll", "lib/plpython3.dll", "lib/hstore.dll", "lib/libpq.lib", "lib/libpgport.a",
  "share/postgres.bki", "share/timezone/Europe/Amsterdam", "share/tsearch_data/english.stop",
  "share/extension/plpgsql.control", "share/extension/plpgsql--1.0.sql",
  "share/extension/pgcrypto.control", "share/extension/pgcrypto--1.3--1.4.sql",
  "share/extension/hstore.control", "share/extension/pgcrypto_extra.control", "share/doc/README",
  "include/postgres.h", "dependency-notices/openssl/LICENSE.txt", "COPYRIGHT", "LICENSE", "source-input.json",
];

test("keeps the tools, their libraries, two extensions and the licences; drops the rest", () => {
  const dist = tree(WIN);
  try {
    assert.deepEqual(postgresFiles(dist, "win32"), [
      "COPYRIGHT", "LICENSE",
      "bin/icuuc78.dll", "bin/initdb.exe", "bin/libpq.dll", "bin/libssl-3-x64.dll",
      "bin/pg_ctl.exe", "bin/pg_dump.exe", "bin/pg_restore.exe", "bin/postgres.exe", "bin/zstd.dll",
      "dependency-notices/openssl/LICENSE.txt",
      "lib/dict_snowball.dll", "lib/latin2_and_win1250.dll", "lib/pgcrypto.dll", "lib/plpgsql.dll", "lib/utf8_and_win.dll",
      "share/extension/pgcrypto--1.3--1.4.sql", "share/extension/pgcrypto.control",
      "share/extension/plpgsql--1.0.sql", "share/extension/plpgsql.control",
      "share/postgres.bki", "share/timezone/Europe/Amsterdam", "share/tsearch_data/english.stop",
      "source-input.json",
    ]);
  } finally {
    fs.rmSync(dist, { recursive: true, force: true });
  }
});

test("a dist missing a tool is refused by name", () => {
  const dist = tree(WIN.filter((f) => f !== "bin/pg_restore.exe"));
  try {
    assert.throws(() => postgresFiles(dist, "win32"), /bin\/ lacks: pg_restore\.exe/);
  } finally {
    fs.rmSync(dist, { recursive: true, force: true });
  }
});

test("on Linux, tools have no .exe and shared libraries in lib/ ship", () => {
  const dist = tree([
    "bin/postgres", "bin/initdb", "bin/pg_ctl", "bin/pg_dump", "bin/pg_restore", "bin/psql",
    "lib/libpq.so.5", "lib/libicuuc.so.74", "lib/plpgsql.so", "lib/pgcrypto.so", "lib/dict_snowball.so",
    "lib/hstore.so", "lib/libpq.a", "lib/pkgconfig/libpq.pc",
  ]);
  try {
    assert.deepEqual(postgresFiles(dist, "linux"), [
      "bin/initdb", "bin/pg_ctl", "bin/pg_dump", "bin/pg_restore", "bin/postgres",
      "lib/dict_snowball.so", "lib/libicuuc.so.74", "lib/libpq.so.5", "lib/pgcrypto.so", "lib/plpgsql.so",
    ]);
  } finally {
    fs.rmSync(dist, { recursive: true, force: true });
  }
});

test("staging copies the files under <out>/postgres and replaces an old stage", () => {
  const dist = tree(WIN);
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "wf-pg-out-"));
  try {
    fs.mkdirSync(path.join(out, "postgres", "bin"), { recursive: true });
    fs.writeFileSync(path.join(out, "postgres", "bin", "stale.dll"), "x");
    const { target, files } = stagePostgres(dist, out, "win32");
    assert.equal(target, path.join(out, "postgres"));
    assert.equal(fs.readFileSync(path.join(target, "bin", "postgres.exe"), "utf8"), "bin/postgres.exe");
    assert.ok(!fs.existsSync(path.join(target, "bin", "stale.dll")));
    assert.equal(files.length, 25);
  } finally {
    fs.rmSync(dist, { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { assertPostgresMajor, postgresFiles, stagePostgres } from "./stage-postgres.mjs";

const SCRIPT = fileURLToPath(new URL("./stage-postgres.mjs", import.meta.url));

function tree(files, version = "18.6") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wf-pg-stage-"));
  for (const rel of files) {
    const p = path.join(root, ...rel.split("/"));
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, rel === "build-manifest.json" ? JSON.stringify({ source: { version } }) : rel);
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
  "build-manifest.json",
];

test("keeps the tools, their libraries, two extensions and the licences; drops the rest", () => {
  const dist = tree(WIN);
  try {
    assert.deepEqual(postgresFiles(dist, "win32"), [
      "COPYRIGHT", "LICENSE",
      "bin/icuuc78.dll", "bin/initdb.exe", "bin/libpq.dll", "bin/libssl-3-x64.dll",
      "bin/pg_ctl.exe", "bin/pg_dump.exe", "bin/pg_restore.exe", "bin/postgres.exe", "bin/zstd.dll",
      "build-manifest.json", "dependency-notices/openssl/LICENSE.txt",
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
    assert.equal(files.length, 26);
  } finally {
    fs.rmSync(dist, { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test("a major other than 18 is refused by name, and nothing is staged", () => {
  const dist = tree(WIN, "16.15");
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "wf-pg-out-"));
  try {
    assert.throws(() => stagePostgres(dist, out, "win32"), /Postgres 16\.15 .* is major 16; the installer ships major 18/);
    assert.ok(!fs.existsSync(path.join(out, "postgres")));
  } finally {
    fs.rmSync(dist, { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test("assertPostgresMajor accepts 18.x and reports the full version", () => {
  const dir = tree(WIN, "18.6");
  try {
    assert.equal(assertPostgresMajor(dir), "18.6");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a stage without a manifest, or with no version in it, is refused", () => {
  const none = tree(WIN.filter((f) => f !== "build-manifest.json"));
  const bare = tree(WIN);
  fs.writeFileSync(path.join(bare, "build-manifest.json"), JSON.stringify({ source: {} }));
  try {
    assert.throws(() => assertPostgresMajor(none), /no build-manifest\.json/);
    assert.throws(() => assertPostgresMajor(bare), /has no source\.version/);
  } finally {
    fs.rmSync(none, { recursive: true, force: true });
    fs.rmSync(bare, { recursive: true, force: true });
  }
});

test("--check fails the bundle gate on a Postgres 16 stage and passes on 18", () => {
  const old = tree(WIN, "16.15");
  const good = tree(WIN, "18.6");
  try {
    const bad = spawnSync(process.execPath, [SCRIPT, "--check", old], { encoding: "utf8" });
    assert.notEqual(bad.status, 0);
    assert.match(bad.stderr, /is major 16/);
    const ok = spawnSync(process.execPath, [SCRIPT, "--check", good], { encoding: "utf8" });
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /Postgres 18\.6 is major 18/);
  } finally {
    fs.rmSync(old, { recursive: true, force: true });
    fs.rmSync(good, { recursive: true, force: true });
  }
});

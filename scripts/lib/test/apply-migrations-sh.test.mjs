// apply-migrations-oci.sh must refuse to replay the base schema over a live
// database (as apply-migrations-oci.mjs does) and apply each file atomically.
// psql is replaced by a fake that logs its arguments and answers the
// populated-check query with FAKE_STATS ("tables|rows").
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..");
// On Windows `bash` on PATH is usually WSL, which cannot see these paths.
const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash";
const hasBash = spawnSync(bash, ["-c", "true"]).status === 0;

function run(stats, args = []) {
  const bin = mkdtempSync(path.join(os.tmpdir(), "fakepsql-"));
  const log = path.join(bin, "args.log").replace(/\\/g, "/");
  writeFileSync(
    path.join(bin, "psql"),
    `#!/usr/bin/env bash\necho "$*" >> "${log}"\n` +
      `for a in "$@"; do [ "$a" = "-tAc" ] && { echo "$FAKE_STATS"; exit 0; }; done\nexit 0\n`,
  );
  chmodSync(path.join(bin, "psql"), 0o755);
  const r = spawnSync(bash, ["scripts/apply-migrations-oci.sh", ...args], {
    cwd: root,
    env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, DATABASE_URL: "postgres://x@127.0.0.1/x", FAKE_STATS: stats },
    encoding: "utf8",
  });
  const calls = existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : [];
  return { status: r.status, stderr: r.stderr, files: calls.filter(c => / -f /.test(c)) };
}

test("refuses to apply anything over a database that has rows", { skip: !hasBash }, () => {
  const r = run("5|10");
  assert.notEqual(r.status, 0, "script exited 0 over a non-empty database");
  assert.match(r.stderr, /Refusing/);
  assert.deepEqual(r.files, []);
});

test("--follow-ups-only over a populated database applies only the self-hosted files", { skip: !hasBash }, () => {
  const r = run("5|10", ["--follow-ups-only"]);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.files.length > 0, "applied no follow-ups");
  assert.ok(r.files.every(c => c.includes("migrations-self-hosted-postgres/")), r.files.join("\n"));
});

test("an empty database gets the base migrations, each file in one transaction", { skip: !hasBash }, () => {
  const r = run("0|0");
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.files.some(c => /db\/migrations\/\S+\.sql/.test(c)), "applied no base migrations");
  for (const c of r.files) assert.match(c, /(^| )-1 /, c);
});

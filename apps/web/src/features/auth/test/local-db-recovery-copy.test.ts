/**
 * The privacy gate tells the user where local database backups live and what
 * "Starting fresh" leaves behind. Each folder or file name it quotes must be the
 * one the desktop shell's Rust actually creates, or the copy lies about the disk.
 *
 * The gate must not name a workspace backup folder: the shell writes backups
 * only to `<data>/local-db-backups` (apps/shell/src/lib.rs), never under
 * `.weaveforge/`.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// src/features/auth/test -> six levels up is the repository root.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

const gate = read("apps/web/src/features/auth/ui/privacy-disclaimer-gate.tsx");
const shell = {
  host: read("apps/shell/src/local_pg/host.rs"),
  lib: read("apps/shell/src/lib.rs"),
  restore: read("apps/shell/src/local_pg/restore.rs"),
};

test("the 'Starting fresh' folder prefix in the gate is the one host.rs renames to", () => {
  const prefix = "local-pg.discarded-";
  assert.ok(gate.includes(prefix), `gate copy no longer names ${prefix}`);
  assert.ok(shell.host.includes(`{name}.discarded-{stamp}`), "host.rs no longer builds the discarded name");
  assert.ok(shell.host.includes('"local-pg".to_owned()'), "host.rs default root name is no longer local-pg");
});

test("the backup folder the gate names is the one lib.rs wires into the backup set", () => {
  const dir = "local-db-backups";
  assert.ok(gate.includes(dir), `gate copy no longer names ${dir}`);
  assert.ok(shell.lib.includes(`data.join("${dir}")`), `lib.rs no longer backs up into ${dir}`);
});

test("the gate's automatic restore is the newest-first restore in host.rs and restore.rs", () => {
  assert.match(gate, /restores the newest one by\s+itself/, "gate copy changed");
  assert.ok(shell.host.includes("restore_newest_good("), "host.rs no longer restores on open");
  assert.ok(shell.restore.includes("pub async fn restore_newest_good"), "restore.rs no longer defines the restore");
});

test("the gate names no workspace backup folder the shell never writes", () => {
  assert.ok(!gate.includes(".weaveforge/db-backups"), "gate names .weaveforge/db-backups, which nothing creates");
});

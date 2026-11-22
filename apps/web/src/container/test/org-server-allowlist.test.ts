import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ORG_SERVER_RPCS, ORG_SERVER_TABLES } from "../org-server-allowlist";

/** Personal tables 0165 archives. `projects` and `user_settings` stay live until 0167 and are allowed. */
const PERSONAL = ["papers", "notes", "tags", "paper_tags", "metrics", "relations", "pins", "reading_lists", "citation_alerts"];

/** Personal sync and sharing names that must never reach the org server allowlist. */
const PERSONAL_SYNC = [
  "sync_outbox",
  "sync_state",
  "sync_conflicts",
  "sync_pull_held",
  "sync_backfill",
  "sync_shared_rows",
  "sync_writable_columns",
  "sync_seq",
  "sync_changes",
  "shared_items",
  "project_shares",
];

const MIGRATIONS = fileURLToPath(new URL("../../../../../db/migrations", import.meta.url));
const migrationSql = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql"))
  .map((f) => readFileSync(path.join(MIGRATIONS, f), "utf8").toLowerCase())
  .join("\n");

describe("org server allowlist", () => {
  it("excludes every personal table", () => {
    for (const t of PERSONAL) assert.equal((ORG_SERVER_TABLES as readonly string[]).includes(t), false, t);
  });
  it("includes the share and org tables", () => {
    for (const t of ["organizations", "org_memberships", "share_links"]) {
      assert.equal((ORG_SERVER_TABLES as readonly string[]).includes(t), true, t);
    }
  });
  it("lists only org and share rpcs", () => {
    assert.equal((ORG_SERVER_RPCS as readonly string[]).includes("resolve_share_link"), true);
    assert.equal((ORG_SERVER_RPCS as readonly string[]).includes("latest_metric_activity"), false);
  });
  it("lists no personal sync or sharing names", () => {
    for (const name of PERSONAL_SYNC) {
      assert.equal((ORG_SERVER_TABLES as readonly string[]).includes(name), false, `${name} is a table entry`);
      assert.equal((ORG_SERVER_RPCS as readonly string[]).includes(name), false, `${name} is an rpc entry`);
    }
  });
  it("every table is created as a table in db/migrations", () => {
    for (const table of ORG_SERVER_TABLES) {
      const created = new RegExp(`create table( if not exists)? (public\\.)?${table}\\b`);
      assert.match(migrationSql, created, `${table} has no create table`);
    }
  });
  it("every rpc is created as a function in db/migrations", () => {
    for (const rpc of ORG_SERVER_RPCS) {
      const created = new RegExp(`create (or replace )?function (public\\.)?${rpc}\\b`);
      assert.match(migrationSql, created, `${rpc} has no create function`);
    }
  });
});

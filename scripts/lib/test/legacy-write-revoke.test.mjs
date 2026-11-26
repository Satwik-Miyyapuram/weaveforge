// Static checks for db/held/0163 and its rollback. No database is needed:
// the forward migration must record exactly the direct write grants it removes
// (to authenticated and to PUBLIC), and the rollback must restore only those rows,
// then drop the record table.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const forward = readFileSync(join(root, "db/held/0163_legacy_write_revoke.sql"), "utf8");
const rollback = readFileSync(join(root, "db/held/0163_legacy_write_revoke.rollback.sql"), "utf8");

test("forward 0163 records direct grants only, read from the table ACL", () => {
  assert.match(forward, /create table if not exists public\.legacy_write_grants_0163/);
  assert.match(forward, /grantee text not null/);
  assert.match(forward, /aclexplode\(c\.relacl\)/);
  assert.doesNotMatch(forward, /has_table_privilege/, "inherited privileges must not be recorded");
  assert.match(forward, /on conflict do nothing/);
});

test("forward 0163 records before it revokes, from PUBLIC and authenticated", () => {
  const recordAt = forward.indexOf("insert into public.legacy_write_grants_0163");
  const revokeAt = forward.indexOf("revoke insert, update, delete on public.%I from public, authenticated");
  assert.ok(recordAt > 0 && revokeAt > recordAt, "record must precede revoke");
  assert.match(forward, /array\['authenticated', 'public'\]/);
});

test("forward 0163 keeps the record table closed to API roles", () => {
  assert.match(forward, /revoke all on public\.legacy_write_grants_0163 from public, anon, authenticated/);
});

test("forward 0163 names the RPCs it keeps and why, and requires SDK_INBOX first", () => {
  for (const fn of ["compact_crdt_log", "set_comment_resolved", "experiment_metric_name_id"]) {
    assert.match(forward.slice(0, forward.indexOf("create table")), new RegExp(fn), `${fn} must be named in the header`);
  }
  assert.match(forward, /regex/i, "header must say the caller scan is regex-only");
  assert.match(forward, /SDK_INBOX=1/, "header must require the inbox on first");
  assert.doesNotMatch(forward, /revoke execute/i, "kept RPCs must not be revoked here");
});

test("rollback regrants only recorded grants, to PUBLIC or authenticated, and drops the record table", () => {
  assert.match(rollback, /for r in select grantee, table_name, privilege from public\.legacy_write_grants_0163/);
  assert.match(rollback, /'public'/);
  assert.match(rollback, /grant %s on public\.%I to %s/);
  assert.match(rollback, /drop table public\.legacy_write_grants_0163/);
});

test("rollback holds no hard-coded table list or blanket insert/update/delete grant", () => {
  assert.doesNotMatch(rollback, /grant insert, update, delete/);
  assert.doesNotMatch(rollback, /'lab_snapshots'|'ai_audit_records'/);
});

test("forward 0163 leaves the deliberately writable tables out of its list", () => {
  for (const kept of ["blob_objects", "overleaf_connections", "ai_mcp_relay_requests", "profiles", "organizations", "org_memberships", "api_tokens"]) {
    assert.doesNotMatch(forward, new RegExp(`'${kept}'`), `${kept} must stay writable`);
  }
});

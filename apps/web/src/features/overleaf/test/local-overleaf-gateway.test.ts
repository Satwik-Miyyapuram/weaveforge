/**
 * The Overleaf link with no account and no API route.
 *
 * The rules about what may go in a row are shared with the route and tested
 * with it. What is only true here is the statement building: a partial edit
 * must touch only the columns it named — the bug this replaces would have been
 * a title save quietly wiping the section targets a panel had just set.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { LOCAL_USER_ID } from "@weaveforge/core";
import { LocalOverleafGateway } from "../infrastructure/local-overleaf-gateway";

function recorder() {
  const calls: { sql: string; params: unknown[] }[] = [];
  const run = {
    query: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      return [];
    },
    exec: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
    },
  };
  return { calls, gateway: new LocalOverleafGateway(run as never) };
}

/** The first statement run, asserted to exist rather than indexed blindly. */
function first(calls: { sql: string; params: unknown[] }[]) {
  const call = calls[0];
  assert.ok(call, "expected a statement to have been run");
  return call;
}

test("gateway: a title edit writes the title and nothing else", async () => {
  const { calls, gateway } = recorder();
  await gateway.patchReport({ id: "r1", title: "MSc thesis" });
  const { sql, params } = first(calls);
  assert.match(sql, /set title = \$1, updated_at = now\(\)/);
  assert.ok(!sql.includes("section_targets"), sql);
  assert.deepEqual(params, ["MSc thesis", "r1"]);
});

test("gateway: re-pointing a link clears the recorded failure with it", async () => {
  const { calls, gateway } = recorder();
  await gateway.patchReport({ id: "r1", overleafProjectId: "654321" });
  const { sql, params } = first(calls);
  assert.ok(sql.includes("last_error = null"), sql);
  assert.ok(params.includes("https://www.overleaf.com/project/654321"), JSON.stringify(params));
});

test("gateway: an Overleaf id that could reshape a clone URL is refused", async () => {
  const { calls, gateway } = recorder();
  await assert.rejects(
    () => gateway.patchReport({ id: "r1", overleafProjectId: "../../etc" }),
    /invalid/,
  );
  assert.equal(calls.length, 0, "nothing may be written for a rejected id");
});

test("gateway: an edit that names nothing is a mistake, not an empty update", async () => {
  const { calls, gateway } = recorder();
  await assert.rejects(() => gateway.patchReport({ id: "r1" }), /Nothing to update/);
  assert.equal(calls.length, 0);
});

test("gateway: only this project's enabled links are listed", async () => {
  const { calls, gateway } = recorder();
  await gateway.listReports("p1");
  const { sql, params } = first(calls);
  assert.match(sql, /project_id = \$1/);
  assert.ok(sql.includes("enabled"), sql);
  assert.deepEqual(params, ["p1"]);
});

/*
 * A device that has adopted an account runs every query as that account
 * (the shell sets the claim), so a row written for the fixed local-only id
 * fails the row policies. Every statement must take the user from the claim.
 */
test("gateway: every statement takes the user from auth.uid(), never the fixed local id", async () => {
  const { calls } = recorder();
  const run = {
    query: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      return [{ id: "c1" }];
    },
    exec: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
    },
  };
  const gateway = new LocalOverleafGateway(run as never);
  const id = "0123456789abcdef01234567";
  await gateway.listReports("p1");
  await gateway.createReport({ projectId: "p1", connectionId: "c1", title: "T", overleafProjectId: id, entryFile: "main.tex" });
  await gateway.patchReport({ id: "r1", title: "T2" });
  await gateway.deleteReport("r1");
  assert.equal(calls.length, 4);
  for (const { sql, params } of calls) {
    assert.ok(sql.includes("auth.uid()"), sql);
    assert.ok(!params.includes(LOCAL_USER_ID), `${sql} ${JSON.stringify(params)}`);
  }
});

/*
 * One keychain token per machine (P2-3): a second link must reuse the first
 * connection row, so no row is left pointing at a token it no longer matches,
 * and the token is stored only once a row exists for it.
 */
function connectionsDb(options: { failInsert?: boolean } = {}) {
  const rows: { id: string; name: string; prefix: string }[] = [];
  const run = {
    query: async (sql: string, params: unknown[] = []) => {
      if (/^\s*select id from overleaf_connections/.test(sql)) return rows.slice(0, 1).map(({ id }) => ({ id }));
      if (/^\s*insert into overleaf_connections/.test(sql)) {
        if (options.failInsert) throw new Error("db down");
        const row = { id: `c${rows.length + 1}`, name: String(params[0]), prefix: String(params[2]) };
        rows.push(row);
        return [{ id: row.id }];
      }
      return [];
    },
    exec: async (sql: string, params: unknown[] = []) => {
      if (/^\s*update overleaf_connections/.test(sql)) {
        const row = rows.find((r) => r.id === params[2]);
        if (row) Object.assign(row, { name: String(params[0]), prefix: String(params[1]) });
      }
      if (/^\s*delete from overleaf_connections/.test(sql)) rows.splice(rows.findIndex((r) => r.id === params[0]), 1);
    },
  };
  return { rows, gateway: new LocalOverleafGateway(run as never) };
}

function withShell(failWrite = false): Record<string, string> {
  const secrets: Record<string, string> = {};
  (globalThis as { window?: unknown }).window = {
    weaveforge: {
      fetchTitle: () => undefined,
      writeSecret: async (key: string, value: string) => {
        if (failWrite) throw new Error("no keychain");
        secrets[key] = value;
      },
    },
  };
  return secrets;
}

test("gateway: a second link reuses the one connection and its prefix follows the token (P2-3)", async (t) => {
  t.after(() => { delete (globalThis as { window?: unknown }).window; });
  const secrets = withShell();
  const { rows, gateway } = connectionsDb();
  const a = await gateway.saveConnection("Overleaf", "olp_first");
  const b = await gateway.saveConnection("Overleaf 2", "abcd_second");
  assert.equal(b, a);
  assert.deepEqual(rows, [{ id: a, name: "Overleaf 2", prefix: "abcd" }]);
  assert.equal(secrets["overleaf-token"], "abcd_second");
});

test("gateway: a failed insert leaves the stored token alone (P2-3)", async (t) => {
  t.after(() => { delete (globalThis as { window?: unknown }).window; });
  const secrets = withShell();
  secrets["overleaf-token"] = "old";
  const { gateway } = connectionsDb({ failInsert: true });
  await assert.rejects(() => gateway.saveConnection("Overleaf", "new_token"), /db down/);
  assert.equal(secrets["overleaf-token"], "old");
});

test("gateway: a keychain failure leaves no connection row behind (P2-3)", async (t) => {
  t.after(() => { delete (globalThis as { window?: unknown }).window; });
  withShell(true);
  const { rows, gateway } = connectionsDb();
  await assert.rejects(() => gateway.saveConnection("Overleaf", "olp_first"), /no keychain/);
  assert.deepEqual(rows, []);
});
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

test("gateway: a title edit writes the title and nothing else", async () => {
  const { calls, gateway } = recorder();
  await gateway.patchReport({ id: "r1", title: "MSc thesis" });
  const [{ sql, params }] = calls;
  assert.match(sql, /set title = \$1, updated_at = now\(\)/);
  assert.ok(!sql.includes("section_targets"), sql);
  assert.deepEqual(params, ["MSc thesis", "r1", params[2]]);
});

test("gateway: re-pointing a link clears the recorded failure with it", async () => {
  const { calls, gateway } = recorder();
  await gateway.patchReport({ id: "r1", overleafProjectId: "654321" });
  const [{ sql, params }] = calls;
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
  const [{ sql, params }] = calls;
  assert.match(sql, /project_id = \$2/);
  assert.ok(sql.includes("enabled"), sql);
  assert.equal(params[1], "p1");
});

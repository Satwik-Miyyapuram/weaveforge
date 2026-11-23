/**
 * 0.9.8: the no-account Overleaf gateway refuses every operation with the
 * account-only copy, and reaches no LocalRunner or shell call.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LocalOverleafGateway, OVERLEAF_NEEDS_ACCOUNT } from "../infrastructure/local-overleaf-gateway";

const gateway = new LocalOverleafGateway();
const row = {
  id: "r1", project_id: "p1", title: "T", connection_id: "c1", overleaf_project_id: "654321",
  entry_file: "main.tex", external_url: null, last_fetched_at: null, section_targets: {},
};

test("gateway: every operation refuses with the needs-an-account copy", async () => {
  const calls = [
    () => gateway.listReports("p1"),
    () => gateway.patchReport({ id: "r1", title: "T2" }),
    () => gateway.deleteReport("r1"),
    () => gateway.readContent(row),
  ];
  assert.equal(calls.length, Object.getOwnPropertyNames(LocalOverleafGateway.prototype).length - 1, "one call per method");
  for (const call of calls) {
    await assert.rejects(call, (err: Error) => err.message === OVERLEAF_NEEDS_ACCOUNT);
  }
});

test("gateway: the module never imports LocalRunner or the desktop shell", () => {
  const source = readFileSync(new URL("../infrastructure/local-overleaf-gateway.ts", import.meta.url), "utf8");
  assert.equal(/LocalRunner|desktop-bridge|pglite/.test(source), false);
});

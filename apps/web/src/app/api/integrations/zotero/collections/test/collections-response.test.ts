import { test } from "node:test";
import assert from "node:assert/strict";
import { collectionsResponse } from "../collections-response";

const json = (value: unknown, status = 200) =>
  new Response(typeof value === "string" ? value : JSON.stringify(value), { status });

test("collections: keyed rows are listed and keyless ones dropped", async () => {
  const res = await collectionsResponse(json([{ data: { key: "A", name: "One" } }, { data: { name: "no key" } }, {}]));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { collections: [{ key: "A", name: "One" }] });
});

test("collections: a 401 from Zotero is passed on, other refusals are 502", async () => {
  assert.equal((await collectionsResponse(json({}, 401))).status, 401);
  assert.equal((await collectionsResponse(json({}, 500))).status, 502);
});

for (const [label, body] of [["bad JSON", "<html>"], ["an object", { error: "x" }], ["null", "null"], ["a null row", [null]]] as const) {
  test(`collections: ${label} is a logged 502 "unexpected response", not "unable to reach" (14-14)`, async (t) => {
    const warn = t.mock.method(console, "warn", () => {});
    const res = await collectionsResponse(json(body));
    assert.equal(res.status, 502);
    assert.match((await res.json()).error, /unexpected response/);
    assert.equal(warn.mock.callCount(), 1);
  });
}

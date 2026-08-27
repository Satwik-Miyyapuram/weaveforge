import assert from "node:assert/strict";
import test from "node:test";
import { fetchZoteroLocal, isLocalZoteroUrl } from "../src/zotero-local";

test("only the local Zotero API is a local Zotero URL", () => {
  assert.equal(isLocalZoteroUrl("http://127.0.0.1:23119/api/users/0/items"), true);
  assert.equal(isLocalZoteroUrl("http://127.0.0.1:23119/api"), true);
  // Another service on the same machine, and Zotero's non-API paths.
  assert.equal(isLocalZoteroUrl("http://127.0.0.1:23119/connector/ping"), false);
  assert.equal(isLocalZoteroUrl("http://127.0.0.1:5432/api/items"), false);
  assert.equal(isLocalZoteroUrl("http://localhost:23119/api/items"), false);
  assert.equal(isLocalZoteroUrl("https://127.0.0.1:23119/api/items"), false);
  assert.equal(isLocalZoteroUrl("http://user:pw@127.0.0.1:23119/api/items"), false);
  assert.equal(isLocalZoteroUrl("http://evil.example/api/items"), false);
  assert.equal(isLocalZoteroUrl("not a url"), false);
  assert.equal(isLocalZoteroUrl("http://127.0.0.1:23119/apifoo"), false);
});

test("a refused URL never reaches the network", async () => {
  let called = false;
  const fetchFn = (async () => {
    called = true;
    return new Response("");
  }) as unknown as typeof fetch;
  await assert.rejects(
    fetchZoteroLocal("http://evil.example/api/users/0/items", fetchFn),
    /Only the Zotero API on this computer/,
  );
  assert.equal(called, false);
});

test("a reply carries the status, the body and only the pager's headers", async () => {
  const fetchFn = (async () =>
    new Response("[]", {
      status: 200,
      headers: {
        "Total-Results": "40",
        "Content-Type": "application/json",
        "Set-Cookie": "session=secret",
      },
    })) as unknown as typeof fetch;
  const reply = await fetchZoteroLocal("http://127.0.0.1:23119/api/users/0/items", fetchFn);
  assert.equal(reply.status, 200);
  assert.equal(reply.body, "[]");
  assert.equal(reply.headers["total-results"], "40");
  assert.equal(reply.headers["set-cookie"], undefined);
});

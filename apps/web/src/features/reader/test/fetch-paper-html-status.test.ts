import assert from "node:assert/strict";
import test from "node:test";
import { fetchPaperHtml } from "../application/parts-2.js";

/**
 * The relay's answer for a page the site refused must reach the blocked branch.
 * The Rust relay maps an upstream 401/403/429/451 to a relayed 403, so the blocked
 * branch (403 or 400) is the one that fires; any other refusal is a failed fetch.
 */
const URL_ = "https://blog.example/post";

function fakeRelay(status: number) {
  return async () => new Response("", { status, headers: { "content-type": "text/plain" } });
}

const noToken = async () => "token";

test("a relayed 403 (the site refused the page) is a blocked fetch, not a failure", async () => {
  assert.deepEqual(await fetchPaperHtml(URL_, fakeRelay(403) as typeof fetch, noToken), {
    ok: false,
    reason: "blocked",
    status: 403,
  });
});

test("a relayed 400 (address the relay will not dial) is also blocked", async () => {
  assert.deepEqual(await fetchPaperHtml(URL_, fakeRelay(400) as typeof fetch, noToken), {
    ok: false,
    reason: "blocked",
    status: 400,
  });
});

test("a relayed 502 (upstream failed) stays a failed fetch", async () => {
  assert.deepEqual(await fetchPaperHtml(URL_, fakeRelay(502) as typeof fetch, noToken), {
    ok: false,
    reason: "failed",
    status: 502,
  });
});

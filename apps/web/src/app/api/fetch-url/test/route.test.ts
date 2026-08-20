import { test } from "node:test";
import assert from "node:assert/strict";
import { GET } from "../route";

/**
 * The route is auth and shaping; what may be fetched is decided in
 * `backend/net/fetch-for-paste`, which is tested there without a session. These
 * cover the parameter and authentication gates, which are what a request that
 * never reaches the fetch has to pass.
 */

const url = (target: string, as = "title") =>
  `http://localhost/api/fetch-url?as=${as}&url=${encodeURIComponent(target)}`;

/** Records anything that tries to leave, so a refusal can be shown to be early. */
function watchFetch() {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = ((input: string | URL | Request) => {
    calls.push(String(input));
    return Promise.resolve(new Response("should not happen", { status: 500 }));
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

test("fetch-url: a missing url is a 400", async () => {
  const res = await GET(new Request("http://localhost/api/fetch-url"));
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /url is required/);
});

test("fetch-url: an unknown mode is a 400", async () => {
  const res = await GET(new Request(url("https://example.com/", "video")));
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /title or image/);
});

test("fetch-url: no bearer token is a 401, and nothing is requested", async () => {
  // An unauthenticated version of this route is a scanning service anybody on
  // the internet can point at anything.
  const watch = watchFetch();
  try {
    const res = await GET(new Request(url("https://example.com/")));
    assert.equal(res.status, 401);
    assert.deepEqual(watch.calls, []);
  } finally {
    watch.restore();
  }
});

test("fetch-url: a token that does not check out is a 401, not a fetch", async () => {
  const watch = watchFetch();
  try {
    const res = await GET(
      new Request(url("https://example.com/"), { headers: { authorization: "Bearer nonsense" } }),
    );
    assert.equal(res.status, 401);
    // Whatever the auth check did, the target was never requested.
    assert.ok(watch.calls.every((call) => !call.includes("example.com")));
  } finally {
    watch.restore();
  }
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { GET } from "../route";
import { stubFetch, stubOutboundFetch } from "@/lib/test/stub-fetch";

/**
 * The route is auth and shaping; what may be fetched is decided in
 * `backend/net/fetch-for-paste`, which is tested there without a session. These
 * cover the parameter and authentication gates, which are what a request that
 * never reaches the fetch has to pass.
 */

const url = (target: string, as = "title") =>
  `http://localhost/api/fetch-url?as=${as}&url=${encodeURIComponent(target)}`;

/**
 * Records anything that tries to leave, so a refusal can be shown to be early.
 *
 * On the outbound transport rather than on `globalThis.fetch`: the fetch path no
 * longer calls `fetch`, so a stub there would record nothing and every "nothing
 * was requested" assertion would pass for the wrong reason.
 */
function watchFetch() {
  const stub = stubOutboundFetch(() => new Response("should not happen", { status: 500 }));
  return {
    calls: stub.calls.map((call) => call.url),
    restore: stub.restore,
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

// --- the image amplifier (SEC-06) -------------------------------------------
//
// The route requires a token, which decides *who* may ask; a caller with one
// could still ask repeatedly, spending this server's memory and somebody else's
// bandwidth at their own rate. The budget is what bounds that, and it is
// deliberately on the image half only: a title is a lookup and a few hundred
// bytes.

/** A signed-in caller, and a backend that says yes to the token. */
async function withAuthenticatedUser<T>(fn: (headers: Record<string, string>) => Promise<T>) {
  const keys = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_JWT_SECRET",
  ];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://stub.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
  process.env.SUPABASE_JWT_SECRET = "secret";

  const stub = stubFetch((target) => {
    if (target.includes("/auth/v1/user")) return Response.json({ id: "00000000-0000-0000-0000-000000000009" });
    if (target.includes("/rest/v1/rpc/")) return Response.json(["sdk"]);
    return Response.json({});
  });
  try {
    // A JWT-shaped token, so the shape test passes and Supabase is asked.
    return await fn({ authorization: `Bearer aaa.bbb.ccc` });
  } finally {
    stub.restore();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("fetch-url: image fetches are budgeted per caller", async () => {
  await withAuthenticatedUser(async (headers) => {
    const outbound = stubOutboundFetch(() => new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } }));
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 21; i += 1) {
        const res = await GET(new Request(url("https://example.com/figure.png", "image"), { headers }));
        statuses.push(res.status);
        if (res.status === 429) {
          assert.match((await res.json()).error, /Too many image fetches/);
          assert.ok(Number(res.headers.get("retry-after")) >= 1, "and says when to come back");
        }
      }

      assert.deepEqual(
        statuses.slice(0, 20),
        Array(20).fill(200),
        "a burst of twenty gets through — that is somebody pasting figures",
      );
      assert.equal(statuses[20], 429, "and the twenty-first does not");
      assert.equal(outbound.calls.length, 20, "a refused request never leaves");
    } finally {
      outbound.restore();
    }
  });
});

test("fetch-url: titles are not budgeted with images", async () => {
  // The limit is on the expensive half. A title costs a lookup and a few hundred
  // bytes, and counting them together would refuse a paste of a page of links.
  await withAuthenticatedUser(async (headers) => {
    const outbound = stubOutboundFetch(
      () => new Response("<html><head><title>Paper</title></head></html>", { headers: { "content-type": "text/html" } }),
    );
    try {
      const first = await GET(new Request(url("https://example.com/paper"), { headers }));
      assert.equal(first.status, 200);
    } finally {
      outbound.restore();
    }
  });
});

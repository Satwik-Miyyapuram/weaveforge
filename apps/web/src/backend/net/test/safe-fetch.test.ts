import { test } from "node:test";
import assert from "node:assert/strict";
import { safeFetch, checkUrlReachable } from "../safe-fetch";

/**
 * What the guard has to stop.
 *
 * The dangerous cases are the ones where the URL looks fine and the *address*
 * does not: a name that resolves to loopback, and a redirect from a public page
 * to the cloud metadata endpoint. Both are tested by injecting the resolver, so
 * the suite needs no network and no DNS.
 */

/** A resolver that answers from a table, and refuses anything not in it. */
function resolver(table: Record<string, string[]>) {
  return async (hostname: string): Promise<string[]> => {
    const answer = table[hostname];
    if (!answer) throw new Error(`no such host: ${hostname}`);
    return answer;
  };
}

const publicResolver = resolver({
  "example.com": ["93.184.216.34"],
  "cdn.example.com": ["93.184.216.34"],
  "evil.example": ["127.0.0.1"],
  "split.example": ["93.184.216.34", "10.0.0.5"],
});

/** Replaces global fetch for one test and records what it was asked for. */
function stubFetch(handler: (url: string) => Response) {
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request) => {
    calls.push(String(input));
    return Promise.resolve(handler(String(input)));
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

test("a name that resolves to loopback is refused, and never requested", async () => {
  // The whole attack: the URL is a perfectly ordinary public-looking name.
  const stub = stubFetch(() => new Response("should not happen"));
  try {
    const result = await safeFetch("https://evil.example/x", { resolve: publicResolver });
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.status, 400);
    assert.match(result.ok === false ? result.message : "", /private network/);
    assert.deepEqual(stub.calls, []);
  } finally {
    stub.restore();
  }
});

test("a name with one private answer among several is refused", async () => {
  // An attacker controls the DNS reply, so "one of them was public" says
  // nothing about which address a later connection will use.
  const result = await safeFetch("https://split.example/x", { resolve: publicResolver });
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.status, 400);
});

test("a redirect to a private address is refused, not followed", async () => {
  const stub = stubFetch((url) =>
    url.startsWith("https://example.com")
      ? new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" } })
      : new Response("instance credentials"),
  );
  try {
    const result = await safeFetch("https://example.com/start", { resolve: publicResolver });
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.status, 400);
    // The first hop was requested; the metadata endpoint never was.
    assert.equal(stub.calls.length, 1);
    assert.match(stub.calls[0]!, /example\.com/);
  } finally {
    stub.restore();
  }
});

test("a redirect to another public address is followed and reported", async () => {
  const stub = stubFetch((url) =>
    url.startsWith("https://example.com")
      ? new Response(null, { status: 301, headers: { location: "https://cdn.example.com/final" } })
      : new Response("body", { headers: { "content-type": "text/html" } }),
  );
  try {
    const result = await safeFetch("https://example.com/start", { resolve: publicResolver });
    assert.equal(result.ok, true);
    assert.equal(result.ok === true && result.url, "https://cdn.example.com/final");
    assert.equal(result.ok === true && new TextDecoder().decode(result.body), "body");
  } finally {
    stub.restore();
  }
});

test("a redirect loop stops at the budget", async () => {
  const stub = stubFetch(
    () => new Response(null, { status: 302, headers: { location: "https://example.com/again" } }),
  );
  try {
    const result = await safeFetch("https://example.com/start", {
      resolve: publicResolver,
      maxRedirects: 2,
    });
    assert.equal(result.ok, false);
    assert.match(result.ok === false ? result.message : "", /too many times/);
    assert.equal(stub.calls.length, 3);
  } finally {
    stub.restore();
  }
});

test("a body over the cap is abandoned rather than buffered", async () => {
  const stub = stubFetch(() => new Response(new Uint8Array(4096)));
  try {
    const result = await safeFetch("https://example.com/big", {
      resolve: publicResolver,
      maxBytes: 1024,
    });
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.status, 413);
  } finally {
    stub.restore();
  }
});

test("a declared content-length over the cap is refused before reading", async () => {
  const stub = stubFetch(
    () => new Response("x", { headers: { "content-length": String(50 * 1024 * 1024) } }),
  );
  try {
    const result = await safeFetch("https://example.com/big", {
      resolve: publicResolver,
      maxBytes: 1024,
    });
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.status, 413);
  } finally {
    stub.restore();
  }
});

test("a literal private address never reaches DNS at all", async () => {
  let asked = false;
  const result = await safeFetch("http://169.254.169.254/latest/meta-data/", {
    resolve: async () => {
      asked = true;
      return ["1.2.3.4"];
    },
  });
  assert.equal(result.ok, false);
  assert.equal(asked, false);
});

test("a host that does not resolve is a 502, not a crash", async () => {
  const result = await safeFetch("https://nowhere.example/x", { resolve: publicResolver });
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.status, 502);
});

test("an upstream error keeps its status and explains itself", async () => {
  const stub = stubFetch(() => new Response("nope", { status: 403 }));
  try {
    const result = await safeFetch("https://example.com/x", { resolve: publicResolver });
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.status, 403);
    assert.match(result.ok === false ? result.message : "", /blocked automated access/);
  } finally {
    stub.restore();
  }
});

test("checkUrlReachable answers for a URL on its own", async () => {
  assert.equal((await checkUrlReachable(new URL("https://example.com/"), publicResolver)).ok, true);
  assert.equal((await checkUrlReachable(new URL("https://evil.example/"), publicResolver)).ok, false);
  assert.equal((await checkUrlReachable(new URL("http://localhost/"), publicResolver)).ok, false);
});

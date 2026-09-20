import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { safeFetch, checkUrlReachable, pinnedRequest } from "../safe-fetch";
import { stubOutboundFetch as stubFetch } from "@/lib/test/stub-fetch";

/**
 * What the guard has to stop.
 *
 * The dangerous cases are the ones where the URL looks fine and the *address*
 * does not: a name that resolves to loopback, and a redirect from a public page
 * to the cloud metadata endpoint. Both are tested by injecting the resolver, so
 * the suite needs no network and no DNS.
 *
 * The other half is the connect: the guard's check is worthless if the request
 * resolves the name again. `stubOutboundFetch` hands each test the address that
 * was pinned, so the pinning is an assertion rather than a promise in a comment.
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
    assert.match(stub.calls[0]!.url, /example\.com/);
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
  );  try {
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

test("a body larger than the first buffer is read back byte for byte", async () => {
  // The buffer grows as the body arrives, copying what it already has. That copy
  // is the part a cap test cannot see: a body of a few hundred bytes never
  // crosses the growth boundary, and an off-by-one there would corrupt every
  // figure over 64 KB rather than refusing it. The chunks are uneven on purpose,
  // so a growth landing mid-chunk is exercised.
  // The chunks are uneven on purpose, so a growth landing mid-chunk is
  // exercised, and their total is the body's size.
  const chunks = [1, 1000, 64 * 1024 - 3, 17, 64 * 1024, 40_000];
  const payload = new Uint8Array(chunks.reduce((total, size) => total + size, 0));
  for (let index = 0; index < payload.length; index += 1) payload[index] = index % 251;

  let offset = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const size = chunks.shift();
      if (size === undefined) {
        controller.close();
        return;
      }
      controller.enqueue(payload.subarray(offset, offset + size));
      offset += size;
    },
  });

  const stub = stubFetch(() => new Response(body));
  try {
    const result = await safeFetch("https://example.com/figure.png", {
      resolve: publicResolver,
      maxBytes: 1024 * 1024,
    });
    assert.equal(result.ok, true);
    if (result.ok !== true) return;
    assert.equal(result.body.byteLength, payload.byteLength);
    assert.deepEqual([...result.body], [...payload]);
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

// --- the connect (SEC-05 / WF-B09) ------------------------------------------
//
// The guard's whole contract is that a name is resolved, every address it
// answered with is checked, and the *checked address* is what the request goes
// to. Checking and then handing the name to `fetch` leaves a second DNS answer
// in between, which is DNS rebinding: a public address when the guard looks,
// 169.254.169.254 when the socket connects.

test("the address that was checked is the address dialled", async () => {
  // The attack in one test: the name answers publicly the first time and
  // privately for every lookup after.
  let lookups = 0;
  const flipping = async (): Promise<string[]> => {
    lookups += 1;
    return lookups === 1 ? ["93.184.216.34"] : ["169.254.169.254"];
  };

  const stub = stubFetch(() => new Response("hello"));
  try {
    const result = await safeFetch("http://rebind.example/page", { resolve: flipping });

    assert.equal(result.ok, true);
    assert.equal(lookups, 1, "resolved once — there is no second answer to subvert");
    assert.deepEqual(
      stub.calls,
      [{ url: "http://rebind.example/page", address: "93.184.216.34" }],
      "and the request went to the address the guard approved",
    );
  } finally {
    stub.restore();
  }
});

test("every redirect hop is checked and pinned again", async () => {
  // A redirect is a second URL the visitor never showed you, so it gets its own
  // resolution, its own check and its own pin.
  const asked: string[] = [];
  const stub = stubFetch(
    (url) =>
      new Response(null, {
        status: 302,
        headers: { location: url.includes("start") ? "http://second.example/final" : "" },
      }),
  );
  try {
    await safeFetch("http://first.example/start", {
      resolve: async (hostname) => {
        asked.push(hostname);
        return [hostname === "first.example" ? "93.184.216.34" : "93.184.216.35"];
      },
    });

    assert.deepEqual(asked, ["first.example", "second.example"]);
    assert.deepEqual(
      stub.calls.map((call) => call.address),
      ["93.184.216.34", "93.184.216.35"],
      "each hop dialled the address resolved for that hop",
    );
  } finally {
    stub.restore();
  }
});

test("pinnedRequest dials the address and names the host", async () => {
  // The one piece a stub cannot prove: that the socket goes to the vetted IP
  // while the server still sees the name it was asked for. A loopback server is
  // enough — this is the transport, not the policy, and the policy is what
  // refuses private addresses.
  let seenHost: string | undefined;
  let seenUrl: string | undefined;
  const server = createServer((req, res) => {
    seenHost = req.headers.host;
    seenUrl = req.url;
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("pinned");
  });
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const port = (server.address() as AddressInfo).port;

  try {
    const response = await pinnedRequest({
      url: new URL(`http://example.test:${port}/page?q=1`),
      address: "127.0.0.1",
      family: 4,
      headers: { Accept: "*/*" },
      timeoutMs: 2000,
    });

    assert.equal(response.status, 200);
    assert.equal(await response.text(), "pinned");
    assert.equal(seenHost, `example.test:${port}`, "the Host header carries the name");
    assert.equal(seenUrl, "/page?q=1", "and the path and query are untouched");
  } finally {
    await new Promise<void>((closed) => server.close(() => closed()));
  }
});

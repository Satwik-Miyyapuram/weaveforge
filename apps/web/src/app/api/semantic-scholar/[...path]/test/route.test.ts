import { test } from "node:test";
import assert from "node:assert/strict";
import { GET, POST } from "../route";
import { relaySemanticScholar, SEMANTIC_SCHOLAR_RELAY_PREFIX } from "../../_relay";
import { stubFetch } from "@/lib/test/stub-fetch";

/**
 * The web relay: the API is reached from the server, the upstream is pinned,
 * and a throttled answer is retried before the page ever sees it.
 */

const noWait = () => Promise.resolve();

function relayRequest(path: string, init?: RequestInit): Request {
  return new Request(`http://localhost${SEMANTIC_SCHOLAR_RELAY_PREFIX}${path}`, init);
}

test("semantic-scholar: both verbs require authentication", async () => {
  assert.equal((await GET(relayRequest("graph/v1/paper/x"))).status, 401);
  assert.equal(
    (await POST(relayRequest("graph/v1/paper/batch", { method: "POST", body: "{}" }))).status,
    401,
  );
});

test("semantic-scholar: forwards to the pinned upstream and returns its body", async () => {
  const seen: string[] = [];
  const { restore } = stubFetch((url) => {
    seen.push(url);
    return new Response(JSON.stringify({ title: "A paper" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  try {
    const res = await relaySemanticScholar(
      relayRequest("graph/v1/paper/arXiv:1509.00519?fields=title"),
      undefined,
      noWait,
    );
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { title: "A paper" });
    assert.deepEqual(seen, ["https://api.semanticscholar.org/graph/v1/paper/arXiv:1509.00519?fields=title"]);
  } finally {
    restore();
  }
});

test("semantic-scholar: the caller's api key travels, a session does not", async () => {
  let sent: Record<string, string> = {};
  const { restore } = stubFetch((_url, init) => {
    sent = (init?.headers ?? {}) as Record<string, string>;
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  });
  try {
    await relaySemanticScholar(
      relayRequest("graph/v1/paper/x", {
        headers: {
          "x-api-key": "key-1",
          cookie: "session=abc",
          authorization: "Bearer secret",
          referer: "http://localhost/reader",
        },
      }),
      undefined,
      noWait,
    );
    assert.equal(sent["x-api-key"], "key-1");
    assert.equal(sent.cookie, undefined);
    assert.equal(sent.authorization, undefined);
    assert.equal(sent.referer, undefined);
  } finally {
    restore();
  }
});

test("semantic-scholar: a 429 is retried before the page hears about it", async () => {
  let calls = 0;
  const { restore } = stubFetch(() => {
    calls += 1;
    return calls < 3
      ? new Response("{}", { status: 429 })
      : new Response('{"ok":true}', { status: 200, headers: { "content-type": "application/json" } });
  });
  try {
    const res = await relaySemanticScholar(relayRequest("graph/v1/paper/x"), undefined, noWait);
    assert.equal(res.status, 200);
    assert.equal(calls, 3);
  } finally {
    restore();
  }
});

test("semantic-scholar: a 429 that never clears is passed through, not hidden", async () => {
  let calls = 0;
  const { restore } = stubFetch(() => {
    calls += 1;
    return new Response('{"error":"rate limited"}', { status: 429 });
  });
  try {
    const res = await relaySemanticScholar(relayRequest("graph/v1/paper/x"), undefined, noWait);
    assert.equal(res.status, 429);
    // 1 attempt + 3 retries.
    assert.equal(calls, 4);
  } finally {
    restore();
  }
});

test("semantic-scholar: refuses a traversal or an absolute target", async () => {
  let called = 0;
  const { restore } = stubFetch(() => {
    called += 1;
    return new Response("{}", { status: 200 });
  });
  try {
    for (const path of ["../etc", "/absolute", "https://evil.test/x"]) {
      const res = await relaySemanticScholar(relayRequest(path), undefined, noWait);
      assert.equal(res.status, 400, path);
    }
    assert.equal(called, 0, "nothing was fetched");
  } finally {
    restore();
  }
});

test("semantic-scholar: a POST body is forwarded", async () => {
  let body: unknown = null;
  let method = "";
  const { restore } = stubFetch((_url, init) => {
    body = init?.body;
    method = init?.method ?? "";
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  });
  try {
    const res = await relaySemanticScholar(
      relayRequest("graph/v1/paper/batch", { method: "POST", body: '{"ids":["a"]}' }),
      undefined,
      noWait,
    );
    assert.equal(res.status, 200);
    assert.equal(method, "POST");
    assert.equal(body, '{"ids":["a"]}');
  } finally {
    restore();
  }
});

test("semantic-scholar: the upstream's own CORS header is not copied through", async () => {
  const { restore } = stubFetch(
    () =>
      new Response("{}", {
        status: 200,
        headers: {
          "content-type": "application/json",
          "access-control-allow-origin": "*",
          location: "https://evil.test/",
        },
      }),
  );
  try {
    const res = await relaySemanticScholar(relayRequest("graph/v1/paper/x"), undefined, noWait);
    assert.equal(res.headers.get("access-control-allow-origin"), null);
    assert.equal(res.headers.get("location"), null);
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  } finally {
    restore();
  }
});

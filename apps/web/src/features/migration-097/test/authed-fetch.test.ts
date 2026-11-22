import { test } from "node:test";
import assert from "node:assert/strict";

import { authedFetch } from "../infrastructure/authed-fetch";

const BASE = "https://api.example.test/rest/v1";

function recorder() {
  const calls: { url: string; headers: Headers }[] = [];
  const inner = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    // Mirror fetch: an init headers object replaces the Request's headers, otherwise the Request's own are used.
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    calls.push({ url, headers });
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  return { calls, inner };
}

test("PostgREST calls carry the bearer token read at request time", async () => {
  const { calls, inner } = recorder();
  let token = "first";
  const fetchWithAuth = authedFetch(BASE, async () => token, inner);

  await fetchWithAuth(`${BASE}/papers?user_id=eq.u1`, { headers: { apikey: "anon" } });
  token = "refreshed";
  await fetchWithAuth(`${BASE}/papers?user_id=eq.u1`, { headers: { apikey: "anon" } });

  const [first, second] = calls;
  assert.equal(first?.headers.get("authorization"), "Bearer first");
  assert.equal(second?.headers.get("authorization"), "Bearer refreshed");
  assert.equal(first?.headers.get("apikey"), "anon", "caller headers are kept");
});

test("a signed blob URL outside the API base gets no Authorization header", async () => {
  const { calls, inner } = recorder();
  const fetchWithAuth = authedFetch(BASE, async () => "secret", inner);

  await fetchWithAuth("https://storage.example.test/object/sign/blobs/a.bin?token=abc");

  assert.equal(calls[0]?.headers.get("authorization"), null);
});

test("no session means no Authorization header, and the request still goes out", async () => {
  const { calls, inner } = recorder();
  const fetchWithAuth = authedFetch(BASE, async () => null, inner);

  await fetchWithAuth(`${BASE}/papers`);

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.headers.get("authorization"), null);
});

test("a host that only starts with the API base string gets no bearer token", async () => {
  const { calls, inner } = recorder();
  const fetchWithAuth = authedFetch(BASE, async () => "secret", inner);

  await fetchWithAuth("https://api.example.test/rest/v1.evil/papers");
  await fetchWithAuth("https://api.example.test/rest/v1evil/papers");

  assert.equal(calls[0]?.headers.get("authorization"), null, "'.evil' is another path, not the API");
  assert.equal(calls[1]?.headers.get("authorization"), null, "'evil' glued on is another path, not the API");
});

test("the exact base, base + '/' and base + '?' all get the bearer token", async () => {
  const { calls, inner } = recorder();
  const fetchWithAuth = authedFetch(BASE, async () => "secret", inner);

  await fetchWithAuth(BASE);
  await fetchWithAuth(`${BASE}/papers`);
  await fetchWithAuth(`${BASE}?select=id`);

  for (const call of calls) {
    assert.equal(call.headers.get("authorization"), "Bearer secret", call.url);
  }
});

test("a Request with no init keeps the Request's own headers and adds the bearer token", async () => {
  const { calls, inner } = recorder();
  const fetchWithAuth = authedFetch(BASE, async () => "secret", inner);

  await fetchWithAuth(new Request(`${BASE}/papers`, { headers: { apikey: "anon" } }));

  assert.equal(calls[0]?.headers.get("apikey"), "anon", "the Request's apikey survives");
  assert.equal(calls[0]?.headers.get("authorization"), "Bearer secret");
});

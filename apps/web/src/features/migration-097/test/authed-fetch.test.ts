import { test } from "node:test";
import assert from "node:assert/strict";

import { authedFetch } from "../infrastructure/authed-fetch";

const BASE = "https://api.example.test/rest/v1";

function recorder() {
  const calls: { url: string; headers: Headers }[] = [];
  const inner = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), headers: new Headers(init?.headers) });
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

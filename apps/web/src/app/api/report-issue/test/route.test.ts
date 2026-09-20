import { test } from "node:test";
import assert from "node:assert/strict";

import { POST } from "../route";
import { fileIssue } from "@/lib/error-report/file-issue";
import { stubOutboundFetch } from "@/lib/test/stub-fetch";

/**
 * Filing a report: the gate, and the request that leaves.
 *
 * The route is authentication, redaction and shaping; the outbound call is
 * `fileIssue`, which is driven directly here so the interesting cases run without
 * a Supabase session — the same split `url-meta` uses. Every case below is
 * offline: a stub resolver for the DNS half and `stubOutboundFetch` for the
 * socket half, so nothing reaches api.github.com.
 */

function req(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/report-issue", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

/** The guard's DNS answer, so `checkUrlReachable` never resolves anything. */
const resolvesPublic = async () => ["140.82.121.6"];

test("report-issue: no credential is a 401, and nothing is sent", async () => {
  const outbound = stubOutboundFetch(() => new Response("should not happen", { status: 500 }));
  try {
    const response = await POST(req({ title: "Crash", detail: "It broke" }));

    assert.equal(response.status, 401);
    assert.deepEqual(outbound.calls, [], "an unauthenticated report must not reach the tracker");
  } finally {
    outbound.restore();
  }
});

test("fileIssue: the token rides on the pinned address, with a body", async () => {
  // The property that matters, and the reason `pinnedRequest` grew a method and a
  // body rather than this going out through plain `fetch`: the request is dialled
  // at the address the guard checked, while the TLS name stays `api.github.com`.
  const outbound = stubOutboundFetch(
    () =>
      new Response(JSON.stringify({ html_url: "https://github.com/x/y/issues/7", number: 7 }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
  );
  try {
    const filed = await fileIssue({
      repo: "Satwik-Miyyapuram/weaveforge",
      token: "ghp_test_token",
      title: "[app] Crash",
      body: "It broke",
      resolve: resolvesPublic,
    });

    assert.deepEqual(filed, { ok: true, url: "https://github.com/x/y/issues/7", number: 7 });
    assert.equal(outbound.calls.length, 1);

    const sent = outbound.calls[0]!;
    assert.equal(sent.url, "https://api.github.com/repos/Satwik-Miyyapuram/weaveforge/issues");
    assert.equal(sent.method, "POST", "an issue is created, not read");
    assert.deepEqual(JSON.parse(sent.body ?? "{}"), { title: "[app] Crash", body: "It broke" });
  } finally {
    outbound.restore();
  }
});

test("fileIssue: a refusal from the tracker is reported, not thrown", async () => {
  const outbound = stubOutboundFetch(() => new Response("nope", { status: 403 }));
  try {
    const filed = await fileIssue({
      repo: "r",
      token: "t",
      title: "t",
      body: "b",
      resolve: resolvesPublic,
    });

    assert.deepEqual(filed, { ok: false, reason: "refused", status: 403 });
  } finally {
    outbound.restore();
  }
});

test("fileIssue: a name that resolves somewhere private is never dialled", async () => {
  // The whole point of the guard. A DNS answer pointing at the loopback address
  // must stop the request before the token can be sent anywhere.
  const outbound = stubOutboundFetch(() => new Response("should not happen", { status: 500 }));
  try {
    const filed = await fileIssue({
      repo: "r",
      token: "secret-token",
      title: "t",
      body: "b",
      resolve: async () => ["127.0.0.1"],
    });

    assert.equal(filed.ok, false);
    assert.deepEqual(outbound.calls, [], "the token must not be dialled at a private address");
  } finally {
    outbound.restore();
  }
});

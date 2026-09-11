import { test } from "node:test";
import assert from "node:assert/strict";
import { requireSdkUser, requireMcpRelayUser } from "../_shared";
import { stubFetch } from "@/lib/test/stub-fetch";

test("requireSdkUser: 401 with no Authorization header (no Supabase touched)", async () => {
  const auth = await requireSdkUser(new Request("http://localhost/api/sdk/whoami"));
  assert.equal(auth.ok, false);
  if (!auth.ok) {
    assert.equal(auth.response.status, 401);
    assert.match((await auth.response.json()).error, /Not authenticated/);
  }
});

test("requireMcpRelayUser: 401 with no Authorization header", async () => {
  const auth = await requireMcpRelayUser(new Request("http://localhost/api/mcp/relay"));
  assert.equal(auth.ok, false);
  if (!auth.ok) assert.equal(auth.response.status, 401);
});

// ---------------------------------------------------------------- token scopes
//
// The seam the review found: an `mcp_relay`-scoped token — minted with
// `expires_at: null` and handed to third-party MCP software — also resolved as
// an SDK token, because `resolve_api_token` filtered on expiry only. The
// database half of the fix is migration 0130; these cover the application half,
// which is what makes a future regression in the RPC fail closed rather than
// silently re-open the seam.

/** A token body long enough to pass `isApiTokenFormat`. */
const TT_TOKEN = `tt_${"A".repeat(32)}`;

/** Point both Supabase clients at a stub that answers the scope RPC. */
function stubBackend(scopes: string[] | null, opts: { onResolveApiToken?: () => void } = {}) {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://stub.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
  process.env.SUPABASE_JWT_SECRET = "secret";

  return stubFetch((url) => {
    if (url.includes("/rest/v1/rpc/api_token_scopes")) {
      return Response.json(scopes);
    }
    if (url.includes("/rest/v1/rpc/resolve_api_token")) {
      // Reached only if the scope check let the caller through — which is the
      // assertion this stub exists to make fail loudly.
      opts.onResolveApiToken?.();
      return Response.json("00000000-0000-0000-0000-000000000001");
    }
    if (url.includes("/rest/v1/rpc/resolve_mcp_relay_token")) {
      return Response.json("00000000-0000-0000-0000-000000000001");
    }
    return Response.json({});
  });
}

/** Restore the env vars a stubBackend call set. */
function restoreEnv(saved: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function withEnv<T>(fn: () => Promise<T>): Promise<T> {
  const keys = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_JWT_SECRET",
  ];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  return fn().finally(() => restoreEnv(saved));
}

test("requireSdkUser: a relay-only token is refused before any JWT is minted", async () => {
  await withEnv(async () => {
    let mintAttempted = false;
    const { restore } = stubBackend(["mcp_relay"], { onResolveApiToken: () => { mintAttempted = true; } });
    try {
      const auth = await requireSdkUser(
        new Request("http://localhost/api/sdk/whoami", {
          headers: { authorization: `Bearer ${TT_TOKEN}` },
        }),
      );
      assert.equal(auth.ok, false);
      if (!auth.ok) assert.equal(auth.response.status, 401);
      assert.equal(mintAttempted, false, "the wrong scope must never reach the resolver");
    } finally {
      restore();
    }
  });
});

test("requireMcpRelayUser: an sdk-scoped token is refused too", async () => {
  await withEnv(async () => {
    const { restore } = stubBackend(["sdk"]);
    try {
      const auth = await requireMcpRelayUser(
        new Request("http://localhost/api/mcp/relay", {
          headers: { authorization: `Bearer ${TT_TOKEN}` },
        }),
      );
      assert.equal(auth.ok, false);
      if (!auth.ok) assert.equal(auth.response.status, 401);
    } finally {
      restore();
    }
  });
});

test("an unreachable scope lookup is an outage, not an invalid token", async () => {
  // A 401 here would tell a caller with a perfectly good token to go and mint
  // another one, which would not help and would hide the real failure.
  await withEnv(async () => {
    const { restore } = stubFetch(() =>
      new Response(JSON.stringify({ message: "connection refused" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      }),
    );
    try {
      const auth = await requireSdkUser(
        new Request("http://localhost/api/sdk/whoami", {
          headers: { authorization: `Bearer ${TT_TOKEN}` },
        }),
      );
      assert.equal(auth.ok, false);
      if (!auth.ok) assert.ok(auth.response.status >= 500, `expected a server fault, got ${auth.response.status}`);
    } finally {
      restore();
    }
  });
});

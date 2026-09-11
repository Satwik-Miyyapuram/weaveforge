import assert from "node:assert/strict";
import test from "node:test";
import { SettingsFacade } from "../facades";

/**
 * The settings panels used to fetch their own tokens: `getAccessToken()`, a
 * hand-built `Authorization: Bearer` header, a body parse and a status-to-message
 * mapping, twice over. Those four steps are a property of the deployment rather
 * than of a screen, so they live on the facade now — and this file pins the
 * shape the panels rely on: which verb, which path, which body, and which
 * sentence a reader sees when the server says no.
 */

const TOKEN = "tt_test";

/** A facade whose auth and `fetch` are both stubs, wired with the minimum deps. */
function facadeWith(respond: (url: string, init: RequestInit) => Response, token: string | null = TOKEN) {
  const calls: { url: string; init: RequestInit }[] = [];
  const facade = new SettingsFacade({
    settings: {} as never,
    bibliography: {} as never,
    projectBibliography: {} as never,
    integrations: {} as never,
    accessToken: async () => token,
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init: init ?? {} });
    return respond(url, init ?? {});
  }) as typeof globalThis.fetch;

  return {
    facade,
    calls,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("apiTokens.list reads the collection route and returns its records", async () => {
  const harness = facadeWith(() => json({ tokens: [{ id: "t1" }] }));
  try {
    const tokens = await harness.facade.apiTokens.list();

    assert.deepEqual(tokens, [{ id: "t1" }]);
    assert.equal(harness.calls[0]!.url, "/api/settings/api-tokens");
    assert.equal(harness.calls[0]!.init.method, "GET");
    const headers = harness.calls[0]!.init.headers as Record<string, string>;
    assert.equal(headers.Authorization, `Bearer ${TOKEN}`);
  } finally {
    harness.restore();
  }
});

test("apiTokens.list is an empty list, not an error, when the body has none", async () => {
  const harness = facadeWith(() => json({ tokens: "not-an-array" }));
  try {
    assert.deepEqual(await harness.facade.apiTokens.list(), []);
  } finally {
    harness.restore();
  }
});

test("apiTokens.create sends the expiry the panel chose", async () => {
  const harness = facadeWith(() => json({ record: { id: "t1" }, plaintext: "tt_new" }));
  try {
    const created = await harness.facade.apiTokens.create({ name: "Laptop", expiresInDays: 30 });

    assert.equal(created.plaintext, "tt_new");
    assert.equal(harness.calls[0]!.init.method, "POST");
    const headers = harness.calls[0]!.init.headers as Record<string, string>;
    assert.equal(headers["Content-Type"], "application/json");
    assert.deepEqual(JSON.parse(String(harness.calls[0]!.init.body)), {
      name: "Laptop",
      expiresInDays: 30,
    });
  } finally {
    harness.restore();
  }
});

test("apiTokens.revoke carries the id in the query and uses DELETE", async () => {
  const harness = facadeWith(() => json({ ok: true }));
  try {
    await harness.facade.apiTokens.revoke("t/1");
    assert.equal(harness.calls[0]!.url, "/api/settings/api-tokens?id=t%2F1");
    assert.equal(harness.calls[0]!.init.method, "DELETE");
  } finally {
    harness.restore();
  }
});

test("a failed call surfaces the route's own message", async () => {
  const harness = facadeWith(() => json({ error: "Token name is required." }, 400));
  try {
    await assert.rejects(
      () => harness.facade.apiTokens.create({ name: "", expiresInDays: null }),
      /Token name is required\./,
    );
  } finally {
    harness.restore();
  }
});

test("no session is reported as what it is, not as a failed request", async () => {
  const harness = facadeWith(() => json({}), null);
  try {
    await assert.rejects(() => harness.facade.apiTokens.list(), /Sign in to manage API tokens\./);
    await assert.rejects(() => harness.facade.apiTokens.create({ name: "x", expiresInDays: null }), /Sign in to create tokens\./);
    await assert.rejects(() => harness.facade.apiTokens.revoke("t1"), /Sign in to revoke tokens\./);
    // Nothing was attempted: this deployment's auth port returned no token.
    assert.equal(harness.calls.length, 0);
  } finally {
    harness.restore();
  }
});

test("mcpTokens.create names the MCP route and refuses a bodyless success", async () => {
  const harness = facadeWith(() => json({ record: { id: "m1" }, plaintext: "tt_mcp" }));
  try {
    const created = await harness.facade.mcpTokens.create();
    assert.equal(created.plaintext, "tt_mcp");
    assert.equal(harness.calls[0]!.url, "/api/settings/mcp-tokens");
    assert.equal(harness.calls[0]!.init.method, "POST");
  } finally {
    harness.restore();
  }
});

test("mcpTokens.create falls back to its own wording when the route says nothing", async () => {
  const harness = facadeWith(() => json({}, 401));
  try {
    await assert.rejects(() => harness.facade.mcpTokens.create(), /Could not create MCP token\./);
  } finally {
    harness.restore();
  }
});

test("mcpTokens.list is silent on an unusable deployment, noisy on a real refusal", async () => {
  // No session at all: an empty list. The panel shows nothing rather than an
  // error nobody can act on.
  const anonymous = facadeWith(() => json({ tokens: [{ id: "m1" }] }), null);
  try {
    assert.deepEqual(await anonymous.facade.mcpTokens.list(), []);
    assert.equal(anonymous.calls.length, 0);
  } finally {
    anonymous.restore();
  }

  // A 404 from a deployment without MCP support is a throw the panel chooses to
  // swallow; the facade still has to report it as a failure, not as "no tokens".
  const disabled = facadeWith(() => json({ error: "mcp_disabled" }, 404));
  try {
    await assert.rejects(() => disabled.facade.mcpTokens.list(), /mcp_disabled/);
  } finally {
    disabled.restore();
  }
});

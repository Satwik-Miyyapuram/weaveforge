/**
 * Where integration credentials go, and the bug that decided it.
 *
 * The desktop app is signed in to an account, so every "is this window working
 * locally?" check said no — and the build still had no server. `src/app/api/` is
 * held aside for the export (`apps/desktop/scripts/build-web.mjs`), so a fetch
 * to `/api/settings/credentials` reached the `app://` file handler and came back
 * a 404 with an empty body: `res.json()` threw, the catch left `{}`, and the
 * reader saw the generic "Failed to save integration credentials." while nothing
 * was written at all — the secrets are written before the settings row.
 *
 * So the choice is pinned to the build, never to the mode: a window with an
 * account and no routes still has to keep them somewhere.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { LOCAL_USER_ID } from "@weaveforge/core";
import { RouteSecretsStore } from "@/features/settings/infrastructure/supabase-settings-repository";
import { DeviceSecretsStore } from "../providers/local/device-secrets-store";
import { secretsStoreFor } from "../providers/secrets-store";

/** A client that can answer the only thing the route store asks it. */
function clientWithToken(token: string | null = "token"): SupabaseClient {
  return {
    auth: {
      getSession: async () => ({ data: { session: token ? { access_token: token } : null } }),
    },
  } as unknown as SupabaseClient;
}

describe("choosing a credentials store", () => {
  it("asks the route when this deployment has routes of its own", () => {
    const store = secretsStoreFor(clientWithToken(), true);
    assert.ok(store instanceof RouteSecretsStore);
    assert.ok(!(store instanceof DeviceSecretsStore));
  });

  it("keeps them on this machine when it has none", () => {
    // The desktop export: signed in or not, `/api/settings/credentials` is not
    // in the bundle, so there is no route to ask.
    const store = secretsStoreFor(clientWithToken(), false);
    assert.ok(store instanceof DeviceSecretsStore);
    assert.ok(!(store instanceof RouteSecretsStore));
  });
});

describe("the device credentials store", () => {
  it("parses a json column that came back as text", async () => {
    const store = new DeviceSecretsStore(async () => [{ secrets: '{"zoteroApiKey":"k"}' }]);
    assert.deepEqual(await store.load(), { zoteroApiKey: "k" });
  });

  it("takes a json column that came back already parsed", async () => {
    const store = new DeviceSecretsStore(async () => [{ secrets: { zoteroApiKey: "k" } }]);
    assert.deepEqual(await store.load(), { zoteroApiKey: "k" });
  });

  it("answers with nothing rather than throwing when there is no row yet", async () => {
    const store = new DeviceSecretsStore(async () => []);
    assert.deepEqual(await store.load(), {});
  });

  it("writes one row for this device, and never a route", async () => {
    const asked: Array<{ sql: string; params: unknown }> = [];
    const store = new DeviceSecretsStore(async (sql, params) => {
      asked.push({ sql, params });
      return [];
    });

    await store.save({ zoteroApiKey: "k" });

    assert.equal(asked.length, 1, "one statement, not a fetch and a statement");
    const [write] = asked;
    assert.ok(write, "the store wrote something");
    assert.match(write.sql, /local_secrets/);
    assert.match(write.sql, /on conflict \(user_id\) do update/);
    assert.deepEqual(write.params, [LOCAL_USER_ID, JSON.stringify({ zoteroApiKey: "k" })]);
  });

  it("reads the row for the device's own identity", async () => {
    const asked: Array<{ sql: string; params: unknown }> = [];
    const store = new DeviceSecretsStore(async (sql, params) => {
      asked.push({ sql, params });
      return [];
    });

    await store.load();

    const [read] = asked;
    assert.ok(read, "the store read something");
    assert.match(read.sql, /from local_secrets/);
    assert.deepEqual(read.params, [LOCAL_USER_ID]);
  });
});

describe("the route credentials store", () => {
  it("goes to the same-origin route, carrying the session's token", async () => {
    // The other half of the pair: on a deployment that has the route, this is
    // still where secrets belong, and the two stores must differ in what they
    // actually do rather than only in type.
    const seen: Array<{ url: string; init: RequestInit | undefined }> = [];
    const real = globalThis.fetch;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      seen.push({ url, init });
      return { ok: true, json: async () => ({ zoteroApiKey: "k" }) } as unknown as Response;
    }) as unknown as typeof globalThis.fetch;

    try {
      const store = new RouteSecretsStore(clientWithToken("abc"));
      assert.deepEqual(await store.load(), { zoteroApiKey: "k" });
    } finally {
      globalThis.fetch = real;
    }

    assert.equal(seen.length, 1);
    const [request] = seen;
    assert.ok(request, "the store made a request");
    assert.equal(request.url, "/api/settings/credentials");
    assert.equal(
      (request.init?.headers as Record<string, string> | undefined)?.Authorization,
      "Bearer abc",
    );
  });
});

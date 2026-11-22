/**
 * Where integration credentials go, and the bug that decided it.
 *
 * The desktop app is signed in to an account, so every "is this window working
 * locally?" check said no — and the build still had no server. `src/app/api/` is
 * held aside for the export (`apps/shell/scripts/build-web.mjs`), so a fetch
 * to `/api/settings/credentials` reached the `app://` file handler and came back
 * a 404 with an empty body: `res.json()` threw, the catch left `{}`, and the
 * reader saw the generic "Failed to save integration credentials." while nothing
 * was written at all — the secrets are written before the settings row.
 *
 * So the choice is pinned to the build, never to the mode: a window with an
 * account and no routes still has to keep them somewhere.
 */
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { RouteSecretsStore } from "@/features/settings/infrastructure/parts";
import { loadTestCore } from "@/lib/test/load-test-core";
import type { DesktopBridge } from "@/lib/desktop/desktop-bridge";
import {
  DEVICE_SECRETS_NAME,
  DeviceSecretsStore,
  KeychainUnavailableError,
  type DeviceKeychain,
} from "../providers/local/parts";
import type { LocalQuery } from "../providers/local/pglite-client";
import { secretsStoreFor } from "../providers/secrets-store";

before(loadTestCore);

/** Runs `body` with `window.weaveforge` set to `weaveforge` (or with no such bridge when undefined), then restores `window`. */
async function withWindow(weaveforge: unknown, body: () => Promise<void>): Promise<void> {
  const g = globalThis as { window?: unknown };
  const had = "window" in g;
  const previous = g.window;
  g.window = weaveforge === undefined ? {} : { weaveforge };
  try {
    await body();
  } finally {
    if (had) g.window = previous;
    else delete g.window;
  }
}

/** A fake desktop bridge: the keychain is a map, and every local-database query is recorded. */
function fakeBridge() {
  const keychain = new Map<string, string>();
  const writes: string[] = [];
  const queries: string[] = [];
  const bridge = {
    fetchTitle: async () => "",
    readSecret: async (name: string) => keychain.get(name) ?? null,
    writeSecret: async (name: string, text: string) => {
      writes.push(name);
      keychain.set(name, text);
    },
    clearSecret: async (name: string) => {
      keychain.delete(name);
    },
    queryLocalDb: async (sql: string) => {
      queries.push(sql);
      return [];
    },
    legacyDbPresent: async () => false,
    migrate097MoveSecrets: async () => [],
  };
  return { bridge: bridge as unknown as DesktopBridge, writes, queries };
}

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

describe("the offline credentials store", () => {
  it("writes through the keychain and never the device table", async () => {
    const fake = fakeBridge();
    await withWindow(fake.bridge, async () => {
      const store = secretsStoreFor(clientWithToken(), false);
      await store.save({ zoteroApiKey: "k" });
      assert.ok(fake.writes.includes(`${DEVICE_SECRETS_NAME}/zoteroApiKey`), "the key went to the keychain");
      assert.deepEqual(fake.queries, [], "no local-database statement ran");
      assert.deepEqual(await store.load(), { zoteroApiKey: "k" });
    });
  });

  it("refuses a save with no desktop bridge and keeps nothing", async () => {
    // A fake keychain behaves as desktopKeychain does with no bridge: reads find nothing,
    // and the write is refused. The refused write is the only one attempted, and nothing is kept.
    const kept = new Map<string, string>();
    const attempts: string[] = [];
    const keychain: DeviceKeychain = {
      read: async (key) => kept.get(key) ?? null,
      write: async (key) => {
        attempts.push(key);
        throw new KeychainUnavailableError();
      },
      clear: async (key) => {
        kept.delete(key);
      },
    };
    const unusedRun = (async () => {
      throw new Error("the device table is not used for saves");
    }) as LocalQuery;
    const store = new DeviceSecretsStore(unusedRun, keychain, async () => {}, async () => false);
    await assert.rejects(store.save({ zoteroApiKey: "k" }), KeychainUnavailableError);
    assert.equal(attempts.length, 1, "the save stopped at the first refused write");
    assert.equal(kept.size, 0, "nothing was kept");
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

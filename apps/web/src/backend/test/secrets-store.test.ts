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
import { ApiKeysNotInBrowserError, RefusingSecretsStore } from "../providers/files/refusing-secrets-store";
import { loadTestCore } from "@/lib/test/load-test-core";
import type { DesktopBridge } from "@/lib/desktop/desktop-bridge";
import {
  DEVICE_SECRETS_NAME,
  DeviceSecretsStore,
  KeychainUnavailableError,
  desktopKeychain,
  type DeviceKeychain,
} from "../device-secrets-store";
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

/** A fake desktop bridge: the keychain is a map. */
function fakeBridge() {
  const keychain = new Map<string, string>();
  const writes: string[] = [];
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
  };
  return { bridge: bridge as unknown as DesktopBridge, writes };
}


describe("choosing a credentials store", () => {
  it("keeps none on the hosted web and never asks the retired route (0.9.8)", async () => {
    // `/api/settings/credentials` answers 410 from 0.9.8: the hosted web uses the same
    // store as the browser workspace, which holds no keys and sends nothing anywhere.
    const store = secretsStoreFor(true);
    assert.ok(store instanceof RefusingSecretsStore);
    const real = globalThis.fetch;
    let fetched = 0;
    globalThis.fetch = (async () => {
      fetched += 1;
      return new Response("{}", { status: 410 });
    }) as typeof fetch;
    try {
      assert.deepEqual(await store.load(), {});
      await assert.rejects(store.save({ zoteroApiKey: "k" }), ApiKeysNotInBrowserError);
    } finally {
      globalThis.fetch = real;
    }
    assert.equal(fetched, 0, "no request reaches the server");
  });

  it("keeps them on this machine when it has none", () => {
    // The desktop export: signed in or not, `/api/settings/credentials` is not
    // in the bundle, so there is no route to ask.
    const store = secretsStoreFor(false);
    assert.ok(store instanceof DeviceSecretsStore);
  });
});

describe("the offline credentials store", () => {
  it("writes through the keychain", async () => {
    const fake = fakeBridge();
    await withWindow(fake.bridge, async () => {
      const store = secretsStoreFor(false);
      await store.save({ zoteroApiKey: "k" });
      assert.ok(fake.writes.includes(`${DEVICE_SECRETS_NAME}/zoteroApiKey`), "the key went to the keychain");
      assert.deepEqual(await store.load(), { zoteroApiKey: "k" });
    });
  });

  it("refuses a save with no desktop bridge and keeps nothing", async () => {
    // A fake keychain behaves as desktopKeychain does with no bridge: reads find nothing,
    // and the write is refused. The refused write is the only one attempted, and nothing is kept.
    const kept = new Map<string, string>();
    const attempts: string[] = [];
    const keychain: DeviceKeychain = {
      read: async (key: string) => kept.get(key) ?? null,
      write: async (key: string) => {
        attempts.push(key);
        throw new KeychainUnavailableError();
      },
      clear: async (key: string) => {
        kept.delete(key);
      },
    };
    const store = new DeviceSecretsStore(keychain);
    await assert.rejects(store.save({ zoteroApiKey: "k" }), KeychainUnavailableError);
    assert.equal(attempts.length, 1, "the save stopped at the first refused write");
  });

  it("the desktop keychain with no bridge refuses a write with KeychainUnavailableError", async () => {
    // null, not undefined: an undefined argument would fall back to the default (the window's bridge).
    await assert.rejects(desktopKeychain(null).write("zoteroApiKey", "k"), KeychainUnavailableError);
  });
});

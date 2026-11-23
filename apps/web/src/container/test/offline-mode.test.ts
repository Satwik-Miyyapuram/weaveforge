import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, before, test } from "node:test";

import { LOCAL_USER_ID } from "@weaveforge/core";
import type { BackendConfig } from "../../backend/parts";
import type { VaultFileBridge } from "../../features/workspace/infrastructure/parts";
import { loadTestCore } from "@/lib/test/load-test-core";
import { LOCAL_MODE_IN_BUILD, NEEDS_ACCOUNT } from "../../backend/providers/local/local-identity";
import { offlineDb } from "../../backend/providers/local/offline-db";
import { wireDesktopFileBackend } from "../desktop-file-backend";
import { wireBackend } from "../parts";

// 0.9.7 offline mode: no account, no server, no local database. Personal data is the
// folder's files; anything that needs the server is refused in words before a request.
before(loadTestCore);

const config = {
  provider: "postgrest",
  supabaseUrl: "http://127.0.0.1:9",
  supabaseAnonKey: "test-anon-key",
  dataUrl: "http://127.0.0.1:9",
} as BackendConfig;

const settings = { load: async () => ({}), save: async () => {} } as never;

function emptyVault(): VaultFileBridge {
  const files = new Map<string, Uint8Array>();
  return {
    readVaultFile: async (path) => (files.has(path) ? new TextDecoder().decode(files.get(path)) : null),
    writeVaultFile: async (path, contents) => {
      files.set(path, new TextEncoder().encode(contents));
    },
    readVaultBytes: async (path) => files.get(path) ?? null,
    writeVaultBytes: async (path, data) => {
      files.set(path, data);
    },
    listVaultFiles: async () => [],
    statVaultFile: async () => null,
    removeVaultFile: async (path) => {
      files.delete(path);
    },
  };
}

const realFetch = globalThis.fetch;
let fetched: string[] = [];
function trapFetch() {
  fetched = [];
  globalThis.fetch = (async (input: unknown) => {
    fetched.push(String(input));
    throw new Error("offline mode must not reach the network");
  }) as typeof fetch;
}
afterEach(() => {
  globalThis.fetch = realFetch;
});

function offlineBackend(migration: "verified" | "removed" | "none" = "verified") {
  return wireBackend(config, { projectId: null }, () => null, {
    migration,
    onDesktop: true,
    localMode: true,
    wireDesktopFileBackend: wireDesktopFileBackend(emptyVault(), settings, undefined, true),
  });
}

test("the build ships offline mode", () => {
  assert.equal(LOCAL_MODE_IN_BUILD, true);
});

test("the offline database client refuses every server call in words, without a request", () => {
  trapFetch();
  const db = offlineDb() as unknown as {
    from(t: string): unknown;
    rpc(n: string): unknown;
    schema(n: string): unknown;
    storage: { from(b: string): unknown };
  };
  assert.throws(() => db.from("papers"), { message: NEEDS_ACCOUNT });
  assert.throws(() => db.rpc("save_paper_bundle"), { message: NEEDS_ACCOUNT });
  assert.throws(() => db.schema("public"), { message: NEEDS_ACCOUNT });
  assert.throws(() => db.storage.from("shared"), { message: NEEDS_ACCOUNT });
  assert.deepEqual(fetched, []);
});

test("offline mode wires the folder's files with the local user and no server", async () => {
  trapFetch();
  const backend = offlineBackend();
  assert.equal(backend.filesMode, true);
  assert.equal((await backend.auth.getUser())?.id, LOCAL_USER_ID);
  assert.equal(await backend.auth.getAccessToken(), null);
  assert.equal(await backend.session.requireUserId(), LOCAL_USER_ID);
  assert.equal(await backend.releaseNoticesRepository.latest(), null);
  assert.throws(() => backend.db.from("shared_items").select("*"), { message: NEEDS_ACCOUNT });
  assert.deepEqual(fetched, []);
});

test("offline mode wires files for any folder state the entry lets through", () => {
  for (const migration of ["verified", "removed"] as const) {
    assert.equal(offlineBackend(migration).filesMode, true, migration);
  }
});

test("a signed-in desktop still reaches the server for org rows", () => {
  const backend = wireBackend(config, { projectId: null }, () => null, {
    migration: "verified",
    onDesktop: true,
    wireDesktopFileBackend: wireDesktopFileBackend(emptyVault(), settings),
  });
  assert.doesNotThrow(() => backend.db.from("shared_items").select("*"));
});

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

test("no offline path opens the local database (PGlite)", () => {
  const light = read("../../backend/parts.ts");
  const fn = light.slice(light.indexOf("function wireLocalLightBackend("));
  assert.doesNotMatch(fn.slice(0, fn.indexOf("\n}\n")), /localBackendParts/);
  const lib = read("../../lib/parts.ts");
  assert.doesNotMatch(lib, /localBackendParts\(\)\.db/);
  const vectors = read("../../features/search/infrastructure/vector-store.ts");
  assert.doesNotMatch(vectors, /isLocalMode\(\) \? localStore\(\)/);
});

test("the container leaves offline mode when the folder is not on files, instead of opening PGlite", () => {
  const source = read("../../create-app-container.ts");
  assert.match(source, /localMode: offline/);
  assert.match(source, /setLocalMode\(false\)/);
});

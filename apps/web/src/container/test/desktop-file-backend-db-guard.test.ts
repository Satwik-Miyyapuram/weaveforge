import assert from "node:assert/strict";
import { before, test } from "node:test";

import type { BackendConfig } from "../../backend/parts";
import type { VaultFileBridge } from "../../features/workspace/infrastructure/parts";
import { loadTestCore } from "@/lib/test/load-test-core";
import { wireDesktopFileBackend } from "../desktop-file-backend";
import { wireNoAccountBackend } from "../no-account-file-backend";
import { wirePostgrestBackend } from "../../backend/providers/postgrest/wire-postgrest-backend";
import { READ_ONLY_MESSAGE, readOnlyDb } from "../read-only-repositories";
import { FileModeBlobStore } from "../file-mode-blob-store";

// In files mode the database client is still live for org and sharing rows, so
// the personal tables must refuse writes there: a personal write that reaches
// PostgREST would put user data on the server.
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

// 0.9.8: the container's database client refuses personal tables, read or write, on every backend.
for (const [name, wire] of [
  // Each wiring is called directly, so wireBackend's local-mode routing cannot swap one for the other.
  ["desktop", () => wireDesktopFileBackend(emptyVault(), settings)(config, { projectId: null }, () => null)],
  ["no-account", () => wireNoAccountBackend(config, { projectId: null }, () => null)],
] as const) {
  test(`${name}: a personal table or rpc is refused over the database client, read or write`, () => {
    const backend = wire();
    assert.throws(() => backend.db.from("papers"), /not allowed on the org server: papers/);
    // 0.9.8: the personal tables 0165 keeps live are refused too.
    for (const t of ["projects", "experiments", "milestones", "user_settings", "overleaf_connections"]) {
      assert.throws(() => backend.db.from(t), /not allowed on the org server/, t);
    }
    assert.throws(() => backend.db.schema("public").from("notes"), /not allowed on the org server/);
    assert.throws(() => backend.db.rpc("save_paper_bundle", {}), /not allowed on the org server/);
  });

  test(`${name}: personal blobs go to the files-mode blob store, not the server store`, () => {
    const backend = wire();
    assert.ok(backend.rawBlobStore instanceof FileModeBlobStore, "personal blob writes must not reach the server");
  });

  test(`${name}: org-table reads still build, and a non-org write on an org read table is still read-only`, () => {
    const backend = wire();
    assert.doesNotThrow(() => backend.db.from("shares").select("*"));
    assert.throws(() => backend.db.from("release_notices").delete(), { message: READ_ONLY_MESSAGE });
  });
}

test("desktop: a personal blob upload lands in the folder and makes no request", async () => {
  const vault = emptyVault();
  const written: string[] = [];
  const writeBytes = vault.writeVaultBytes;
  vault.writeVaultBytes = async (path, data) => {
    written.push(path);
    await writeBytes(path, data);
  };
  const backend = wireDesktopFileBackend(vault, settings)(config, { projectId: null }, () => null);
  const urls: string[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    urls.push(String(input));
    throw new Error("spied network");
  }) as typeof fetch;
  try {
    await backend.rawBlobStore.upload("paper-images", "u-1/a.png", new Blob([new Uint8Array([1, 2, 3])]), "image/png");
  } finally {
    globalThis.fetch = real;
  }
  assert.deepEqual(urls, []);
  assert.ok(written.some((p) => p.endsWith("paper-images/u-1/a.png")), JSON.stringify(written));
});

test("files mode refuses a personal integrations read on the server client (the desktop wiring)", async () => {
  // The same wiring call as desktop-file-backend.ts: server client guarded by readOnlyDb, then files mode's org-table guard.
  const postgrest = wirePostgrestBackend(config, { projectId: null }, () => null, undefined, { filesMode: true }, readOnlyDb);
  await assert.rejects(
    postgrest.integrationsStore.get("p-1", "zotero" as never),
    /Table not allowed on the org server: project_integrations/,
  );
});

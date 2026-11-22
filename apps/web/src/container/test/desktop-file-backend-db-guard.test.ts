import assert from "node:assert/strict";
import { before, test } from "node:test";

import type { BackendConfig } from "../../backend/parts";
import type { VaultFileBridge } from "../../features/workspace/infrastructure/parts";
import { loadTestCore } from "@/lib/test/load-test-core";
import { wireDesktopFileBackend } from "../desktop-file-backend";
import { wirePostgrestBackend } from "../../backend/providers/postgrest/wire-postgrest-backend";
import { READ_ONLY_MESSAGE, readOnlyDb } from "../read-only-repositories";
import { wireBackend } from "../parts";

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

function filesModeBackend() {
  return wireBackend(config, { projectId: null }, () => null, {
    migration: "verified",
    onDesktop: true,
    wireDesktopFileBackend: wireDesktopFileBackend(emptyVault(), settings),
  });
}

test("files mode refuses a write to a personal table over the database client", () => {
  const backend = filesModeBackend();
  assert.throws(() => backend.db.from("papers").insert({ id: "p-1" }), new Error(READ_ONLY_MESSAGE));
  assert.throws(() => backend.db.rpc("save_paper_bundle", {}), new Error(READ_ONLY_MESSAGE));
});

test("files mode still builds reads and org-table queries over the database client", () => {
  const backend = filesModeBackend();
  assert.doesNotThrow(() => backend.db.from("papers").select("*"));
  assert.doesNotThrow(() => backend.db.from("shared_items").select("*"));
});

test("files mode refuses a personal integrations read on the server client (the desktop wiring)", async () => {
  // The same wiring call as desktop-file-backend.ts: server client guarded by readOnlyDb, then files mode's org-table guard.
  const postgrest = wirePostgrestBackend(config, { projectId: null }, () => null, undefined, { filesMode: true }, readOnlyDb);
  await assert.rejects(
    postgrest.integrationsStore.get("p-1", "zotero" as never),
    /Table not allowed on the org server: project_integrations/,
  );
});

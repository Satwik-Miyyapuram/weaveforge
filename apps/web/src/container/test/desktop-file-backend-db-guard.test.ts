import assert from "node:assert/strict";
import { before, test } from "node:test";

import type { BackendConfig } from "../../backend/parts";
import type { VaultFileBridge } from "../../features/workspace/infrastructure/parts";
import { loadTestCore } from "@/lib/test/load-test-core";
import { wireDesktopFileBackend } from "../desktop-file-backend";
import { wireNoAccountBackend } from "../no-account-file-backend";
import { wirePostgrestBackend } from "../../backend/providers/postgrest/wire-postgrest-backend";
import { READ_ONLY_MESSAGE, readOnlyDb } from "../read-only-repositories";

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
    assert.throws(() => backend.db.schema("public").from("notes"), /not allowed on the org server/);
    assert.throws(() => backend.db.rpc("save_paper_bundle", {}), /not allowed on the org server/);
  });

  test(`${name}: org-table reads still build, and a non-org write on an org read table is still read-only`, () => {
    const backend = wire();
    assert.doesNotThrow(() => backend.db.from("shares").select("*"));
    assert.throws(() => backend.db.from("experiments").delete(), { message: READ_ONLY_MESSAGE });
  });
}

test("files mode refuses a personal integrations read on the server client (the desktop wiring)", async () => {
  // The same wiring call as desktop-file-backend.ts: server client guarded by readOnlyDb, then files mode's org-table guard.
  const postgrest = wirePostgrestBackend(config, { projectId: null }, () => null, undefined, { filesMode: true }, readOnlyDb);
  await assert.rejects(
    postgrest.integrationsStore.get("p-1", "zotero" as never),
    /Table not allowed on the org server: project_integrations/,
  );
});

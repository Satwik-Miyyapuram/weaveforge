import assert from "node:assert/strict";
import { test } from "node:test";

import type { BackendConfig } from "../../backend/parts";
import type { VaultFileBridge } from "../../features/workspace/infrastructure/parts";
import { wireBackend } from "../parts";
import { wireDesktopFileBackend } from "../desktop-file-backend";
import { READ_ONLY_MESSAGE } from "../read-only-repositories";

const config = {
  provider: "postgrest",
  supabaseUrl: "http://127.0.0.1:9",
  supabaseAnonKey: "test-anon-key",
  dataUrl: "http://127.0.0.1:9",
} as BackendConfig;

const settings = { load: async () => ({}), save: async () => {} } as never;

/** An in-memory vault: what the shell would write to disk, keyed by path. Text and bytes share one store. */
function memoryVault() {
  const files = new Map<string, Uint8Array>();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const bridge: VaultFileBridge = {
    readVaultFile: async (path) => {
      const data = files.get(path);
      return data ? decoder.decode(data) : null;
    },
    writeVaultFile: async (path, contents) => {
      files.set(path, encoder.encode(contents));
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
  return { bridge, files };
}

test("verified desktop writes personal data to the folder through the bridge", async () => {
  const { bridge, files } = memoryVault();
  const backend = wireBackend(config, { projectId: null }, () => null, {
    migration: "verified",
    onDesktop: true,
    wireDesktopFileBackend: wireDesktopFileBackend(bridge, settings),
  });
  await backend.projectRepository.create({ name: "Desktop project" });
  assert.ok(files.size > 0, "the project was written to the folder");
});

test("unavailable desktop stays read-only and writes nothing", async () => {
  const { bridge, files } = memoryVault();
  const backend = wireBackend(config, { projectId: null }, () => null, {
    migration: "unavailable",
    onDesktop: true,
    wireDesktopFileBackend: wireDesktopFileBackend(bridge, settings),
  });
  await assert.rejects(
    () => Promise.resolve().then(() => backend.projectRepository.create({ name: "Blocked" })),
    new Error(READ_ONLY_MESSAGE),
  );
  assert.equal(files.size, 0, "no file was written");
});

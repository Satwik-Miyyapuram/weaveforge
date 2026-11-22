import assert from "node:assert/strict";
import { before, test } from "node:test";

import type { BackendConfig } from "../../backend/parts";
import { DeviceSecretsStore, type DeviceKeychain } from "../../backend/device-secrets-store";
import type { VaultFileBridge } from "../../features/workspace/infrastructure/parts";
import { loadTestCore } from "@/lib/test/load-test-core";
import { wireBackend } from "../parts";
import { wireDesktopFileBackend } from "../desktop-file-backend";

// The wiring reads the storage config from the Rust core, so the core loads before any test runs.
before(loadTestCore);

const config = {
  provider: "postgrest",
  supabaseUrl: "http://127.0.0.1:9",
  supabaseAnonKey: "test-anon-key",
  dataUrl: "http://127.0.0.1:9",
} as BackendConfig;

const settings = { get: () => undefined, set: () => {} } as never;

/** The OS keychain stand-in: one map shared by every container built over it, as the real keychain is across restarts. */
function fakeKeychain(): DeviceKeychain {
  const entries = new Map<string, string>();
  return {
    read: async (key) => entries.get(key) ?? null,
    write: async (key, text) => {
      entries.set(key, text);
    },
    clear: async (key) => {
      entries.delete(key);
    },
  };
}

function memoryVault(): VaultFileBridge {
  const files = new Map<string, Uint8Array>();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  return {
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
}

/** A secrets store over the keychain only: there is no local database to read. */
function keychainSecrets(keychain: DeviceKeychain) {
  return new DeviceSecretsStore(keychain);
}

test("a credential saved in files mode is still there after a restart", async () => {
  const bridge = memoryVault();
  const keychain = fakeKeychain();
  const before = keychainSecrets(keychain);
  const first = wireBackend(config, { projectId: null }, () => null, wireDesktopFileBackend(bridge, settings, before));
  await first.manageSettings.save({ zoteroApiKey: "tok-restart" });

  // A restart: a new container and a new store, over the same keychain.
  const after = keychainSecrets(keychain);
  wireBackend(config, { projectId: null }, () => null, wireDesktopFileBackend(bridge, settings, after));
  assert.equal((await after.load()).zoteroApiKey, "tok-restart");
});

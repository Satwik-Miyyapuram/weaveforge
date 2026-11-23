/**
 * 0.9.8: integration settings live in the folder's settings file on every backend path.
 * wireBackend must hand out the file store on desktop, browser and no-account, never a
 * server-backed store (the PostgREST integrations store is gone).
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { MemoryWorkspaceFs } from "@core-test/memory-workspace-fs";
import type { BackendConfig } from "@/backend/parts";
import { FileIntegrationsStore } from "@/backend/providers/files/file-settings-repos";
import { setLocalMode } from "@/features/auth/infrastructure/no-account-mode";
import type { VaultFileBridge } from "@/features/workspace/infrastructure/parts";
import { loadTestCore } from "@/lib/test/load-test-core";
import { wireBrowserFiles } from "../browser-file-backend";
import { wireDesktopFileBackend } from "../desktop-file-backend";
import { wireBackend } from "../parts";

const host = globalThis as { localStorage?: Storage };
const previous = host.localStorage;
const data = new Map<string, string>();

before(async () => {
  host.localStorage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, String(v)),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
    key: () => null,
    get length() {
      return data.size;
    },
  } as unknown as Storage;
  await loadTestCore();
});

after(() => {
  host.localStorage = previous;
});

const config = {
  provider: "postgrest",
  supabaseUrl: "http://127.0.0.1:9",
  supabaseAnonKey: "test-anon-key",
  dataUrl: "http://127.0.0.1:9",
} as BackendConfig;

const settings = { load: async () => ({}), save: async () => {} } as never;

test("desktop: wireBackend hands out the file integrations store", () => {
  const backend = wireBackend(config, { projectId: null }, () => null, wireDesktopFileBackend({} as VaultFileBridge, settings));
  try {
    assert.ok(backend.integrationsStore instanceof FileIntegrationsStore);
  } finally {
    backend.dispose();
  }
});

test("browser: wireBackend hands out the file integrations store", async () => {
  const backend = wireBackend(config, { projectId: null }, () => null, await wireBrowserFiles(new MemoryWorkspaceFs()));
  try {
    assert.ok(backend.integrationsStore instanceof FileIntegrationsStore);
  } finally {
    backend.dispose();
  }
});

test("no account: wireBackend hands out the file integrations store", () => {
  setLocalMode(true);
  try {
    const backend = wireBackend(config, { projectId: null }, () => null);
    try {
      assert.ok(backend.integrationsStore instanceof FileIntegrationsStore);
    } finally {
      backend.dispose();
    }
  } finally {
    setLocalMode(false);
  }
});

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

test("with the overlay on, a settings write lands in the file repo and PostgREST sees no write", async () => {
  const { bridge } = memoryVault();
  const sets: string[] = [];
  const recorded = {
    get: () => undefined,
    set: (path: string[]) => {
      sets.push(path.join("."));
    },
  } as never;
  const backend = wireBackend(config, { projectId: null }, () => null, {
    migration: "verified",
    onDesktop: true,
    wireDesktopFileBackend: wireDesktopFileBackend(bridge, recorded),
  });
  const dbCalls: string[] = [];
  const realFrom = backend.db.from.bind(backend.db);
  backend.db.from = (table: string) => {
    dbCalls.push(`from ${table}`);
    return realFrom(table);
  };
  const realRpc = backend.db.rpc.bind(backend.db);
  backend.db.rpc = (name: string, args?: object) => {
    dbCalls.push(`rpc ${name}`);
    return realRpc(name, args);
  };
  await backend.manageSettings.save({ disclaimerAcceptedAt: "2026-11-22T00:00:00.000Z" });
  assert.ok(sets.length > 0, "the settings write reached the file repository");
  assert.deepEqual(dbCalls, [], "no PostgREST call for the settings write");
});

test("with the overlay on, a credential save never reaches the database client", async () => {
  const { bridge } = memoryVault();
  const section = { get: () => undefined, set: () => {} } as never;
  const backend = wireBackend(config, { projectId: null }, () => null, {
    migration: "verified",
    onDesktop: true,
    wireDesktopFileBackend: wireDesktopFileBackend(bridge, section),
  });
  const dbCalls: string[] = [];
  backend.db.from = (table: string) => {
    dbCalls.push(`from ${table}`);
    throw new Error(`unexpected database call: from ${table}`);
  };
  backend.db.rpc = (name: string) => {
    dbCalls.push(`rpc ${name}`);
    throw new Error(`unexpected database call: rpc ${name}`);
  };
  await backend.manageSettings.save({ zoteroApiKey: "key-for-test" });
  assert.deepEqual(dbCalls, [], "the credential stayed off the database client");
});

test("with the overlay on, screening goes to the file repo and PostgREST sees no write", async () => {
  const { bridge } = memoryVault();
  const backend = wireBackend(config, { projectId: null }, () => null, {
    migration: "verified",
    onDesktop: true,
    wireDesktopFileBackend: wireDesktopFileBackend(bridge, settings),
  });
  const dbCalls: string[] = [];
  const realFrom = backend.db.from.bind(backend.db);
  backend.db.from = (table: string) => {
    dbCalls.push(`from ${table}`);
    return realFrom(table);
  };
  const realRpc = backend.db.rpc.bind(backend.db);
  backend.db.rpc = (name: string, args?: object) => {
    dbCalls.push(`rpc ${name}`);
    return realRpc(name, args);
  };
  const decision = {
    id: "d1",
    itemId: "no-such-item",
    reviewerId: "r1",
    stage: "title_abstract",
    state: "included",
    decidedAt: "2026-11-22T00:00:00.000Z",
  } as never;
  // No paper or list holds this item, so the file repository refuses with NotFoundError;
  // a PostgREST call would fail with a network error instead.
  await assert.rejects(backend.screeningRepository.record(decision), { name: "NotFoundError" });
  await backend.screeningRepository.remove("d1");
  assert.deepEqual(dbCalls, [], "no PostgREST call for screening");
});

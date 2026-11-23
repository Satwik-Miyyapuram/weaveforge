import assert from "node:assert/strict";
import { before, test } from "node:test";

import type { BackendConfig } from "../../backend/parts";
import type { VaultFileBridge } from "../../features/workspace/infrastructure/parts";
import { wireDesktopFileBackend } from "../desktop-file-backend";
import { NO_FILE_BACKEND_MESSAGE, wireBackend } from "../parts";
import { loadTestCore } from "@/lib/test/load-test-core";

// The wiring result says whether personal data is in files mode, by an explicit flag.
// Callers (desktop, Android) read `filesMode`; nothing infers it from a repository's class.
// From 0.9.8 the files backend is the only personal-data backend.
before(loadTestCore);

const config = {
  provider: "postgrest",
  supabaseUrl: "http://127.0.0.1:9",
  supabaseAnonKey: "test-anon-key",
  dataUrl: "http://127.0.0.1:9",
} as BackendConfig;

const settings = { load: async () => ({}), save: async () => {} } as never;
const bridge = {} as VaultFileBridge;

test("a desktop folder wires files and reports filesMode true", () => {
  const backend = wireBackend(config, { projectId: null }, () => null, wireDesktopFileBackend(bridge, settings));
  assert.equal(backend.filesMode, true);
});

test("with no file wiring the account backend refuses to start instead of using server rows", () => {
  assert.throws(() => wireBackend(config, { projectId: null }, () => null), { message: NO_FILE_BACKEND_MESSAGE });
});

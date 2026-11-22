import assert from "node:assert/strict";
import { before, test } from "node:test";

import type { BackendConfig } from "../../backend/parts";
import type { VaultFileBridge } from "../../features/workspace/infrastructure/parts";
import { wireDesktopFileBackend } from "../desktop-file-backend";
import { wireBackend } from "../parts";
import { loadTestCore } from "@/lib/test/load-test-core";

// The wiring result says whether personal data is in files mode, by an explicit flag.
// Callers (desktop, Android) read `filesMode`; nothing infers it from a repository's class.
before(loadTestCore);

const config = {
  provider: "postgrest",
  supabaseUrl: "http://127.0.0.1:9",
  supabaseAnonKey: "test-anon-key",
  dataUrl: "http://127.0.0.1:9",
} as BackendConfig;

const settings = { load: async () => ({}), save: async () => {} } as never;
const bridge = {} as VaultFileBridge;

test("a verified desktop folder wires files and reports filesMode true", () => {
  const backend = wireBackend(config, { projectId: null }, () => null, {
    migration: "verified",
    onDesktop: true,
    wireDesktopFileBackend: wireDesktopFileBackend(bridge, settings),
  });
  assert.equal(backend.filesMode, true);
});

test("a verified browser or Android folder reports filesMode true through the same flag", () => {
  const backend = wireBackend(config, { projectId: null }, () => null, {
    migration: "verified",
    onDesktop: false,
    wireBrowserFileBackend: wireDesktopFileBackend(bridge, settings),
  });
  assert.equal(backend.filesMode, true);
});

test("an exported-nothing (none) folder keeps PostgREST and reports filesMode false", () => {
  const backend = wireBackend(config, { projectId: null }, () => null, { migration: "none", onDesktop: false });
  assert.equal(backend.filesMode, false);
});

test("a desktop without verified files is read-only and reports filesMode false", () => {
  const backend = wireBackend(config, { projectId: null }, () => null, {
    migration: "unavailable",
    onDesktop: true,
    wireDesktopFileBackend: wireDesktopFileBackend(bridge, settings),
  });
  assert.equal(backend.filesMode, false);
});

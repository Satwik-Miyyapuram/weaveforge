import assert from "node:assert/strict";
import { before, test } from "node:test";

import { loadTestCore } from "@/lib/test/load-test-core";
import type { BackendConfig } from "../../backend/parts";
import { wireFileBackend, type FileRepositories } from "../../backend/providers/files/wire-file-backend";
import { wirePostgrestBackend } from "../../backend/providers/postgrest/wire-postgrest-backend";
import {
  PERSONAL_REPOSITORY_KEYS,
  SERVER_BACKEND_KEYS,
  PERSONAL_ALIASES,
  overlayFileRepositories,
  unclassifiedKeys,
} from "../with-file-repositories";

// wirePostgrestBackend builds the storage layer, which needs the Rust core loaded.
before(loadTestCore);

const parts = {
  fs: {} as never,
  settings: {} as never,
  secrets: {} as never,
};

const config = {
  provider: "postgrest",
  supabaseUrl: "http://127.0.0.1:9",
  supabaseAnonKey: "test-anon-key",
  dataUrl: "http://127.0.0.1:9",
} as BackendConfig;

test("the personal-key list names exactly the repositories wireFileBackend builds", () => {
  const built = Object.keys(wireFileBackend(parts)).sort();
  assert.deepEqual(Object.keys(PERSONAL_REPOSITORY_KEYS).sort(), built);
});

test("every personal key replaces its counterpart and org keys stay on PostgREST", () => {
  const files = wireFileBackend(parts);
  const wired: Record<string, { from: string; key: string }> = {
    ...Object.fromEntries(Object.keys(PERSONAL_REPOSITORY_KEYS).map((key) => [key, { from: "postgrest", key }])),
    shareRepository: { from: "postgrest", key: "shareRepository" },
    db: { from: "postgrest", key: "db" },
  };
  const out = overlayFileRepositories(wired, files);
  for (const key of Object.keys(PERSONAL_REPOSITORY_KEYS) as (keyof FileRepositories)[]) {
    assert.equal(out[key], files[key], `${key} must be the file repository`);
    assert.notEqual(out[key], wired[key], `${key} must not stay on PostgREST`);
  }
  assert.equal(out.shareRepository, wired.shareRepository);
  assert.equal(out.db, wired.db);
});

test("every key of the wired PostgREST backend is a personal key or a listed server key", () => {
  const wired = wirePostgrestBackend(config, { projectId: null }, () => null);
  try {
    assert.deepEqual(unclassifiedKeys(Object.keys(wired)), []);
  } finally {
    wired.dispose();
  }
});

test("an unlisted new key on the PostgREST backend is reported, not silently kept", () => {
  assert.deepEqual(unclassifiedKeys(["projectRepository", "brandNewRepository"]), ["brandNewRepository"]);
});

test("the overlay overrides every personal key of the wired backend", () => {
  const wired = wirePostgrestBackend(config, { projectId: null }, () => null);
  try {
    const files = wireFileBackend(parts);
    const out = overlayFileRepositories(wired, files);
    for (const key of Object.keys(PERSONAL_REPOSITORY_KEYS) as (keyof FileRepositories)[]) {
      assert.equal(out[key], files[key], `${key} must be overridden`);
    }
    for (const key of SERVER_BACKEND_KEYS) {
      if (key in wired) assert.equal(out[key as keyof typeof out], wired[key as keyof typeof wired], `${key} must stay`);
    }
  } finally {
    wired.dispose();
  }
});

test("bibliography, quotation-type and integrations keys are personal, never on the server list", () => {
  for (const key of ["projectBibliographyCollection", "annotationQuotationTypeRepository", "integrationsStore"]) {
    assert.equal(SERVER_BACKEND_KEYS.has(key), false, `${key} must not be a server key`);
    assert.equal(
      key in PERSONAL_REPOSITORY_KEYS || key in PERSONAL_ALIASES,
      true,
      `${key} must be a personal key or alias`,
    );
  }
});

test("the server-key set equals the documented list (a deliberate copy, not ORG_SERVER_READ_TABLES)", () => {
  const documented = [
    "config",
    "db",
    "session",
    "auth",
    "adminProvisioner",
    "projectContext",
    "releaseNoticesRepository",
    "manageSettings",
    "shareRepository",
    "commentRepository",
    "sharedReader",
    "memberRepository",
    "supervisionRepository",
    "rawBlobStore",
    "labSnapshotRepository",
    "dispose",
  ];
  assert.deepEqual([...SERVER_BACKEND_KEYS].sort(), [...documented].sort());
});

test("the aliases point the PostgREST key names at the file repositories", () => {
  const files = wireFileBackend(parts);
  const wired = { projectBibliographyCollection: "postgrest-collection", annotationQuotationTypeRepository: "postgrest-quotation" };
  const out = overlayFileRepositories(wired, files);
  assert.equal(out.projectBibliographyCollection, files.bibliographyCollectionStore);
  assert.equal(out.annotationQuotationTypeRepository, files.quotationTypeRepository);
});

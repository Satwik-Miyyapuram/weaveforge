import { before, test } from "node:test";
import assert from "node:assert/strict";
import { MemoryWorkspaceFs } from "@core-test/memory-workspace-fs";
import { loadTestCore } from "@/lib/test/load-test-core";
import type { BackendConfig } from "@/backend/parts";
import { wirePostgrestBackend } from "@/backend/providers/postgrest/wire-postgrest-backend";
import { wireBrowserFiles } from "../browser-file-backend";
import { serverDbToWatch } from "../project-watch";

before(async () => {
  await loadTestCore();
});

const config = {
  provider: "postgrest",
  supabaseUrl: "http://127.0.0.1:9",
  supabaseAnonKey: "test-anon-key",
  dataUrl: "http://127.0.0.1:9",
} as BackendConfig;

test("files mode: the wiring result is marked filesMode and the project watch is skipped", async () => {
  const wire = await wireBrowserFiles(new MemoryWorkspaceFs());
  const backend = wire(config, { projectId: null }, () => null);
  assert.equal(backend.filesMode, true);
  assert.equal(serverDbToWatch(backend), null, "a files-mode backend must not be watched on the server db");
});

test("PostgREST path: the server db is still watched and no filesMode flag is set", () => {
  const backend = wirePostgrestBackend(config, { projectId: null }, () => null);
  assert.equal(serverDbToWatch(backend), backend.db);
});

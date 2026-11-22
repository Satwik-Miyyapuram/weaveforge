import { before, test } from "node:test";
import assert from "node:assert/strict";
import { MemoryWorkspaceFs } from "@core-test/memory-workspace-fs";
import { loadTestCore } from "@/lib/test/load-test-core";
import type { BackendConfig } from "@/backend/parts";
import { wirePostgrestBackend } from "@/backend/providers/postgrest/wire-postgrest-backend";
import { ProjectLwwInvalidator } from "@/lib/cache/parts-1";
import { wireBrowserFiles } from "../browser-file-backend";
import { serverDbToWatch, watchProjectChannel } from "../project-watch";

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

/**
 * Files mode keeps personal data on the device. A project realtime channel is a
 * network connection to the hosted realtime endpoint, so files mode must open none.
 */

function recordingDb() {
  const opened: string[] = [];
  const channel = (topic: string) => {
    const handle = {
      on: () => handle,
      subscribe: () => {
        opened.push(topic);
        return handle;
      },
      unsubscribe: async () => "ok",
      send: async () => "ok",
    };
    return handle;
  };
  return { opened, db: { channel, realtime: { setAuth: async () => undefined } } as never };
}

async function settle() {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

test("files mode opens zero realtime channels for the project", async () => {
  const { opened, db } = recordingDb();
  watchProjectChannel(new ProjectLwwInvalidator(), { db, filesMode: true }, "p1");
  await settle();
  assert.deepEqual(opened, []);
});

test("a server-backed container still opens the project channel", async () => {
  const { opened, db } = recordingDb();
  watchProjectChannel(new ProjectLwwInvalidator(), { db }, "p1");
  await settle();
  assert.deepEqual(opened, ["proj:p1"]);
});

import { before, test } from "node:test";
import assert from "node:assert/strict";
import type { Paper } from "@weaveforge/core";
import { MemoryWorkspaceFs } from "@core-test/memory-workspace-fs";
import { loadTestCore } from "@/lib/test/load-test-core";
import type { BackendConfig } from "@/backend/parts";
import { wirePostgrestBackend } from "@/backend/providers/postgrest/wire-postgrest-backend";
import { BROWSER_STORAGE_MESSAGE, openBrowserFileWiring, wireBrowserFiles } from "../browser-file-backend";
import { READ_ONLY_MESSAGE } from "../read-only-repositories";

before(async () => {
  await loadTestCore();
});

const config = {
  provider: "postgrest",
  supabaseUrl: "http://127.0.0.1:9",
  supabaseAnonKey: "test-anon-key",
  dataUrl: "http://127.0.0.1:9",
} as BackendConfig;

function paper(): Paper {
  return {
    id: "p-1",
    title: "Attention Is All You Need",
    authors: ["Vaswani"],
    status: "to_read",
    tags: [],
    metadata: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

/** Records every request URL. Installed after a backend is built, so construction traffic is not counted. */
function spyNetwork() {
  const urls: string[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    urls.push(String(input));
    throw new Error("spied network");
  }) as typeof fetch;
  return { urls, restore: () => (globalThis.fetch = real) };
}

async function quietly(action: () => Promise<unknown>): Promise<void> {
  try {
    await action();
  } catch {
    // The spy refuses every request; only the recorded URLs matter.
  }
}

test("control: without the overlay a personal write reaches PostgREST", async () => {
  const wired = wirePostgrestBackend(config, { projectId: null }, () => null);
  const spy = spyNetwork();
  try {
    await quietly(() => wired.paperRepository.save(paper()));
    assert.ok(spy.urls.length > 0, "the spy must see PostgREST traffic, or the test proves nothing");
  } finally {
    spy.restore();
    wired.dispose();
  }
});

test("with the browser file overlay, a personal round trip makes zero network calls", async () => {
  const fs = new MemoryWorkspaceFs();
  const wire = await wireBrowserFiles(fs);
  const backend = wire(config, { projectId: null }, () => null);
  const spy = spyNetwork();
  try {
    await backend.paperRepository.save(paper());
    const listed = await backend.paperRepository.list();
    assert.deepEqual(
      listed.map((p) => p.id),
      ["p-1"],
    );
    assert.deepEqual(spy.urls, []);
  } finally {
    spy.restore();
    backend.dispose();
  }
});

test("the container db refuses personal tables and rpcs, including through schema()", async () => {
  const wire = await wireBrowserFiles(new MemoryWorkspaceFs());
  const backend = wire(config, { projectId: null }, () => null);
  try {
    assert.throws(() => backend.db.from("papers"), /not allowed on the org server: papers/);
    assert.throws(() => backend.db.schema("public").from("notes"), /not allowed on the org server/);
    assert.throws(() => backend.db.rpc("delete_everything"), /not allowed on the org server/);
  } finally {
    backend.dispose();
  }
});

test("a non-org write on an org read table is refused before any request, as on desktop", async () => {
  const wire = await wireBrowserFiles(new MemoryWorkspaceFs());
  const backend = wire(config, { projectId: null }, () => null);
  const spy = spyNetwork();
  try {
    for (const t of ["release_notices", "sync_tables", "api_tokens", "project_keys"]) {
      assert.throws(() => backend.db.from(t).delete(), { message: READ_ONLY_MESSAGE }, t);
    }
    assert.deepEqual(spy.urls, []);
  } finally {
    spy.restore();
    backend.dispose();
  }
});

test("with the overlay, org and sharing reads still go to PostgREST", async () => {
  const fs = new MemoryWorkspaceFs();
  const wire = await wireBrowserFiles(fs);
  const backend = wire(config, { projectId: null }, () => null);
  const spy = spyNetwork();
  try {
    await quietly(async () => {
      await backend.db.from("share_links").select("*");
    });
    assert.ok(
      spy.urls.some((url) => url.includes("share_links")),
      "org data must keep its PostgREST path",
    );
  } finally {
    spy.restore();
    backend.dispose();
  }
});

test("a personal blob upload makes zero network calls and lands in the file blob store", async () => {
  const fs = new MemoryWorkspaceFs();
  const wire = await wireBrowserFiles(fs);
  const backend = wire(config, { projectId: null }, () => null);
  const spy = spyNetwork();
  try {
    await backend.rawBlobStore.upload("images", "p-1/fig.png", new Blob([new Uint8Array([1, 2, 3])]), "image/png");
    assert.deepEqual(spy.urls, []);
    assert.ok(await fs.stat("assets/images/p-1/fig.png"), "the blob must be a file under assets/<bucket>/<path>");
  } finally {
    spy.restore();
    backend.dispose();
  }
});

test("in files mode a settings save goes to the file repo and never PostgREST", async () => {
  const fs = new MemoryWorkspaceFs();
  const wire = await wireBrowserFiles(fs);
  const backend = wire(config, { projectId: null }, () => null);
  const spy = spyNetwork();
  try {
    const current = await backend.manageSettings.get();
    await backend.manageSettings.save({
      ...current,
      disclaimerAcceptedAt: "2026-01-01T00:00:00.000Z",
      disclaimerVersion: 1,
    });
    assert.deepEqual(spy.urls, []);
    const written = await fs.readText(".weaveforge/settings.json");
    assert.ok(written.includes("2026-01-01T00:00:00.000Z"), "the saved disclaimer must land in settings.json");
  } finally {
    spy.restore();
    backend.dispose();
  }
});

test("a browser storage open failure throws a clear message instead of a raw error", async () => {
  const failing = async () => {
    throw new Error("SecurityError: OPFS denied");
  };
  await assert.rejects(openBrowserFileWiring(failing), (e: Error) => e.message.startsWith(BROWSER_STORAGE_MESSAGE) && /OPFS denied/.test(e.message));
});

test("a repository built inside the wiring cannot write a personal table to the server", async () => {
  const fs = new MemoryWorkspaceFs();
  const wire = await wireBrowserFiles(fs);
  const backend = wire(config, { projectId: null }, () => null);
  const spy = spyNetwork();
  try {
    // paper_tags is personal and not on the org allowlist: the guarded client refuses it before any request.
    // (`projects` is on the allowlist for 1.0.x, so it is not a personal-table probe any more.)
    assert.throws(() => backend.db.from("paper_tags"), /not allowed on the org server/);
    assert.throws(() => backend.db.rpc("personal_probe_rpc"), /not allowed on the org server/);
    assert.deepEqual(spy.urls, []);
  } finally {
    spy.restore();
    backend.dispose();
  }
});

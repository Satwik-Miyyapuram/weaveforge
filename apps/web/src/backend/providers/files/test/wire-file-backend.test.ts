import { before, test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { MemoryWorkspaceFs } from "@core-test/memory-workspace-fs";
import type { SecretsStore } from "@/features/settings/infrastructure/parts";
import { typedCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";
import { wireFileBackend } from "../wire-file-backend";
import { MemorySettings } from "./memory-settings";

before(loadTestCore);

const A = "papers/a.paper.md";
const SECRETS: SecretsStore = {
  load: async () => ({}) as never,
  save: async () => {},
};

/**
 * T5: the file backend reaches neither the local database bridge nor PostgREST.
 * Both are counted: `queryLocalDb` on the desktop bridge and any `fetch`.
 */
const realFetch = globalThis.fetch;
const realWindow = (globalThis as { window?: unknown }).window;
let fetchCalls = 0;
let localDbCalls = 0;

function installSpies(): void {
  fetchCalls = 0;
  localDbCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    return new Response("[]", { status: 200 });
  }) as typeof fetch;
  (globalThis as { window?: unknown }).window = {
    weaveforge: {
      fetchTitle: async () => null,
      queryLocalDb: async () => {
        localDbCalls += 1;
        return [];
      },
    },
  };
}

afterEach(() => {
  globalThis.fetch = realFetch;
  (globalThis as { window?: unknown }).window = realWindow;
});

async function setup() {
  const fs = new MemoryWorkspaceFs();
  const core = typedCore();
  await fs.writeFile(A, core.writePaperRow(null, { id: "a", title: "A" }) + "Body.\n");
  const settings = new MemorySettings();
  const repos = wireFileBackend({ fs, settings, secrets: SECRETS });
  return { repos };
}

test("wireFileBackend builds every personal repository without a database or network call", async () => {
  installSpies();
  const { repos } = await setup();
  for (const [key, repo] of Object.entries(repos)) {
    assert.ok(repo, `${key} is constructed`);
  }
  assert.equal(Object.keys(repos).length, 23);
  assert.equal(fetchCalls, 0, "no PostgREST or other fetch while wiring");
  assert.equal(localDbCalls, 0, "no queryLocalDb while wiring");
});

test("a library pin works over files, with zero queryLocalDb and zero fetch calls", async () => {
  installSpies();
  const { repos } = await setup();
  await repos.libraryPinRepository.pin({ resourceType: "paper", resourceId: "a", ownerId: "me" });
  assert.deepEqual(await repos.paperRepository.listPinnedIds(), ["a"]);
  assert.equal(localDbCalls, 0, "queryLocalDb never called");
  assert.equal(fetchCalls, 0, "no personal-table PostgREST call");
});

test("a citation alert track works over files, with zero queryLocalDb and zero fetch calls", async () => {
  installSpies();
  const { repos } = await setup();
  const track = await repos.citationAlertTrackRepository.track({ paperId: "a" });
  assert.equal((await repos.citationAlertTrackRepository.getByPaperId("a"))?.id, track.id);
  assert.equal(localDbCalls, 0, "queryLocalDb never called");
  assert.equal(fetchCalls, 0, "no personal-table PostgREST call");
});

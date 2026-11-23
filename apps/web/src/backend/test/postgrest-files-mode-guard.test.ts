import { before, test } from "node:test";
import assert from "node:assert/strict";
import { loadTestCore } from "@/lib/test/load-test-core";
import type { BackendConfig } from "@/backend/parts";
import { wirePostgrestBackend } from "@/backend/providers/postgrest/wire-postgrest-backend";

before(async () => {
  await loadTestCore();
});

const config = {
  provider: "postgrest",
  supabaseUrl: "http://127.0.0.1:9",
  supabaseAnonKey: "test-anon-key",
  dataUrl: "http://127.0.0.1:9",
} as BackendConfig;

const FILES_MODE = { filesMode: true };

/** Records every request URL and refuses it. Installed after the backend is built. */
function spyNetwork() {
  const urls: string[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    urls.push(String(input));
    throw new Error("spied network");
  }) as typeof fetch;
  return { urls, restore: () => (globalThis.fetch = real) };
}

type Wired = ReturnType<typeof wirePostgrestBackend>;
type Call = (fn: unknown, ...args: unknown[]) => Promise<unknown>;
const call: Call = (fn, ...args) => (fn as (...a: unknown[]) => Promise<unknown>)(...args);

/** A signed-in user, so user-scoped repos plan a query instead of returning early. */
const signedIn = { session: { getCurrentUserId: async () => "u-1" } } as never;

/** Personal writes and reads: in files mode every one is refused before any request. */
const personalCalls: [string, (b: Wired) => Promise<unknown>][] = [
  [
    "integrationsStore.save",
    (b) => call(b.integrationsStore.save, "p-1", { provider: "github", enabled: true, branch: "main", repo: "a/b" }),
  ],
  // paper_tags is not in ORG_SERVER_TABLES, so both probes below must be refused in files mode.
  ["paperTagRepository.listAll", (b) => call(b.paperTagRepository.listAll)],
  ["paperTagRepository.listForTag", (b) => call(b.paperTagRepository.listForTag, "t-1")],
  ["paperTagRepository.link", (b) => call(b.paperTagRepository.link, { paperId: "p-1", tagId: "t-1", source: "manual" })],
  ["screeningRepository.listForItems", (b) => call(b.screeningRepository.listForItems, ["i-1"])],
  ["releaseNoticesRepository.latest", (b) => call(b.releaseNoticesRepository.latest)],
  // 0.9.8: the personal repos wired over the client itself are guarded too, not just the five above.
  ["projectRepository.list", (b) => call(b.projectRepository.list)],
  ["paperRepository.getById", (b) => call(b.paperRepository.getById, "i-1")],
  ["tagRepository.list", (b) => call(b.tagRepository.list)],
  ["logEntryRepository.list", (b) => call(b.logEntryRepository.list)],
  ["milestoneRepository.getById", (b) => call(b.milestoneRepository.getById, "i-1")],
  ["experimentRepository.list", (b) => call(b.experimentRepository.list)],
  ["readingListRepository.list", (b) => call(b.readingListRepository.list)],
  ["rawVaultPageRepository.list", (b) => call(b.rawVaultPageRepository.list)],
];

/** The supervisor reads (a supervisee's milestones and logs): personal rows on the server. */
const supervisionCalls: [string, (b: Wired) => Promise<unknown>][] = [
  ["listMilestones", (b) => b.supervisionRepository.listMilestones("m-1")],
  ["listLogs", (b) => b.supervisionRepository.listLogs("m-1")],
  ["listMilestonesFor", (b) => b.supervisionRepository.listMilestonesFor(["m-1"])],
  ["listLogsFor", (b) => b.supervisionRepository.listLogsFor(["m-1"])],
];

for (const [name, run] of supervisionCalls) {
  test(`control: supervisionRepository.${name} reaches PostgREST without files mode`, async () => {
    const wired = wirePostgrestBackend(config, { projectId: null }, () => "p-1", signedIn);
    const spy = spyNetwork();
    try {
      await assert.rejects(run(wired));
      assert.ok(spy.urls.length > 0, "the read must really reach the network, or the files-mode test proves nothing");
    } finally {
      spy.restore();
      wired.dispose();
    }
  });
}

test("files mode: the supervisor reads show nothing and make no network call", async () => {
  const wired = wirePostgrestBackend(config, { projectId: null }, () => "p-1", signedIn, FILES_MODE);
  const spy = spyNetwork();
  try {
    const repo = wired.supervisionRepository;
    assert.deepEqual(await repo.listMilestones("m-1"), []);
    assert.deepEqual(await repo.listLogs("m-1"), []);
    // One empty entry per id asked for, as the interface promises.
    assert.deepEqual([...(await repo.listMilestonesFor(["m-1", "m-2"]))], [["m-1", []], ["m-2", []]]);
    assert.deepEqual([...(await repo.listLogsFor(["m-1"]))], [["m-1", []]]);
    assert.deepEqual([...(await repo.listLogsFor([]))], []);
    assert.deepEqual(spy.urls, [], "a supervisor read must not reach PostgREST in files mode");
  } finally {
    spy.restore();
    wired.dispose();
  }
});

for (const [name, run] of personalCalls) {
  test(`control: ${name} reaches PostgREST without files mode`, async () => {
    const wired = wirePostgrestBackend(config, { projectId: null }, () => "p-1", signedIn);
    const spy = spyNetwork();
    try {
      await assert.rejects(run(wired));
      assert.ok(spy.urls.length > 0, "the call must really reach the network, or the files-mode test proves nothing");
    } finally {
      spy.restore();
      wired.dispose();
    }
  });

  test(`files mode: ${name} throws and makes no network call`, async () => {
    const wired = wirePostgrestBackend(config, { projectId: null }, () => "p-1", signedIn, FILES_MODE);
    const spy = spyNetwork();
    try {
      await assert.rejects(run(wired));
      assert.deepEqual(spy.urls, [], "a refused personal call must not reach PostgREST");
    } finally {
      spy.restore();
      wired.dispose();
    }
  });
}

test("files mode: an org read through the wiring still reaches PostgREST", async () => {
  const wired = wirePostgrestBackend(config, { projectId: null }, () => "p-1", signedIn, FILES_MODE);
  const spy = spyNetwork();
  try {
    await assert.rejects(call(wired.commentRepository.list, "paper", "p-1"));
    assert.ok(
      spy.urls.some((u) => u.includes("/comments")),
      `an allowlisted org read must reach PostgREST; saw ${JSON.stringify(spy.urls)}`,
    );
  } finally {
    spy.restore();
    wired.dispose();
  }
});

test("files mode: shared with me still reads the owner's shared rows through the Rust plan", async () => {
  const wired = wirePostgrestBackend(config, { projectId: null }, () => "p-1", signedIn, FILES_MODE);
  const spy = spyNetwork();
  try {
    // The read reaches PostgREST (the spy refuses it), so it was not stopped by the guard.
    await assert.rejects(call(wired.sharedReader.read, "paper", ["i-1"], ["owner"]), (e: { message?: string }) =>
      String(e.message).includes("spied network"),
    );
    // PostgREST may retry the refused fetch; every attempt is the same shared read.
    assert.ok(spy.urls.length > 0, "the shared read must reach PostgREST");
    for (const u of spy.urls) {
      const url = new URL(u);
      assert.match(url.pathname, /\/papers$/);
      assert.equal(url.searchParams.get("or"), "(id.in.(i-1),user_id.in.(owner))");
    }
  } finally {
    spy.restore();
    wired.dispose();
  }
});

test("files mode: the paper table stays refused outside the shared read", async () => {
  const wired = wirePostgrestBackend(config, { projectId: null }, () => "p-1", signedIn, FILES_MODE);
  const spy = spyNetwork();
  try {
    assert.throws(() => wired.db.from("papers"), /not allowed on the org server/);
    assert.deepEqual(spy.urls, []);
  } finally {
    spy.restore();
    wired.dispose();
  }
});
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

/** Personal writes (and personal reads) through the five repos wired over the raw db. */
const personalCalls: [string, (b: Wired) => Promise<unknown>][] = [
  [
    "integrationsStore.save",
    (b) => call(b.integrationsStore.save, "p-1", { provider: "github", enabled: true, branch: "main", repo: "a/b" }),
  ],
  ["projectBibliographyCollection.setCollection", (b) => call(b.projectBibliographyCollection.setCollection, "p-1", "Lib")],
  ["screeningRepository.listForItems", (b) => call(b.screeningRepository.listForItems, ["i-1"])],
  ["sharedReader.read", (b) => call(b.sharedReader.read, "paper", ["i-1"], ["owner"])],
  ["releaseNoticesRepository.unseen", (b) => call(b.releaseNoticesRepository.unseen)],
];

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

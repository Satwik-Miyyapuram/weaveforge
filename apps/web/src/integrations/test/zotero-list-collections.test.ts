import { test } from "node:test";
import assert from "node:assert/strict";
import type { ISettingsRepository, UserSettings } from "@weaveforge/core";
import { ZoteroBibliographyIntegration } from "../providers/zotero/bibliography-integration";

function integrationWith(stored: UserSettings, fetchFn: typeof fetch) {
  const settings: ISettingsRepository = {
    get: async () => stored,
    save: async () => {},
  } as unknown as ISettingsRepository;

  return new ZoteroBibliographyIntegration({
    librarySync: { sync: async () => ({ pushed: 0, pulled: 0, deletedLocal: 0 }) },
    exporter: { save: async () => undefined, remove: async () => {} },
    annotations: { pullAll: async () => new Map() },
    papers: { list: async () => [], save: async () => {} } as never,
    tags: {} as never,
    settings,
    fetchFn,
  });
}

function collectionsResponse(names: string[]) {
  const requested: string[] = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    requested.push(String(input));
    void init;
    return new Response(
      JSON.stringify(names.map((name, i) => ({ data: { key: `K${i}`, name } }))),
      { status: 200 },
    );
  }) as unknown as typeof fetch;
  return { fetchFn, requested };
}

test("collections list from the credentials being typed, before anything is saved", async () => {
  // The whole point: with nothing stored, the picker still fills in.
  const { fetchFn, requested } = collectionsResponse(["Thesis", "To read"]);
  const integration = integrationWith({}, fetchFn);

  const collections = await integration.listCollections({
    apiKey: "typed-key",
    library: "users/999",
  });

  assert.deepEqual(collections.map((c) => c.name), ["Thesis", "To read"]);
  assert.ok(requested[0]!.includes("/users/999/collections"), requested[0]);
});

test("a bare user id is accepted, because that is what Zotero shows you", async () => {
  const { fetchFn, requested } = collectionsResponse(["Thesis"]);
  const integration = integrationWith({}, fetchFn);

  await integration.listCollections({ apiKey: "k", library: "123456" });

  assert.ok(requested[0]!.includes("/users/123456/collections"), requested[0]);
});

test("typed credentials win over stored ones", async () => {
  const { fetchFn, requested } = collectionsResponse(["Thesis"]);
  const integration = integrationWith(
    { integrations: { zotero: { apiKey: "old", library: "users/111" } } } as UserSettings,
    fetchFn,
  );

  await integration.listCollections({ apiKey: "new", library: "users/222" });

  assert.ok(requested[0]!.includes("/users/222/"), `stale stored library was used: ${requested[0]}`);
});

test("no credentials falls back to what was saved", async () => {
  const { fetchFn, requested } = collectionsResponse(["Thesis"]);
  const integration = integrationWith(
    { integrations: { zotero: { apiKey: "stored", library: "users/111" } } } as UserSettings,
    fetchFn,
  );

  await integration.listCollections();

  assert.ok(requested[0]!.includes("/users/111/"), requested[0]);
});

test("an unusable library asks Zotero nothing", async () => {
  const { fetchFn, requested } = collectionsResponse(["Thesis"]);
  const integration = integrationWith({}, fetchFn);

  assert.deepEqual(await integration.listCollections({ apiKey: "k", library: "not-a-library" }), []);
  assert.deepEqual(await integration.listCollections({ apiKey: "", library: "users/1" }), []);
  assert.deepEqual(requested, []);
});

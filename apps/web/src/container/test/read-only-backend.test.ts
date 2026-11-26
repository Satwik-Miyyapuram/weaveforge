import assert from "node:assert/strict";
import { before, test } from "node:test";

import { ManageSettingsUseCase } from "@weaveforge/core";
import { systemClock } from "@/lib/parts";
import { loadTestCore } from "@/lib/test/load-test-core";
import { READ_ONLY_KEYS, READ_ONLY_MESSAGE, READ_ONLY_METHODS, readOnlyBackend, readOnlyBlobStore } from "../read-only-repositories";

before(loadTestCore);

test("readOnlyBackend wraps every personal key, alias and the settings use case, by explicit list", async () => {
  const bag: Record<string, unknown> = { config: { x: 1 }, shareRepository: { save: () => "live" } };
  for (const key of READ_ONLY_KEYS) {
    if (key === "manageSettings") continue;
    const repo: Record<string, () => unknown> = { save: () => "w" };
    for (const read of READ_ONLY_METHODS[key] ?? []) repo[read] = () => ["a"];
    bag[key] = repo;
  }
  const out = readOnlyBackend(bag) as Record<string, Record<string, () => unknown>>;
  for (const key of READ_ONLY_KEYS) {
    if (key === "manageSettings") continue;
    const repo = out[key] as { save: () => unknown } & Record<string, () => unknown>;
    await assert.rejects(async () => repo.save(), new RegExp(READ_ONLY_MESSAGE), key);
    for (const read of READ_ONLY_METHODS[key] ?? []) assert.deepEqual((repo[read] as () => unknown)(), ["a"], `${key}.${read} reads pass`);
  }
  assert.equal((out.shareRepository as unknown as { save: () => unknown }).save(), "live", "org keys are not in the explicit list");
  assert.equal(out.config, bag.config);
});

test("the explicit list names the settings, credential and Zotero keys", () => {
  for (const key of [
    "settingsRepository",
    "manageSettings",
    "integrationsStore",
    "projectBibliographyCollection",
    "bibliographyCollectionStore",
    "annotationQuotationTypeRepository",
    "screeningRepository",
  ]) {
    assert.equal(READ_ONLY_KEYS.has(key), true, `${key} must be read-only`);
  }
});

test("readOnlyBackend refuses settings, credential and Zotero writes through the rebuilt use case", async () => {
  const writes: unknown[] = [];
  const repo = {
    get: () => Promise.resolve({}),
    getMetadata: () => Promise.resolve({}),
    save: (settings: unknown) => {
      writes.push(settings);
      return Promise.resolve();
    },
    saveDisclaimer: (acceptedAt: string) => {
      writes.push(acceptedAt);
      return Promise.resolve();
    },
  };
  const live = new ManageSettingsUseCase({ repository: repo, clock: systemClock });
  const out = readOnlyBackend({ settingsRepository: repo, manageSettings: live });
  await assert.rejects(out.manageSettings.save({ zoteroApiKey: "key" }), new RegExp(READ_ONLY_MESSAGE));
  await assert.rejects(out.manageSettings.save({ disclaimerAcceptedAt: "2026-11-22" }), new RegExp(READ_ONLY_MESSAGE));
  assert.deepEqual(writes, [], "nothing reaches the settings repository");
});

test("readOnlyBackend refuses repository writes and leaves the database reads alone", async () => {
  const repo = { list: () => ["a"], save: () => "written" };
  const bag = {
    paperRepository: repo,
    db: { from: (_table: string) => ({ select: (..._args: unknown[]) => "rows" }) },
  };
  const out = readOnlyBackend(bag);
  assert.deepEqual(out.paperRepository.list(), ["a"]);
  await assert.rejects(async () => out.paperRepository.save(), new RegExp(READ_ONLY_MESSAGE));
  assert.equal(out.db.from("papers").select(), "rows", "db reads still pass");
});

/** A blob store that records every call; the extra read method stands in for fetchBytes. */
function recordingBlobStore() {
  const calls: string[] = [];
  const store = {
    upload: async (bucket: string, path: string, _blob: Blob) => void calls.push(`upload ${bucket}/${path}`),
    remove: async (bucket: string, path: string) => void calls.push(`remove ${bucket}/${path}`),
    signedUrls: async (bucket: string, paths: string[], _ttl: number) => paths.map((p) => `signed:${bucket}/${p}`),
    fetchBytes: async (bucket: string, path: string) => `bytes:${bucket}/${path}`,
  };
  return { store, calls };
}

test("readOnlyBackend refuses rawBlobStore uploads and removes: the HTTP blob store bypasses the db guard", async () => {
  const { store, calls } = recordingBlobStore();
  const out = readOnlyBackend({ rawBlobStore: store });
  await assert.rejects(out.rawBlobStore.upload("paper-images", "u1/a.webp", new Blob(["x"])), new RegExp(READ_ONLY_MESSAGE));
  await assert.rejects(out.rawBlobStore.remove("vault-assets", "u1/b.png"), new RegExp(READ_ONLY_MESSAGE));
  assert.deepEqual(calls, [], "no write or delete reaches the blob store");
  assert.deepEqual(await out.rawBlobStore.signedUrls("paper-images", ["a"], 60), ["signed:paper-images/a"], "signing still passes");
  assert.equal(await out.rawBlobStore.fetchBytes("paper-images", "a"), "bytes:paper-images/a", "reads still pass");
});

test("readOnlyBlobStore lets an org-server bucket write and refuses every other bucket", async () => {
  const { store, calls } = recordingBlobStore();
  const guarded = readOnlyBlobStore(store, ["shared"]);
  await guarded.upload("shared", "o1/a", new Blob(["x"]));
  await guarded.remove("shared", "o1/a");
  await assert.rejects(guarded.upload("log-images", "u1/a", new Blob(["x"])), new RegExp(READ_ONLY_MESSAGE));
  assert.deepEqual(calls, ["upload shared/o1/a", "remove shared/o1/a"]);
});

test("readOnlyBlobStore keeps a class store's private fields and prototype methods working", async () => {
  class PrivateStore {
    #base = "https://blobs.test";
    async signedUrls(bucket: string, paths: string[]) {
      return paths.map((p) => this.url(bucket, p));
    }
    async upload(_bucket: string, _path: string) {
      return this.#base;
    }
    url(bucket: string, path: string) {
      return `${this.#base}/${bucket}/${path}`;
    }
  }
  const guarded = readOnlyBlobStore(new PrivateStore(), ["shared"]);
  assert.deepEqual(await guarded.signedUrls("paper-images", ["a"]), ["https://blobs.test/paper-images/a"]);
  assert.equal(await guarded.upload("shared", "o1/a"), "https://blobs.test");
  await assert.rejects(guarded.upload("paper-images", "u1/a"), new RegExp(READ_ONLY_MESSAGE));
});

test("readOnlyBackend leaves a backend without a blob store alone", () => {
  const out = readOnlyBackend({ config: 1 }) as Record<string, unknown>;
  assert.equal("rawBlobStore" in out, false);
});
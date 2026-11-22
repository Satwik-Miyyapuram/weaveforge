import { before, test } from "node:test";
import assert from "node:assert/strict";
import { CURRENT_DISCLAIMER_VERSION } from "@weaveforge/core";
import type { Secrets, SecretsStore } from "@/features/settings/infrastructure/parts";
import { loadTestCore } from "@/lib/test/load-test-core";
import {
  FileBibliographyCollectionStore,
  FileDashboardLayoutRepository,
  FileGraphSettingsRepository,
  FileQuotationTypeRepository,
  FileSettingsRepository,
} from "../file-settings-repos";
import { MemorySettings } from "./memory-settings";

before(loadTestCore);

class MemorySecrets implements SecretsStore {
  value: Secrets = {};
  load(): Promise<Secrets> {
    return Promise.resolve({ ...this.value });
  }
  save(secrets: Secrets): Promise<void> {
    this.value = { ...secrets };
    return Promise.resolve();
  }
}

type Layout = Parameters<FileDashboardLayoutRepository["save"]>[1];
type GraphState = Parameters<FileGraphSettingsRepository["save"]>[1];

test("T4: dashboard layout and graph state round-trip per project; save replaces", async () => {
  const settings = new MemorySettings();
  const dashboard = new FileDashboardLayoutRepository(settings);
  const graph = new FileGraphSettingsRepository(settings);
  assert.equal(await dashboard.get("p1"), null);
  assert.equal(await graph.get("p1"), null);
  const layout = { widgets: [{ id: "w", kind: "ünïcode" }] } as unknown as Layout;
  const second = { widgets: [] } as unknown as Layout;
  await dashboard.save("p1", layout);
  assert.deepEqual(await dashboard.get("p1"), layout);
  await dashboard.save("p1", second);
  assert.deepEqual(await dashboard.get("p1"), second);
  assert.equal(await dashboard.get("p2"), null);
  const state = { layout: "force", zoom: 1.5 } as unknown as GraphState;
  await graph.save("p1", state);
  assert.deepEqual(await graph.get("p1"), state);
  assert.deepEqual(settings.doc, { dashboard: { p1: second }, graph: { p1: state } });
});

test("T4: quotation types round-trip per paper and annotation; save keeps createdAt; remove drops one", async () => {
  const settings = new MemorySettings();
  const repo = new FileQuotationTypeRepository(settings);
  assert.deepEqual(await repo.listForPaper("a"), []);
  const first = await repo.save({ paperId: "a", annotationKey: "K1", quotationType: "direct" });
  assert.equal(first.id, "a:K1");
  assert.equal(first.quotationType, "direct");
  assert.equal(first.createdAt, first.updatedAt);
  await new Promise((r) => setTimeout(r, 2));
  const again = await repo.save({ paperId: "a", annotationKey: "K1", quotationType: "summary" });
  assert.equal(again.createdAt, first.createdAt);
  assert.notEqual(again.updatedAt, first.updatedAt);
  await repo.save({ paperId: "a", annotationKey: "ü2", quotationType: "paraphrase" });
  await repo.save({ paperId: "b", annotationKey: "K1", quotationType: "direct" });
  assert.deepEqual((await repo.listForPaper("a")).map((q) => [q.annotationKey, q.quotationType]), [
    ["K1", "summary"],
    ["ü2", "paraphrase"],
  ]);
  await repo.remove("a", "K1");
  await repo.remove("a", "missing");
  assert.deepEqual((await repo.listForPaper("a")).map((q) => q.id), ["a:ü2"]);
  assert.equal((await repo.listForPaper("b")).length, 1);
});

test("a hand-edited quotation type with an unknown kind is not listed", async () => {
  const settings = new MemorySettings();
  settings.doc = { quotationTypes: { a: { K: { type: "quote" }, L: { type: "direct" } } } };
  const listed = await new FileQuotationTypeRepository(settings).listForPaper("a");
  assert.deepEqual(listed, [{ id: "a:L", paperId: "a", annotationKey: "L", quotationType: "direct", createdAt: "", updatedAt: "" }]);
});

test("T4: the bibliography collection round-trips per project; null clears it", async () => {
  const settings = new MemorySettings();
  const store = new FileBibliographyCollectionStore(settings);
  assert.equal(await store.getCollection("p1"), undefined);
  await store.setCollection("p1", "ABCD1234");
  assert.equal(await store.getCollection("p1"), "ABCD1234");
  assert.equal(await store.getCollection("p2"), undefined);
  await store.setCollection("p1", null);
  assert.equal(await store.getCollection("p1"), undefined);
});

test("T4: user settings round-trip; secrets go to the secrets store and never into the file", async () => {
  const settings = new MemorySettings();
  const secrets = new MemorySecrets();
  const repo = new FileSettingsRepository(settings, secrets);
  assert.deepEqual(await repo.get(), {});
  await repo.save({
    zoteroApiKey: "SECRET-zotero",
    semanticScholarKey: "SECRET-s2",
    integrations: { zotero: { apiKey: "SECRET-bag" } },
    zoteroLibrary: "users/123",
    appearance: { mode: "dark" } as never,
  });
  const text = JSON.stringify(settings.doc);
  assert.doesNotMatch(text, /SECRET/);
  assert.equal(secrets.value.zoteroApiKey, "SECRET-zotero");
  assert.deepEqual(secrets.value.integrations, { zotero: { apiKey: "SECRET-bag" } });
  const got = await repo.get();
  assert.equal(got.zoteroApiKey, "SECRET-zotero");
  assert.equal(got.semanticScholarKey, "SECRET-s2");
  assert.equal(got.zoteroLibrary, "users/123");
  assert.equal(got.appearance?.mode, "dark");
});

test("disclaimer, appearance merge and the dismissed notice; save keeps an unset disclaimer", async () => {
  const settings = new MemorySettings();
  const repo = new FileSettingsRepository(settings, new MemorySecrets());
  await repo.saveDisclaimer("2026-01-01T00:00:00.000Z", 3);
  assert.deepEqual(await repo.getMetadata(), { disclaimerAcceptedAt: "2026-01-01T00:00:00.000Z", disclaimerVersion: 3 });
  await repo.save({ zoteroLibrary: "groups/9" });
  assert.equal((await repo.getMetadata()).disclaimerVersion, 3);
  await repo.acceptDisclaimer();
  assert.equal((await repo.getMetadata()).disclaimerVersion, CURRENT_DISCLAIMER_VERSION);
  await repo.saveAppearance({ mode: "light" } as never);
  await repo.saveAppearance({ darkTheme: "dracula" } as never);
  const appearance = (await repo.getMetadata()).appearance as Record<string, unknown>;
  assert.equal(appearance.mode, "light");
  assert.equal(appearance.darkTheme, "dracula");
  assert.equal((await repo.get()).zoteroLibrary, "groups/9");
  await repo.saveNoticeSeen("1.2.0");
  assert.equal(repo.noticeSeen(), "1.2.0");
  await assert.rejects(repo.saveNoticeSeen(""));
});

test("a failed secrets read fails get, so a save cannot wipe stored keys", async () => {
  const failing: SecretsStore = { load: () => Promise.reject(new Error("keychain locked")), save: () => Promise.resolve() };
  await assert.rejects(new FileSettingsRepository(new MemorySettings(), failing).get(), /keychain locked/);
});

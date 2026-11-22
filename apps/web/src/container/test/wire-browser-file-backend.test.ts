import { before, test } from "node:test";
import assert from "node:assert/strict";
import type { Paper, VaultPage } from "@weaveforge/core";
import { MemoryWorkspaceFs } from "@core-test/memory-workspace-fs";
import { loadTestCore } from "@/lib/test/load-test-core";
import { wireFileBackend } from "@/backend/providers/files/wire-file-backend";
import { RefusingSecretsStore } from "@/backend/providers/files/refusing-secrets-store";
import { openFileSettingsSection } from "@/backend/providers/files/file-settings-section";

before(async () => {
  await loadTestCore();
});

/** The workspace folder is the root of the memory fs, so repository paths start at "". */
const ROOT = "";

function wiredOver(fs: MemoryWorkspaceFs) {
  return openFileSettingsSection(fs, ROOT).then((settings) =>
    wireFileBackend({ fs, settings, secrets: new RefusingSecretsStore() }),
  );
}

function note(overrides: Partial<VaultPage> = {}): VaultPage {
  return {
    id: "n-1",
    title: "Literature plan",
    body: "Start with the survey.",
    sortOrder: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function paper(overrides: Partial<Paper> = {}): Paper {
  return {
    id: "p-1",
    title: "Attention Is All You Need",
    authors: ["Vaswani"],
    status: "to_read",
    tags: [],
    metadata: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

test("a note round-trips through the OPFS-style workspace folder", async () => {
  const fs = new MemoryWorkspaceFs();
  const wired = await wiredOver(fs);
  await wired.rawVaultPageRepository.save(note());
  assert.deepEqual(await wired.rawVaultPageRepository.getById("n-1"), note());
  assert.deepEqual(
    (await wired.rawVaultPageRepository.list({})).map((n) => n.id),
    ["n-1"],
  );
  const files: string[] = [];
  for await (const entry of fs.walk("notes")) files.push(entry.path);
  assert.equal(files.length, 1, `one note file, got ${files.join(", ")}`);
});

test("a paper round-trips through the OPFS-style workspace folder", async () => {
  const wired = await wiredOver(new MemoryWorkspaceFs());
  const p = paper({ doi: "10.1/x", year: 2017 });
  await wired.paperRepository.save(p);
  assert.deepEqual(await wired.paperRepository.getById("p-1"), p);
  assert.deepEqual(
    (await wired.paperRepository.list()).map((x) => x.id),
    ["p-1"],
  );
});

test("settings persist to .weaveforge/settings.json and reload from it", async () => {
  const fs = new MemoryWorkspaceFs();
  const first = await openFileSettingsSection(fs, ROOT);
  first.set(["appearance", "theme"], "crt");
  await first.flush();
  const raw = await fs.readText(".weaveforge/settings.json");
  assert.equal(JSON.parse(raw).appearance.theme, "crt");
  const second = await openFileSettingsSection(fs, ROOT);
  assert.equal(second.get(["appearance", "theme"]), "crt");
});

test("every Secrets field name is refused as a path segment and as a value key", async () => {
  const settings = await openFileSettingsSection(new MemoryWorkspaceFs(), ROOT);
  for (const field of ["zoteroApiKey", "semanticScholarKey", "integrations"]) {
    assert.throws(() => settings.set([field], "x"), /secret/, `path ${field}`);
    assert.throws(() => settings.set(["prefs"], { [field]: "x" }), /secret/, `value key ${field}`);
  }
});

test("secret-looking names are refused at any depth, including inside arrays and nested objects", async () => {
  const settings = await openFileSettingsSection(new MemoryWorkspaceFs(), ROOT);
  assert.throws(() => settings.set(["integrations"], { zoteroApiKey: "abc" }), /secret/);
  assert.throws(() => settings.set(["a"], { b: { c: [{ accessToken: "x" }] } }), /secret/);
  assert.throws(() => settings.set(["a"], { b: { sessionCookie: "x" } }), /secret/);
  assert.throws(() => settings.set(["a"], { refreshValue: "x" }), /secret/);
  assert.throws(() => settings.set(["a"], { bearer: "x" }), /secret/);
  assert.throws(() => settings.set(["a"], { password: "x" }), /secret/);
  assert.throws(() => settings.set(["a"], { privateKey: "x" }), /secret/);
});

test("ids in path segments never throw, and author metadata stays legal", async () => {
  const settings = await openFileSettingsSection(new MemoryWorkspaceFs(), ROOT);
  assert.doesNotThrow(() => settings.set(["dashboard", "paperId"], { layout: [] }));
  assert.doesNotThrow(() => settings.set(["pins", "annotationKey"], 1));
  assert.doesNotThrow(() => settings.set(["paper", "p-1", "authors"], ["Vaswani"]));
  assert.doesNotThrow(() => settings.set(["paper", "author"], "x"));
});

test("a crash while writing keeps the previous settings.json", async () => {
  const fs = new MemoryWorkspaceFs();
  const first = await openFileSettingsSection(fs, ROOT);
  first.set(["appearance", "theme"], "light");
  await first.flush();

  const crashing = new Proxy(fs, {
    get(target, key) {
      if (key === "rename") return async () => { throw new Error("power cut"); };
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as MemoryWorkspaceFs;
  const second = await openFileSettingsSection(crashing, ROOT);
  // set() returns the write's own promise: it must be awaited here, or its rejection is unhandled.
  await assert.rejects(second.set(["appearance", "theme"], "crt"), /power cut/);
  await assert.rejects(second.flush(), /power cut/);

  const after = await openFileSettingsSection(fs, ROOT);
  assert.equal(after.get(["appearance", "theme"]), "light");
});

test("get returns a copy, so mutating it cannot change the stored settings", async () => {
  const settings = await openFileSettingsSection(new MemoryWorkspaceFs(), ROOT);
  settings.set(["ui", "pins"], ["a"]);
  (settings.get(["ui", "pins"]) as string[]).push("b");
  assert.deepEqual(settings.get(["ui", "pins"]), ["a"]);
});

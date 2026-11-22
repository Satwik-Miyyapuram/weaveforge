import { before, test } from "node:test";
import assert from "node:assert/strict";
import type { Paper, VaultPage } from "@weaveforge/core";
import { MemoryWorkspaceFs } from "@core-test/memory-workspace-fs";
import { loadTestCore } from "@/lib/test/load-test-core";
import { wireBrowserFileBackend } from "../wire-browser-file-backend";
import { openFileSettingsSection } from "@/backend/providers/files/file-settings-section";

before(async () => {
  await loadTestCore();
});

const ROOT = "thesis";

/** Stands in for the server database: every property read and call is recorded. */
function serverSpy() {
  const calls: string[] = [];
  const db: unknown = new Proxy(function () {}, {
    get(_t, prop) {
      calls.push(String(prop));
      return db;
    },
    apply() {
      calls.push("(call)");
      return db;
    },
  });
  return { db, calls };
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

test("personal kinds (notes, papers, tags, paper fields, settings) make zero server calls", async () => {
  const server = serverSpy();
  const fs = new MemoryWorkspaceFs();
  const wired = await wireBrowserFileBackend(fs, server.db, ROOT);
  await wired.notes.save(note());
  await wired.notes.list({});
  await wired.papers.save(paper());
  await wired.papers.list();
  await wired.tags.list();
  await wired.tags.listWithCounts();
  await wired.paperFields.listDefs();
  await wired.paperFields.listValuesForProject();
  wired.settings.set(["ui", "zoom"], 1.25);
  wired.settings.get(["ui", "zoom"]);
  await wired.settings.flush();
  assert.deepEqual(server.calls, [], "no personal-table call may reach the server");
});

test("org and share data is handed back as the server database, untouched", async () => {
  const server = serverSpy();
  const wired = await wireBrowserFileBackend(new MemoryWorkspaceFs(), server.db, ROOT);
  assert.equal(wired.orgDb, server.db);
  assert.deepEqual(server.calls, [], "wiring itself must not call the server");
});

test("a note round-trips through the OPFS-style workspace folder", async () => {
  const fs = new MemoryWorkspaceFs();
  const wired = await wireBrowserFileBackend(fs, serverSpy().db, ROOT);
  await wired.notes.save(note());
  assert.deepEqual(await wired.notes.getById("n-1"), note());
  assert.deepEqual(
    (await wired.notes.list({})).map((n) => n.id),
    ["n-1"],
  );
  const files: string[] = [];
  for await (const entry of fs.walk(`${ROOT}/notes`)) files.push(entry.path);
  assert.equal(files.length, 1, `one note file, got ${files.join(", ")}`);
});

test("a paper round-trips through the OPFS-style workspace folder", async () => {
  const fs = new MemoryWorkspaceFs();
  const wired = await wireBrowserFileBackend(fs, serverSpy().db, ROOT);
  const p = paper({ doi: "10.1/x", year: 2017 });
  await wired.papers.save(p);
  assert.deepEqual(await wired.papers.getById("p-1"), p);
  assert.deepEqual(
    (await wired.papers.list()).map((x) => x.id),
    ["p-1"],
  );
});

test("settings persist to .weaveforge/settings.json and reload from it", async () => {
  const fs = new MemoryWorkspaceFs();
  const first = await openFileSettingsSection(fs, ROOT);
  first.set(["appearance", "theme"], "crt");
  await first.flush();
  const raw = await fs.readText(`${ROOT}/.weaveforge/settings.json`);
  assert.equal(JSON.parse(raw).appearance.theme, "crt");
  const second = await openFileSettingsSection(fs, ROOT);
  assert.equal(second.get(["appearance", "theme"]), "crt");
});

test("every Secrets field name is refused as a path segment and as a value key", async () => {
  const fs = new MemoryWorkspaceFs();
  const settings = await openFileSettingsSection(fs, ROOT);
  for (const field of ["zoteroApiKey", "semanticScholarKey", "integrations"]) {
    assert.throws(() => settings.set([field], "x"), /secret/, `path ${field}`);
    assert.throws(() => settings.set(["prefs"], { [field]: "x" }), /secret/, `value key ${field}`);
  }
});

test("secret-looking names are refused at any depth, including inside arrays and nested objects", async () => {
  const fs = new MemoryWorkspaceFs();
  const settings = await openFileSettingsSection(fs, ROOT);
  assert.throws(() => settings.set(["integrations"], { zoteroApiKey: "abc" }), /secret/);
  assert.throws(() => settings.set(["a"], { b: { c: [{ accessToken: "x" }] } }), /secret/);
  assert.throws(() => settings.set(["a"], { b: { sessionCookie: "x" } }), /secret/);
  assert.throws(() => settings.set(["a"], { refreshValue: "x" }), /secret/);
  assert.throws(() => settings.set(["a"], { bearer: "x" }), /secret/);
  assert.throws(() => settings.set(["a"], { password: "x" }), /secret/);
  assert.throws(() => settings.set(["a"], { privateKey: "x" }), /secret/);
});

test("ids in path segments never throw, and author metadata stays legal", async () => {
  const fs = new MemoryWorkspaceFs();
  const settings = await openFileSettingsSection(fs, ROOT);
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
  second.set(["appearance", "theme"], "crt");
  await assert.rejects(second.flush(), /power cut/);

  const after = await openFileSettingsSection(fs, ROOT);
  assert.equal(after.get(["appearance", "theme"]), "light");
});

test("get returns a copy, so mutating it cannot change the stored settings", async () => {
  const fs = new MemoryWorkspaceFs();
  const settings = await openFileSettingsSection(fs, ROOT);
  settings.set(["ui", "pins"], ["a"]);
  (settings.get(["ui", "pins"]) as string[]).push("b");
  assert.deepEqual(settings.get(["ui", "pins"]), ["a"]);
});

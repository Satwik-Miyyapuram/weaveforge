// Tests for the docs demo bridge (demo-bridge.js): it runs in the browser, so
// these load it into a node:vm context with stub globals and call window.weaveforge.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const SEED_AT = "2026-03-04T05:06:07.000Z";

function loadBridge(files) {
  const g = {};
  g.window = g;
  g.parent = g;
  g.location = { search: "", pathname: "/", href: "http://docs.test/", hash: "" };
  g.history = { state: null, replaceState() {} };
  g.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  g.document = {
    currentScript: null,
    activeElement: null,
    documentElement: { dataset: {} },
    body: { appendChild() {} },
    querySelector: () => ({}),
    querySelectorAll: () => [],
    createElement: () => ({ style: {}, dataset: {} }),
  };
  g.addEventListener = () => {};
  g.TextEncoder = TextEncoder;
  g.TextDecoder = TextDecoder;
  g.URL = URL;
  g.URLSearchParams = URLSearchParams;
  g.fetch = async () => ({ json: async () => ({ files }) });
  const ctx = vm.createContext(g);
  const src = readFileSync(path.join(here, "demo-bridge.js"), "utf8");
  vm.runInContext(src, ctx);
  return g.weaveforge;
}

const seeded = () => ({
  "notes/a.md": { text: "alpha", modifiedAt: SEED_AT },
  "notes/deep/b.md": { text: "beta", modifiedAt: SEED_AT },
  "c.md": { text: "gamma", modifiedAt: SEED_AT },
});

test("list and stat report the seeded modifiedAt, the same on every call", async () => {
  const bridge = loadBridge(seeded());
  const first = await bridge.listVaultFiles("");
  await new Promise((r) => setTimeout(r, 15));
  const second = await bridge.listVaultFiles("");
  assert.deepEqual(first, second);
  const file = first.find((e) => e.path === "c.md");
  assert.equal(file.modifiedAt, SEED_AT);
  const stat = await bridge.statVaultFile("notes/a.md");
  assert.equal(stat.modifiedAt, SEED_AT);
  assert.deepEqual(await bridge.statVaultFile("notes/a.md"), stat);
});

test("an entry without modifiedAt gets one stamp that does not change between calls", async () => {
  const bridge = loadBridge({ "x.md": { text: "x" } });
  const a = await bridge.statVaultFile("x.md");
  await new Promise((r) => setTimeout(r, 15));
  const b = await bridge.statVaultFile("x.md");
  assert.equal(a.modifiedAt, b.modifiedAt);
});

test("a write keeps one stamp across list and stat", async () => {
  const bridge = loadBridge(seeded());
  await bridge.writeVaultFile("notes/new.md", "fresh");
  const stat = await bridge.statVaultFile("notes/new.md");
  await new Promise((r) => setTimeout(r, 15));
  const listed = (await bridge.listVaultFiles("notes")).find((e) => e.path === "notes/new.md");
  assert.equal(listed.modifiedAt, stat.modifiedAt);
  assert.equal(stat.modifiedAt, (await bridge.statVaultFile("notes/new.md")).modifiedAt);
});

test("renameVaultFile moves one file", async () => {
  const bridge = loadBridge(seeded());
  await bridge.renameVaultFile("c.md", "d.md");
  assert.equal(await bridge.readVaultFile("c.md"), null);
  assert.equal(await bridge.readVaultFile("d.md"), "gamma");
});

test("renameVaultFile moves a directory prefix with its contents", async () => {
  const bridge = loadBridge(seeded());
  await bridge.renameVaultFile("notes", "archive");
  assert.equal(await bridge.readVaultFile("notes/a.md"), null);
  assert.equal(await bridge.readVaultFile("archive/a.md"), "alpha");
  assert.equal(await bridge.readVaultFile("archive/deep/b.md"), "beta");
});

test("renameVaultFile replaces a file at the destination", async () => {
  const bridge = loadBridge(seeded());
  await bridge.renameVaultFile("notes/a.md", "c.md");
  assert.equal(await bridge.readVaultFile("c.md"), "alpha");
  assert.equal(await bridge.readVaultFile("notes/a.md"), null);
});

test("renameVaultFile rejects a missing source", async () => {
  const bridge = loadBridge(seeded());
  await assert.rejects(bridge.renameVaultFile("nope.md", "x.md"), /nope\.md/);
  assert.equal(await bridge.readVaultFile("c.md"), "gamma");
});

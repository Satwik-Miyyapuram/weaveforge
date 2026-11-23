/**
 * Smoke test for the docs demo bridge (scripts/user-docs/demo-bridge.js) through
 * DesktopWorkspaceFs, the same adapter the desktop shell uses. The bridge is a
 * browser script, so it is loaded into a node:vm context with stub globals; no
 * demo build runs. Covers list, read, write and rename.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { before, test } from "node:test";
import { fileURLToPath } from "node:url";

import { loadTestCore } from "@/lib/test/load-test-core";
import { DesktopWorkspaceFs, type VaultFileBridge } from "../infrastructure/parts";

const here = path.dirname(fileURLToPath(import.meta.url));
// test -> workspace -> features -> src -> web -> apps -> repo root
const BRIDGE = path.join(here, "../../../../../../scripts/user-docs/demo-bridge.js");
const SEED_AT = "2026-03-04T05:06:07.000Z";

function loadBridge(files: Record<string, { text: string; modifiedAt: string }>): VaultFileBridge {
  const g: Record<string, unknown> = {};
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
  vm.runInContext(readFileSync(BRIDGE, "utf8"), ctx);
  return g.weaveforge as VaultFileBridge;
}

before(async () => {
  // safeWorkspacePath runs in the Rust core.
  await loadTestCore();
});

test("DesktopWorkspaceFs lists, reads, writes and renames through the demo bridge", async () => {
  const fs = new DesktopWorkspaceFs(
    loadBridge({
      "notes/a.md": { text: "alpha", modifiedAt: SEED_AT },
      "c.md": { text: "gamma", modifiedAt: SEED_AT },
    }),
  );

  // list
  // Array.from copies out of the vm realm, so deepStrictEqual sees plain arrays.
  const root = Array.from(await fs.list(""), (e) => e.path).sort();
  assert.deepEqual(root, ["c.md", "notes"]);
  const inNotes = await fs.list("notes");
  assert.deepEqual(Array.from(inNotes, (e) => [e.path, e.kind]), [["notes/a.md", "file"]]);
  assert.equal(inNotes[0]!.modifiedAt, SEED_AT);

  // read
  assert.equal(await fs.readText("notes/a.md"), "alpha");

  // write, then read back and see it in the listing
  await fs.writeFile("notes/new.md", "fresh");
  assert.equal(await fs.readText("notes/new.md"), "fresh");
  assert.ok((await fs.list("notes")).some((e) => e.path === "notes/new.md"));

  // rename a file, then a folder
  await fs.rename("c.md", "d.md");
  await assert.rejects(fs.readText("c.md"));
  assert.equal(await fs.readText("d.md"), "gamma");
  await fs.rename("notes", "archive");
  assert.equal(await fs.readText("archive/a.md"), "alpha");
  assert.equal(await fs.readText("archive/new.md"), "fresh");
  await assert.rejects(fs.readText("notes/a.md"));
});

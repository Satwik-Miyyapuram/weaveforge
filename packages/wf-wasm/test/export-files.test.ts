import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initSync } from "../src/index.js";
import { exportAssetPath, exportManifestJson, exportReadme } from "../src/index.js";
import type { ExportStats } from "../src/bindings.js";

const pkgDir = new URL("../pkg/", import.meta.url);
initSync({ module: readFileSync(new URL("wf_wasm_bg.wasm", pkgDir)) });

const stats: ExportStats = {
  notes: 2,
  papers: 3,
  readingLists: 1,
  reportSections: 0,
  experiments: 4,
  milestones: 5,
  logEntries: 6,
  relations: 7,
  tags: 8,
};

test("the manifest is JSON with the schema, app, encryption and camelCase stats", () => {
  const manifest = JSON.parse(exportManifestJson("2026-11-10T00:00:00Z", stats));
  assert.equal(manifest.schemaVersion, 3);
  assert.equal(manifest.exportedAt, "2026-11-10T00:00:00Z");
  assert.equal(manifest.app, "WeaveForge");
  assert.deepEqual(manifest.encryption, { exportedDecrypted: true, e2eeEnabled: false });
  assert.deepEqual(manifest.stats, stats);
});

test("the manifest is byte-for-byte JSON.stringify(value, null, 2)", () => {
  const expected = JSON.stringify(
    {
      schemaVersion: 3,
      exportedAt: "t",
      app: "WeaveForge",
      encryption: { exportedDecrypted: true, e2eeEnabled: false },
      stats,
    },
    null,
    2,
  );
  assert.equal(exportManifestJson("t", stats), expected);
});

test("the README is stamped with the export time and keeps its layout lines", () => {
  const text = exportReadme("2026-11-10");
  assert.ok(text.startsWith("WeaveForge data export\nExported at: 2026-11-10\n"));
  assert.ok(text.includes("  notes/assets/     — embedded note images"));
  assert.ok(text.endsWith("Content is plaintext JSON + binary assets."));
});

test("an asset is written under its id folder, named by its last segment", () => {
  assert.equal(
    exportAssetPath("weaveforge-export-2026-11-10", "notes/assets", "vault/p9/img.png"),
    "weaveforge-export-2026-11-10/notes/assets/p9/img.png",
  );
  assert.equal(
    exportAssetPath("root", "papers/images", "papers/x1/fig.webp"),
    "root/papers/images/x1/fig.webp",
  );
});

test("a storage path with no second segment uses the folder unknown", () => {
  assert.equal(exportAssetPath("root", "notes/assets", "loose.png"), "root/notes/assets/unknown/loose.png");
});

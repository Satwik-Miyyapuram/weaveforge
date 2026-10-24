/**
 * Figures in the Overleaf export (B66).
 *
 * - 30-02: renaming a figure that collides with an earlier section's figure
 *   must not re-rename references already written.
 * - 30-14: a figure whose blob could not be loaded is listed as missing in the
 *   manifest, not as a file in the ZIP.
 * - 30-24: one guard refuses unsafe paths for every ZIP entry.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { ReportSectionTreeNode } from "@weaveforge/core";
import {
  assertSafeExportPath,
  buildOverleafExportPackage,
  withMissingFigures,
} from "../application/build-overleaf-export";

const section = (id: string, notes: string): ReportSectionTreeNode => ({
  section: { id, title: `S${id}`, status: "drafting", wordCount: 0, sortOrder: Number(id), createdAt: "2026-01-01T00:00:00.000Z", notes },
  children: [],
});

const includes = (latex: string) => [...latex.matchAll(/\includegraphics\[[^\]]*\]\{figures\/([^}]+)\}/g)].map((m) => m[1]);

test("a renamed figure does not re-rename an earlier reference (30-02)", () => {
  const tree = [
    section("1", "![a](reportimg:u/1/fig.png)"),
    section("2", "![b](reportimg:u/2/fig.png)\n\n![c](reportimg:u/3/fig_2.png)"),
  ];
  const result = buildOverleafExportPackage(tree, [], { includeBibliography: false });
  const main = result.files.find((f) => f.path === "main.tex")!.contents;
  const zipPaths = result.images.map((i) => i.zipPath);
  assert.deepEqual(new Set(zipPaths).size, 3);
  // Each \includegraphics names the ZIP entry of its own blob, in order.
  assert.deepEqual(includes(main), zipPaths.map((p) => p.replace(/^figures\//, "")));
  assert.deepEqual(result.images.map((i) => i.storagePath), ["u/1/fig.png", "u/2/fig.png", "u/3/fig_2.png"]);
});

test("a figure name that is a prefix of another is not rewritten inside it", () => {
  const tree = [
    section("1", "![a](reportimg:u/1/fig.png)"),
    section("2", "![b](reportimg:u/2/fig.png)\n\n![c](reportimg:u/3/fig.png.png)"),
  ];
  const result = buildOverleafExportPackage(tree, [], { includeBibliography: false });
  const main = result.files.find((f) => f.path === "main.tex")!.contents;
  assert.deepEqual(includes(main), result.images.map((i) => i.zipPath.replace(/^figures\//, "")));
});

test("assertSafeExportPath refuses traversal, absolute and backslash paths (30-24)", () => {
  for (const bad of ["../x", "figures/../../x", "/etc/passwd", "figures\\x.png", ".."]) {
    assert.throws(() => assertSafeExportPath(bad), /Refusing unsafe export path/, bad);
  }
  for (const ok of ["main.tex", "figures/fig_2.png", "a.b.c"]) assert.doesNotThrow(() => assertSafeExportPath(ok));
});

test("a missing figure is flagged in the manifest and dropped from its files (30-14)", () => {
  const tree = [section("1", "![a](reportimg:u/1/a.png)\n\n![b](reportimg:u/1/b.png)")];
  const result = buildOverleafExportPackage(tree, [], { includeBibliography: false });
  const files = withMissingFigures(result.files, [{ zipPath: "figures/b.png", storagePath: "u/1/b.png" }]);
  const manifest = JSON.parse(files.find((f) => f.path === "manifest.json")!.contents);
  assert.ok(manifest.files.includes("figures/a.png"));
  assert.ok(!manifest.files.includes("figures/b.png"));
  assert.deepEqual(manifest.missingFigures, ["figures/b.png"]);
  assert.ok(manifest.warnings.some((w: string) => /figures\/b\.png/.test(w)));
  // The input is left alone; the other files pass through unchanged.
  assert.ok(JSON.parse(result.files.find((f) => f.path === "manifest.json")!.contents).files.includes("figures/b.png"));
  assert.deepEqual(files.filter((f) => f.path !== "manifest.json"), result.files.filter((f) => f.path !== "manifest.json"));
});

test("no missing figure leaves the files as they were", () => {
  const result = buildOverleafExportPackage([section("1", "![a](reportimg:u/1/a.png)")], [], { includeBibliography: false });
  assert.equal(withMissingFigures(result.files, []), result.files);
});

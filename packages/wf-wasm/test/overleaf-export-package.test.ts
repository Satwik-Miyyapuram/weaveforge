import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  initSync,
  walkOverleafSections,
  withMissingFigures,
  type OverleafExportFile,
  type OverleafExportImage,
} from "../src/index.js";
import { missingFigureWarning } from "../src/overleaf-export-path.js";
import type { ReportSectionTreeNode } from "../src/bindings.js";

const pkgDir = new URL("../pkg/", import.meta.url);
initSync({ module: readFileSync(new URL("wf_wasm_bg.wasm", pkgDir)) });

const section = (
  id: string,
  title: string,
  notes: string | null,
  extra: Record<string, unknown> = {},
): ReportSectionTreeNode => ({
  section: {
    id,
    title,
    status: "drafting",
    wordCount: 0,
    sortOrder: Number(id),
    createdAt: "2026-01-01T00:00:00.000Z",
    notes,
    ...extra,
  } as ReportSectionTreeNode["section"],
  children: [],
});

// The JS algorithm this port replaces (build-overleaf-export.ts withMissingFigures, before B-port).
function oracleWithMissingFigures(
  files: readonly OverleafExportFile[],
  missing: readonly OverleafExportImage[],
): readonly OverleafExportFile[] {
  if (missing.length === 0) return files;
  const gone = new Set(missing.map((m) => m.zipPath));
  return files.map((f) => {
    if (f.path !== "manifest.json") return f;
    const manifest = JSON.parse(f.contents) as { files: string[]; warnings: string[] };
    const next = {
      ...manifest,
      files: manifest.files.filter((p) => !gone.has(p)),
      missingFigures: [...gone],
      warnings: [
        ...manifest.warnings,
        ...missing.map((m) => missingFigureWarning(m)),
      ],
    };
    return { ...f, contents: JSON.stringify(next, null, 2) + "\n" };
  });
}

/** A manifest shaped the way build-overleaf-export.ts writes it (key order matters). */
function builderManifest(): string {
  const manifest = {
    schemaVersion: 1,
    exportedAt: "2026-11-10T00:00:00.000Z",
    app: "WeaveForge",
    kind: "overleaf-export-package",
    title: "Thesis \"draft\" — é",
    bibliographyScope: null,
    files: ["main.tex", "figures/a.png", "figures/b.png"],
    stats: { sections: 2, equationsApprox: 0, bibliographyEntries: 0, figures: 2 },
    warnings: [],
    note: "Upload these files.",
  };
  return JSON.stringify(manifest, null, 2) + "\n";
}

test("withMissingFigures is byte-equal to the JS algorithm it replaces", () => {
  const files: OverleafExportFile[] = [
    { path: "main.tex", contents: "\\documentclass{report}" },
    { path: "manifest.json", contents: builderManifest() },
    { path: "figures/a.png", contents: "" },
  ];
  const missing: OverleafExportImage[] = [
    { zipPath: "figures/b.png", storagePath: "u/1/b.png" },
  ];
  const expected = oracleWithMissingFigures(files, missing);
  const actual = withMissingFigures(files, missing);
  assert.equal(actual.length, expected.length);
  assert.deepEqual(actual, [...expected]);
  assert.equal(
    actual.find((f) => f.path === "manifest.json")!.contents,
    expected.find((f) => f.path === "manifest.json")!.contents,
  );
});

test("missingFigures is the last key and duplicate zip paths are listed once", () => {
  const missing: OverleafExportImage[] = [
    { zipPath: "figures/b.png", storagePath: "u/1/b.png" },
    { zipPath: "figures/b.png", storagePath: "u/1/b.png" },
  ];
  const [manifest] = withMissingFigures(
    [{ path: "manifest.json", contents: builderManifest() }],
    missing,
  );
  const text = manifest!.contents;
  assert.ok(text.endsWith('"missingFigures": [\n    "figures/b.png"\n  ]\n}\n'));
  assert.equal(JSON.parse(text).missingFigures.length, 1);
  assert.deepEqual(JSON.parse(text).files, ["main.tex", "figures/a.png"]);
});

test("the manifest keeps the builder key order with a null bibliography scope", () => {
  const [manifest] = withMissingFigures(
    [{ path: "manifest.json", contents: builderManifest() }],
    [{ zipPath: "figures/b.png", storagePath: "u/1/b.png" }],
  );
  const keys = Object.keys(JSON.parse(manifest!.contents));
  assert.deepEqual(keys, [
    "schemaVersion",
    "exportedAt",
    "app",
    "kind",
    "title",
    "bibliographyScope",
    "files",
    "stats",
    "warnings",
    "note",
    "missingFigures",
  ]);
  assert.match(manifest!.contents, /"bibliographyScope": null/);
});

test("walk: depth past the last level reuses subsubsection", () => {
  const tree = [
    { ...section("1", "A", null), children: [{ ...section("2", "B", null), children: [{ ...section("3", "C", null), children: [{ ...section("4", "D", null), children: [{ ...section("5", "E", null), children: [] }] }] }] }] },
  ];
  const walk = walkOverleafSections(tree, { includeNotes: true });
  assert.deepEqual(
    walk.out.filter((l: string) => l.startsWith("\\")),
    ["\\chapter{A}", "\\section{B}", "\\subsection{C}", "\\subsubsection{D}", "\\subsubsection{E}"],
  );
});

test("walk: empty or whitespace notes get the placeholder, and no notes option skips them", () => {
  const tree = [section("1", "A", "  \n "), section("2", "B", "text", { status: "done" })];
  const on = walkOverleafSections(tree, { includeNotes: true });
  assert.ok(on.out.includes("% (no section notes)"));
  assert.equal(on.out.filter((l: string) => l === "% (no section notes)").length, 1);
  const off = walkOverleafSections(tree, { includeNotes: false });
  assert.equal(off.out.filter((l: string) => l === "% (no section notes)").length, 1);
  assert.ok(!off.out.some((l: string) => l.includes("text")));
});

test("walk: status and target words are printed, and a null target is omitted", () => {
  const tree = [
    section("1", "A", null, { wordCount: 120, targetWords: 500, status: "review" }),
    section("2", "B", null, { targetWords: null }),
  ];
  const walk = walkOverleafSections(tree, { includeNotes: true });
  assert.ok(walk.out.includes("% status: review; words: 120 / 500"));
  assert.ok(walk.out.includes("% status: drafting; words: 0"));
});

test("walk: a figure renamed in one section is renamed in later sections only", () => {
  const tree = [
    section("1", "A", "![a](reportimg:u/1/fig.png)"),
    section("2", "B", "![b](reportimg:u/2/fig.png)"),
  ];
  const walk = walkOverleafSections(tree, { includeNotes: true });
  assert.deepEqual(
    walk.images.map((i: OverleafExportImage) => i.zipPath),
    ["figures/fig.png", "figures/fig_2.png"],
  );
  assert.deepEqual(
    walk.images.map((i: OverleafExportImage) => i.storagePath),
    ["u/1/fig.png", "u/2/fig.png"],
  );
  assert.ok(walk.out.some((l: string) => l.includes("{figures/fig_2.png}")));
  assert.ok(!walk.out.some((l: string) => l.includes("{figures/fig.png}") && l.includes("fig_2")));
  assert.equal(walk.stats.figures, 2);
});

test("walk: a $ in the notes counts toward equationsApprox, and citations use the map", () => {
  const citeByTitle = new Map([["attention is all you need", "vaswani2017"]]);
  const tree = [section("1", "A", "cost $x$ and [[Attention Is All You Need]]")];
  const walk = walkOverleafSections(tree, { includeNotes: true, citeByTitle });
  assert.equal(walk.stats.equationsApprox, 2);
  assert.ok(walk.out.some((l: string) => l.includes("\\cite{vaswani2017}")));
});

test("walk: an empty tree yields no lines", () => {
  const walk = walkOverleafSections([], { includeNotes: true });
  assert.deepEqual(walk.out, []);
  assert.deepEqual(walk.warnings, []);
  assert.equal(walk.stats.sections, 0);
});

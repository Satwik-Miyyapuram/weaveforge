import { before, test } from "node:test";
import assert from "node:assert/strict";
import { MemoryWorkspaceFs } from "@core-test/memory-workspace-fs";
import { loadTestCore } from "@/lib/test/load-test-core";
import { MemorySettings } from "@/backend/providers/files/test/memory-settings";
import { seedShowcaseFiles } from "../infrastructure/seed-showcase-files";
import { SHOWCASE_EXPERIMENTS, SHOWCASE_PAPERS, SHOWCASE_REPORT } from "../domain/showcase-data";

before(async () => {
  await loadTestCore();
});

const PDF_ARXIV = "2111.06377";
const NO_SECRETS = { load: async () => ({}), save: async () => {} } as never;

async function seeded() {
  const fs = new MemoryWorkspaceFs();
  const result = await seedShowcaseFiles({
    fs,
    settings: new MemorySettings(),
    secrets: NO_SECRETS,
    readChart: async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
  });
  return { fs, result };
}

async function filesUnder(fs: MemoryWorkspaceFs, dir: string): Promise<string[]> {
  const out: string[] = [];
  try {
    for await (const entry of fs.walk(dir)) if (entry.kind === "file") out.push(entry.path);
  } catch {
    // An absent folder holds no files.
  }
  return out;
}

test("seed writes the showcase papers, one file each", async () => {
  const { fs } = await seeded();
  const papers = (await filesUnder(fs, "papers")).filter((p) => p.endsWith(".paper.md"));
  assert.equal(papers.length, SHOWCASE_PAPERS.length);
  assert.ok(papers.length >= 100, `expected 100+ papers, got ${papers.length}`);
});

test("seed writes the PDF demo paper (arXiv 2111.06377) and returns its id", async () => {
  const { fs, result } = await seeded();
  assert.ok(result.pdfPaperId, "pdfPaperId is set");
  const withArxiv = [];
  for (const p of await filesUnder(fs, "papers")) {
    if ((await fs.readText(p)).includes(PDF_ARXIV)) withArxiv.push(p);
  }
  assert.equal(withArxiv.length, 1, "exactly one paper carries the arXiv id");
});

test("seed writes annotation pins to the workspace pin file", async () => {
  const { fs } = await seeded();
  const pins = JSON.parse(await fs.readText(".weaveforge/annotation-pins.json")) as unknown[];
  assert.ok(Array.isArray(pins) && pins.length > 0, "pins written");
});

test("seed writes reading lists, experiments and report sections", async () => {
  const { fs } = await seeded();
  const lists = (await filesUnder(fs, "reading-lists")).filter((p) => p.endsWith(".list.md"));
  assert.ok(lists.length >= 1, "at least one reading list");
  const experiments = (await filesUnder(fs, "experiments")).filter((p) => p.endsWith(".experiment.md"));
  assert.equal(experiments.length, SHOWCASE_EXPERIMENTS.length);
  const sections = (await filesUnder(fs, ".")).filter((p) => p.endsWith(".section.md"));
  assert.equal(sections.length, SHOWCASE_REPORT.length);
});

test("every title the demo tour opens is a seeded file", async () => {
  const { fs } = await seeded();
  const papers = await filesUnder(fs, "papers");
  const paperTexts = await Promise.all(papers.map((p) => fs.readText(p)));
  for (const title of ["Dropout: A Simple Way to Prevent Neural Networks from Overfitting"]) {
    assert.ok(paperTexts.some((t) => t.includes(title)), `paper "${title}" is seeded`);
  }
  const notes = await filesUnder(fs, "notes");
  const noteTexts = await Promise.all(notes.map((p) => fs.readText(p)));
  assert.ok(
    notes.some((p) => p.includes("β-VAE objective")) || noteTexts.some((t) => t.includes("β-VAE objective")),
    "note \"β-VAE objective\" is seeded",
  );
});

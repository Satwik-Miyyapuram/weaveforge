import { before, test } from "node:test";
import assert from "node:assert/strict";
import { MemoryWorkspaceFs } from "@core-test/memory-workspace-fs";
import { loadTestCore } from "@/lib/test/load-test-core";
import { MemorySettings } from "@/backend/providers/files/test/memory-settings";
import { wireFileBackend } from "@/backend/providers/files/wire-file-backend";
import { seedShowcaseFiles } from "../infrastructure/seed-showcase-files";
import {
  SHOWCASE_ANNOTATION_PINS,
  SHOWCASE_EXPERIMENTS,
  SHOWCASE_PAPERS,
  SHOWCASE_PROJECT_NAME,
  SHOWCASE_REPORT,
} from "../domain/showcase-data";

before(async () => {
  await loadTestCore();
});

const PDF_ARXIV = "2111.06377";
/** The showcase project's folder; every seeded file sits under it. */
const DIR = SHOWCASE_PROJECT_NAME;
const NO_SECRETS = { load: async () => ({}), save: async () => {} } as never;

async function seeded() {
  const fs = new MemoryWorkspaceFs();
  const settings = new MemorySettings();
  const result = await seedShowcaseFiles({
    fs,
    settings,
    secrets: NO_SECRETS,
    readChart: async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
  });
  return { fs, settings, result };
}

/** The file repositories over the seeded folder, read the way the app reads them. */
function reposOver(fs: MemoryWorkspaceFs, settings: MemorySettings) {
  return wireFileBackend({ fs, settings, secrets: NO_SECRETS, projectRoot: () => DIR });
}

/** Seeded paper ids follow the order of SHOWCASE_PAPERS (see seed-showcase-files.ts). */
function seededPaperId(title: string): string {
  return `showcase-paper-${SHOWCASE_PAPERS.findIndex((p) => p.title === title) + 1}`;
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
  const papers = (await filesUnder(fs, `${DIR}/papers`)).filter((p) => p.endsWith(".paper.md"));
  assert.equal(papers.length, SHOWCASE_PAPERS.length);
  assert.ok(papers.length >= 100, `expected 100+ papers, got ${papers.length}`);
});

test("seed writes the PDF demo paper (arXiv 2111.06377) and returns its id", async () => {
  const { fs, result } = await seeded();
  assert.ok(result.pdfPaperId, "pdfPaperId is set");
  const withArxiv = [];
  for (const p of await filesUnder(fs, `${DIR}/papers`)) {
    if ((await fs.readText(p)).includes(PDF_ARXIV)) withArxiv.push(p);
  }
  assert.equal(withArxiv.length, 1, "exactly one paper carries the arXiv id");
});

test("seed writes annotation pins to the workspace pin file", async () => {
  const { fs } = await seeded();
  const pins = JSON.parse(await fs.readText(`${DIR}/.weaveforge/annotation-pins.json`)) as unknown[];
  assert.ok(Array.isArray(pins) && pins.length > 0, "pins written");
});

test("seed writes reading lists, experiments and report sections", async () => {
  const { fs, settings } = await seeded();
  const lists = (await filesUnder(fs, `${DIR}/reading-lists`)).filter((p) => p.endsWith(".list.md"));
  assert.ok(lists.length >= 1, "at least one reading list");
  const experiments = (await filesUnder(fs, `${DIR}/experiments`)).filter((p) => p.endsWith(".experiment.md"));
  assert.equal(experiments.length, SHOWCASE_EXPERIMENTS.length);
  const sections = await reposOver(fs, settings).reportSectionRepository.list();
  assert.equal(sections.length, SHOWCASE_REPORT.length);
});

test("every title the demo tour opens is a seeded file", async () => {
  const { fs } = await seeded();
  const papers = await filesUnder(fs, `${DIR}/papers`);
  const paperTexts = await Promise.all(papers.map((p) => fs.readText(p)));
  for (const title of ["Dropout: A Simple Way to Prevent Neural Networks from Overfitting"]) {
    assert.ok(paperTexts.some((t) => t.includes(title)), `paper "${title}" is seeded`);
  }
  const notes = await filesUnder(fs, `${DIR}/notes`);
  const noteTexts = await Promise.all(notes.map((p) => fs.readText(p)));
  assert.ok(
    notes.some((p) => p.includes("β-VAE objective")) || noteTexts.some((t) => t.includes("β-VAE objective")),
    "note \"β-VAE objective\" is seeded",
  );
});

test("seed sets a paper field value the paper reads back", async () => {
  const { fs, settings } = await seeded();
  const repos = reposOver(fs, settings);
  const paperId = seededPaperId(SHOWCASE_ANNOTATION_PINS[0]![0]);
  const defs = await repos.paperFieldRepository.listDefs();
  const reproduced = defs.find((d) => d.name === "Reproduced");
  assert.ok(reproduced, "field definition \"Reproduced\" is seeded");
  const values = await repos.paperFieldRepository.listValuesForPaper(paperId);
  assert.ok(
    values.some((v) => v.fieldId === reproduced.id && v.value === "partly"),
    `paper ${paperId} reads back "partly", got ${JSON.stringify(values)}`,
  );
});

test("seed sets a quotation type on each pinned annotation the paper reads back", async () => {
  const { fs, settings } = await seeded();
  const [title, annotationKey] = SHOWCASE_ANNOTATION_PINS[0]!;
  const rows = await reposOver(fs, settings).quotationTypeRepository.listForPaper(seededPaperId(title));
  const row = rows.find((r) => r.annotationKey === annotationKey);
  assert.ok(row, `annotation ${annotationKey} has a quotation type`);
  assert.equal(row.quotationType, "direct");
});

test("seed writes metric curves the experiment's history reads back", async () => {
  const { fs, settings } = await seeded();
  const repos = reposOver(fs, settings);
  const experiment = (await repos.experimentRepository.list()).find((e) => e.name === SHOWCASE_EXPERIMENTS[0]!.name);
  assert.ok(experiment, "the first showcase experiment is seeded");
  const points = await repos.metricRepository.history(experiment.id, "val_loss", { maxPoints: 1000 });
  assert.ok(points.length >= 2, `val_loss curve has points, got ${points.length}`);
  assert.ok(points.every((p) => p.experimentId === experiment.id && p.metric === "val_loss"));
});

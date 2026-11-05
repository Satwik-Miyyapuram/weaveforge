import { before, test } from "node:test";
import assert from "node:assert/strict";
import * as ts from "@weaveforge/core";
import type { RustCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";

// Proves the Rust report rules return exactly what the TS originals in
// packages/core/src/features/report/domain/{prisma-figure,project-path,bibliography-report,
// report-section}.ts return. Inputs are seeded, so a failure reproduces from the seed.

let rs: RustCore;
before(async () => {
  rs = await loadTestCore();
});

/** Mulberry32, so a failure reproduces from the seed. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rand: () => number, items: readonly T[]): T {
  return items[Math.floor(rand() * items.length)]!;
}

function join(rand: () => number, parts: readonly string[], max: number, sep = ""): string {
  const count = Math.floor(rand() * max);
  return Array.from({ length: count }, () => pick(rand, parts)).join(sep);
}

/** Drops `undefined`, as the Rust side never sends it. */
function plain<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value ?? null));
}

const SEEDS = Array.from({ length: 300 }, (_, i) => i + 1);

function counts(rand: () => number): ts.PrismaCounts {
  const n = () => (rand() < 0.3 ? 0 : Math.floor(rand() * 500));
  return {
    identified: n(),
    duplicates: n(),
    screened: n(),
    excludedAtScreening: n(),
    eligible: n(),
    excludedAtFullText: n(),
    included: n(),
    undecided: n(),
    conflicts: n(),
  };
}

const TEXT = ["Scopus", "A & B", "50%", "x_y", "#1", "{braces}", "~", "\\cmd", "Café", "  ", "", "$"];

test("prismaFigureTex and prismaCaveat match TS on seeded counts", () => {
  for (const seed of SEEDS) {
    const rand = random(seed);
    const c = counts(rand);
    const options: ts.PrismaFigureOptions = {};
    if (rand() < 0.5) options.label = join(rand, TEXT, 3);
    if (rand() < 0.5) options.caption = join(rand, TEXT, 3);
    if (rand() < 0.5) options.source = join(rand, TEXT, 3);
    if (rand() < 0.6) {
      options.reasons = Array.from({ length: Math.floor(rand() * 5) }, () => ({
        reason: join(rand, TEXT, 3),
        count: Math.floor(rand() * 20),
      }));
    }
    assert.equal(rs.prismaFigureTex(c, options), ts.prismaFigureTex(c, options), `seed ${seed}`);
    assert.equal(rs.prismaCaveat(c), ts.prismaCaveat(c), `seed ${seed}`);
  }
  const c = counts(random(7));
  assert.equal(rs.prismaFigureTex(c), ts.prismaFigureTex(c));
});

/** Copy of packages/core/src/features/report/domain/project-path.ts, which core does not export. */
function tsNormalizeProjectPath(path: string): string | null {
  const normalized: string[] = [];
  for (const part of path.replaceAll("\\", "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!normalized.length) return null;
      normalized.pop();
    } else {
      normalized.push(part);
    }
  }
  return normalized.join("/");
}

const PATH_PARTS = ["a", "b", ".", "..", "", "/", "\\", "ü", " x ", "c.tex"];

test("normalizeProjectPath matches TS", () => {
  for (const seed of SEEDS) {
    const path = join(random(seed), PATH_PARTS, 8);
    assert.equal(rs.normalizeProjectPath(path), tsNormalizeProjectPath(path), JSON.stringify(path));
  }
});

const KEYS = ["vaswani2017", "he2016", "lecun98", "Smith:2020", "dup"];
const CITES = ["\\cite", "\\citep", "\\citet", "\\parencite", "\\textcite", "\\autocite", "\\nocite", "\\citeauthor"];
const TYPES = ["article", "inproceedings", "book", "misc", "phdthesis", "online", "ARTICLE"];
const FIELDS = [
  "author = {Smith, John and Doe, Jane}",
  "author = {John Smith and Jane Doe}",
  "author = {Smith, J. and others}",
  "title = {A {Title}}",
  "journal = {J}",
  "booktitle = {Proc}",
  "year = {2020}",
  "year = 1999",
  "doi = {10.1000/abc}",
  "doi = {https://doi.org/10.1/x}",
  "doi = {not a doi}",
  "url = {https://example.org}",
  "url = {example.org}",
  "publisher = {P}",
  "school = {S}",
];

function texFile(rand: () => number, bibNames: string[]): string {
  const lines: string[] = [];
  const count = 1 + Math.floor(rand() * 8);
  for (let i = 0; i < count; i++) {
    const roll = rand();
    if (roll < 0.5) {
      const keys = Array.from({ length: 1 + Math.floor(rand() * 3) }, () => pick(rand, KEYS)).join(rand() < 0.5 ? "," : ", ");
      lines.push(`Text ${pick(rand, CITES)}${rand() < 0.2 ? "[p.~3]" : ""}{${keys}} more.`);
    } else if (roll < 0.6) {
      lines.push("\\nocite{*}");
    } else if (roll < 0.75) {
      lines.push(`\\${pick(rand, ["bibliography", "addbibresource"])}{${pick(rand, bibNames)}}`);
    } else if (roll < 0.85) {
      lines.push(`% \\cite{${pick(rand, KEYS)}} commented`);
    } else {
      lines.push("Plain line.");
    }
  }
  return lines.join("\n");
}

function bibFile(rand: () => number): string {
  const entries: string[] = [];
  const count = Math.floor(rand() * 6);
  for (let i = 0; i < count; i++) {
    const fields = Array.from({ length: Math.floor(rand() * 6) }, () => pick(rand, FIELDS));
    const body = `@${pick(rand, TYPES)}{${pick(rand, KEYS)},\n  ${fields.join(",\n  ")}\n}`;
    entries.push(rand() < 0.08 ? body.slice(0, Math.floor(body.length / 2)) : body);
  }
  if (rand() < 0.1) entries.push("@comment{ignored}");
  return entries.join("\n\n");
}

test("checkBibliography matches TS on seeded projects", () => {
  for (const seed of SEEDS) {
    const rand = random(seed);
    const bibNames = ["refs", "refs.bib", "sub/more", "../out", "missing"];
    const sources: ts.LatexSourceFile[] = [{ path: "main.tex", content: texFile(rand, bibNames) }];
    if (rand() < 0.4) sources.push({ path: "chapters/intro.tex", content: texFile(rand, bibNames) });
    sources.push({ path: "refs.bib", content: bibFile(rand) });
    if (rand() < 0.4) sources.push({ path: "sub/more.bib", content: bibFile(rand) });
    const bibliography = ts.parseBibEntries(sources);
    const input = { sources, bibliography };
    assert.deepEqual(plain(rs.checkBibliography(input)), plain(ts.checkBibliography(input)), `seed ${seed}`);
  }
});

function sectionInput(rand: () => number): ts.NewReportSectionInput {
  const input: Record<string, unknown> = {
    title: pick(rand, ["Intro", "  Methods  ", "", "   ", "Résumé", " "]),
  };
  if (rand() < 0.4) input.sectionNo = pick(rand, ["1", " 2.1 ", "", "  "]);
  if (rand() < 0.4) input.parentId = pick(rand, ["p1", ""]);
  if (rand() < 0.4) input.status = pick(rand, ts.REPORT_STATUSES);
  if (rand() < 0.4) input.wordCount = pick(rand, [0, 10, -1, 2.5]);
  if (rand() < 0.4) input.targetWords = pick(rand, [0, 500, -3]);
  if (rand() < 0.3) input.deadline = "2026-12-01";
  if (rand() < 0.3) input.draftUrl = "https://overleaf.com/x";
  if (rand() < 0.3) input.notes = "note";
  if (rand() < 0.4) input.sortOrder = pick(rand, [0, 3, -1]);
  return input as unknown as ts.NewReportSectionInput;
}

function run(create: () => unknown): unknown {
  try {
    return { ok: plain(create()) };
  } catch (error) {
    const e = error as Error;
    return { error: e.message, name: e.name };
  }
}

test("createReportSection matches TS, including errors and dependency order", () => {
  for (const seed of SEEDS) {
    const input = sectionInput(random(seed));
    const deps = (calls: string[]) => ({
      clock: { nowIso: () => (calls.push("now"), "2026-11-05T00:00:00.000Z") },
      ids: { newId: () => (calls.push("id"), `id-${seed}`) },
    });
    const tsCalls: string[] = [];
    const rsCalls: string[] = [];
    assert.deepEqual(run(() => rs.createReportSection(input, deps(rsCalls))), run(() => ts.createReportSection(input, deps(tsCalls))), `seed ${seed}`);
    assert.deepEqual(rsCalls, tsCalls, `seed ${seed} calls`);
  }
});

test("buildSectionTree matches TS, with loops, orphans and duplicate ids", () => {
  for (const seed of SEEDS) {
    const rand = random(seed);
    const ids = ["a", "b", "c", "d", "e", "f"];
    const sections: ts.ReportSection[] = Array.from({ length: Math.floor(rand() * 9) }, (_, i) => {
      const section: ts.ReportSection = {
        id: rand() < 0.15 ? pick(rand, ids) : ids[i % ids.length]! + (i >= ids.length ? i : ""),
        title: pick(rand, ["Intro", "intro", "Été", "ete", "Zeta", "alpha", "10", "9", ""]),
        status: pick(rand, ts.REPORT_STATUSES),
        wordCount: 0,
        sortOrder: pick(rand, [0, 0, 1, 2, -1]),
        createdAt: "2026-01-01T00:00:00.000Z",
      };
      if (rand() < 0.5) section.sectionNo = pick(rand, ["1", "1.10", "1.2", "2", "A", "a", ""]);
      if (rand() < 0.6) section.parentId = pick(rand, [...ids, "missing", ""]);
      return section;
    });
    assert.deepEqual(plain(rs.buildSectionTree(sections)), plain(ts.buildSectionTree(sections)), `seed ${seed}`);
  }
});

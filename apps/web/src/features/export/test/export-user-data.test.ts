import assert from "node:assert/strict";
import test from "node:test";
import { strFromU8 } from "fflate";
import type { WorkspaceSnapshot } from "@thesis/core";
import { buildExportFiles } from "../application/export-user-data";

/**
 * Regression cover for the export that silently shipped nothing: it read the
 * card projections, where notes carry `body: ""` and papers have no `metadata`.
 * Both attachment scans key off those dropped fields, so the ZIP contained
 * empty notes and zero attachments while looking perfectly well-formed.
 */

const PAGE_ID = "n1";
const PAPER_ID = "p1";

function snapshot(): WorkspaceSnapshot {
  return {
    papers: [
      {
        id: PAPER_ID,
        title: "Attention Is All You Need",
        abstract: "The dominant sequence transduction models…",
        metadata: { images: [`user-1/${PAPER_ID}/fig1.png`] },
      } as never,
    ],
    vaultPages: [
      {
        id: PAGE_ID,
        title: "Method",
        body: `Body text.\n\n![](vault:user-1/${PAGE_ID}/diagram.png)`,
      } as never,
    ],
    readingLists: [],
    readingListItems: [],
    reportSections: [],
    experiments: [],
    milestones: [],
    logEntries: [],
    relations: [],
    tags: [],
    readerAnnotations: [],
    collectedAt: "2026-08-05T00:00:00.000Z",
  };
}

function assetReaders() {
  const blob = (text: string) => ({ arrayBuffer: async () => new TextEncoder().encode(text).buffer }) as Blob;
  return {
    fetchVaultAssets: async (paths: readonly string[]) =>
      new Map(paths.map((path) => [path, blob("png-bytes")])),
    fetchPaperImages: async (paths: readonly string[]) =>
      new Map(paths.map((path) => [path, blob("fig-bytes")])),
  };
}

function findFile(files: Record<string, Uint8Array>, suffix: string): string | undefined {
  return Object.keys(files).find((name) => name.endsWith(suffix));
}

test("exports note bodies, not empty strings", async () => {
  const files = await buildExportFiles(snapshot(), assetReaders());

  const key = findFile(files, "notes/pages.json");
  assert.ok(key, "notes/pages.json is missing");
  const pages = JSON.parse(strFromU8(files[key]!)) as { body: string }[];
  assert.equal(pages.length, 1);
  assert.notEqual(pages[0]!.body, "", "note body was exported empty");
  assert.match(pages[0]!.body, /Body text/);
});

test("exports paper fields the card projection drops", async () => {
  const files = await buildExportFiles(snapshot(), assetReaders());

  const key = findFile(files, "papers/index.json");
  assert.ok(key);
  const papers = JSON.parse(strFromU8(files[key]!)) as { abstract?: string }[];
  assert.match(papers[0]!.abstract ?? "", /dominant sequence/);
});

test("includes note assets discovered in the body", async () => {
  const files = await buildExportFiles(snapshot(), assetReaders());

  const asset = findFile(files, `notes/assets/${PAGE_ID}/diagram.png`);
  assert.ok(asset, "no note asset was exported");
  assert.ok(files[asset]!.byteLength > 0);
});

test("includes paper images discovered in metadata", async () => {
  const files = await buildExportFiles(snapshot(), assetReaders());

  const image = findFile(files, `papers/images/${PAPER_ID}/fig1.png`);
  assert.ok(image, "no paper image was exported");
  assert.ok(files[image]!.byteLength > 0);
});

test("manifest counts match the snapshot", async () => {
  const files = await buildExportFiles(snapshot(), assetReaders());

  const key = findFile(files, "manifest.json");
  assert.ok(key);
  const manifest = JSON.parse(strFromU8(files[key]!)) as {
    stats: { notes: number; papers: number };
    exportedAt: string;
  };
  assert.equal(manifest.stats.notes, 1);
  assert.equal(manifest.stats.papers, 1);
  assert.equal(manifest.exportedAt, "2026-08-05T00:00:00.000Z");
});

test("a missing blob is skipped rather than failing the export", async () => {
  const files = await buildExportFiles(snapshot(), {
    fetchVaultAssets: async (paths) => new Map(paths.map((p) => [p, null])),
    fetchPaperImages: async (paths) => new Map(paths.map((p) => [p, null])),
  });

  assert.equal(findFile(files, "diagram.png"), undefined);
  assert.ok(findFile(files, "notes/pages.json"), "export still produced its JSON");
});

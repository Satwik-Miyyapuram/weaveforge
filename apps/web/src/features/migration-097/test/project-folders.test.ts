import assert from "node:assert/strict";
import { before, test } from "node:test";
import { loadTestCore } from "@/lib/test/load-test-core";
import { checkProjectFolders, runWebExport } from "../application/run-web-export";
import type { FileCodec, ServerSource } from "../domain/ports";
import { MemorySink } from "../infrastructure/memory-sink";

before(loadTestCore);

const BAD = /unique and not nested/;

test("project folders: two projects in one folder are refused", () => {
  assert.throws(() => checkProjectFolders(new Map([["p1", "Thesis"], ["p2", "Thesis"]])), BAD);
});

test("project folders: two projects at the root are refused", () => {
  assert.throws(() => checkProjectFolders(new Map([["p1", ""], ["p2", ""]])), BAD);
});

test("project folders: names that differ only in case are refused (the desktop filesystem ignores case)", () => {
  assert.throws(() => checkProjectFolders(new Map([["p1", "Thesis"], ["p2", "thesis"]])), BAD);
});

test("project folders: a folder inside another folder is refused, either way round", () => {
  assert.throws(() => checkProjectFolders(new Map([["p1", "Thesis"], ["p2", "Thesis/2025"]])), BAD);
  assert.throws(() => checkProjectFolders(new Map([["p1", "Thesis/2025"], ["p2", "Thesis"]])), BAD);
});

test("project folders: the root beside folders, and siblings that share a prefix, are allowed", () => {
  assert.doesNotThrow(() => checkProjectFolders(new Map([["p1", ""], ["p2", "Thesis"], ["p3", "Lab"]])));
  assert.doesNotThrow(() => checkProjectFolders(new Map([["p1", "A"], ["p2", "AB"]])));
});

test("runWebExport: a bad folder map is refused before any file is written", async () => {
  const sink = new MemorySink();
  const source = {} as unknown as ServerSource;
  const codec = { supports: () => false } as unknown as FileCodec;
  await assert.rejects(
    runWebExport({
      kinds: [],
      codec,
      now: "2026-11-22T00:00:00.000Z",
      source,
      sink,
      projectFolders: new Map([["p1", "Thesis"], ["p2", "Thesis/2025"]]),
    }),
    BAD,
  );
  assert.deepEqual(await sink.list(), []);
});

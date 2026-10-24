import assert from "node:assert/strict";
import { test } from "node:test";
import type { Paper } from "@weaveforge/core";
import { InMemoryPaperRepository } from "@weaveforge/core/testing";

import { LibraryTidyFacade } from "../library-tidy";

const now = "2026-01-01T00:00:00.000Z";
const paper = (id: string, doi: string): Paper => ({
  id, title: `Paper ${doi}`, authors: [], doi, status: "to_read", tags: [], metadata: {}, createdAt: now, updatedAt: now,
});

async function facadeWith(failId: string | null) {
  const repo = new InMemoryPaperRepository();
  for (const p of [paper("a1", "10.1/a"), paper("a2", "10.1/a"), paper("b1", "10.1/b"), paper("b2", "10.1/b")]) {
    await repo.save(p);
  }
  let inFlight = 0;
  let peak = 0;
  const getById = repo.getById.bind(repo);
  repo.getById = async (id: string) => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight -= 1;
    if (id === failId) throw new Error("read failed");
    return getById(id);
  };
  const facade = new LibraryTidyFacade({ papers: repo, updatePaper: {} as never, resolver: {} as never, mergePapers: {} as never });
  return { facade, peak: () => peak };
}

test("scan reads grouped papers in parallel (10-28)", async () => {
  const { facade, peak } = await facadeWith(null);
  const scan = await facade.scan();
  assert.equal(scan.duplicates.length, 2);
  assert.ok(scan.duplicates.every((g) => g.keepId));
  assert.ok(peak() > 1, "reads ran one at a time");
});

test("one failed read does not fail the scan; other groups still get a full-paper keeper (10-28)", async () => {
  const { facade } = await facadeWith("a1");
  const scan = await facade.scan();
  const a = scan.duplicates.find((g) => g.ids.includes("a1"))!;
  const b = scan.duplicates.find((g) => g.ids.includes("b1"))!;
  assert.ok(a, "the group with the failed read is still listed");
  assert.ok(b.keepId);
  assert.ok(scan.papers.has("a1"), "the failed paper still shows from its summary");
});

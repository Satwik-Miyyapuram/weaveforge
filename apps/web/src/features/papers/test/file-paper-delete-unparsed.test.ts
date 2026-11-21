import { before, test } from "node:test";
import assert from "node:assert/strict";
import type { Paper } from "@weaveforge/core";
import { MemoryWorkspaceFs } from "@core-test/memory-workspace-fs";
import { loadTestCore } from "@/lib/test/load-test-core";
import { FilePaperRepository } from "../infrastructure/file-paper-repository";

before(async () => {
  await loadTestCore();
});

const ROOT = "thesis";

function paper(overrides: Partial<Paper> = {}): Paper {
  return {
    id: "p-1",
    title: "Attention Is All You Need",
    authors: ["Vaswani"],
    status: "to_read",
    tags: [],
    metadata: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

test("delete keeps the PDF while another paper file cannot be parsed, since it may use it (F97-P2-25)", async () => {
  const fs = new MemoryWorkspaceFs();
  const repo = new FilePaperRepository(fs, ROOT);
  const pdf = `${ROOT}/papers/pdf/shared.pdf`;
  await fs.writeFile(pdf, "%PDF");
  await repo.save(paper({ pdfPath: pdf }));
  // Paper B points at the same PDF, but its frontmatter is broken, so no read sees that.
  await fs.writeFile(`${ROOT}/papers/broken.paper.md`, `no frontmatter, but it names ${pdf}\n`);
  assert.equal((await repo.failures()).length, 1, "the second file does not parse");
  await repo.delete("p-1");
  assert.equal(await fs.readText(pdf), "%PDF");
});

test("delete still trashes the PDF when every other paper file parses and none uses it", async () => {
  const fs = new MemoryWorkspaceFs();
  const repo = new FilePaperRepository(fs, ROOT);
  const pdf = `${ROOT}/papers/pdf/own.pdf`;
  await fs.writeFile(pdf, "%PDF");
  await repo.save(paper({ pdfPath: pdf }));
  await repo.save(paper({ id: "p-2", title: "Other" }));
  await repo.delete("p-1");
  assert.equal(await fs.stat(pdf), null);
});

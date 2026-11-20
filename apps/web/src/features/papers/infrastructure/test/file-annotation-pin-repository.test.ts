import { before, test } from "node:test";
import assert from "node:assert/strict";
import { MemoryWorkspaceFs } from "@core-test/memory-workspace-fs";
import { loadTestCore } from "@/lib/test/load-test-core";
import { FileAnnotationPinRepository } from "../file-annotation-pin-repository";

before(async () => {
  await loadTestCore();
});

const ROOT = "thesis";
const FILE = `${ROOT}/papers/pdf/p-1.pins.json`;

function setup(papers: string[] = ["p-1"]) {
  const fs = new MemoryWorkspaceFs();
  const source = { listPaperIds: async () => papers };
  return { fs, repo: new FileAnnotationPinRepository(fs, ROOT, source) };
}

test("save creates the paper's pins file as a bare array of the three keys", async () => {
  const { fs, repo } = setup();
  const pin = await repo.save({ paperId: "p-1", annotationKey: "k1", reportSectionId: "s1" });
  assert.equal(pin.id, "p-1:k1");
  assert.equal(pin.paperId, "p-1");
  const rows = JSON.parse(await fs.readText(FILE)) as Array<Record<string, unknown>>;
  assert.ok(Array.isArray(rows));
  assert.deepEqual(Object.keys(rows[0]!).sort(), ["annotation_key", "created_at", "report_section_id"]);
  assert.equal(rows[0]!.annotation_key, "k1");
  assert.equal(rows[0]!.report_section_id, "s1");
});

test("save twice on the same key updates the row in place", async () => {
  const { fs, repo } = setup();
  const first = await repo.save({ paperId: "p-1", annotationKey: "k1", reportSectionId: "s1" });
  const second = await repo.save({ paperId: "p-1", annotationKey: "k1", reportSectionId: "s2" });
  assert.equal(second.reportSectionId, "s2");
  assert.equal(second.createdAt, first.createdAt);
  const rows = JSON.parse(await fs.readText(FILE)) as Array<{ report_section_id: string }>;
  assert.deepEqual(rows.map((r) => r.report_section_id), ["s2"]);
});

test("remove of an absent pin is a no-op", async () => {
  const { fs, repo } = setup();
  await repo.remove("p-1", "missing");
  assert.equal(await fs.stat(FILE), null);
  await repo.save({ paperId: "p-1", annotationKey: "k1", reportSectionId: "s1" });
  await repo.remove("p-1", "missing");
  assert.deepEqual((await repo.listForPaper("p-1")).map((p) => p.annotationKey), ["k1"]);
});

test("listForSection finds the pins of every paper in that section", async () => {
  const { repo } = setup(["p-1", "p-2"]);
  await repo.save({ paperId: "p-1", annotationKey: "a", reportSectionId: "s1" });
  await repo.save({ paperId: "p-2", annotationKey: "b", reportSectionId: "s1" });
  await repo.save({ paperId: "p-2", annotationKey: "c", reportSectionId: "s2" });
  const found = await repo.listForSection("s1");
  assert.deepEqual(found.map((p) => p.id).sort(), ["p-1:a", "p-2:b"]);
});

test("listForProject returns the pins of all papers", async () => {
  const { repo } = setup(["p-1", "p-2"]);
  await repo.save({ paperId: "p-1", annotationKey: "a", reportSectionId: "s1" });
  await repo.save({ paperId: "p-2", annotationKey: "b", reportSectionId: "s1" });
  await repo.save({ paperId: "p-2", annotationKey: "c", reportSectionId: "s2" });
  const all = await repo.listForProject();
  assert.deepEqual(all.map((p) => p.id).sort(), ["p-1:a", "p-2:b", "p-2:c"]);
});

test("a malformed pins file throws and is not overwritten", async () => {
  const { fs, repo } = setup();
  const text = JSON.stringify({ annotation_key: "k1" });
  await fs.writeFile(FILE, text);
  const invalid = (error: unknown) => error instanceof Error && error.message.startsWith("pins file is not valid");
  await assert.rejects(repo.listForPaper("p-1"), invalid);
  await assert.rejects(repo.save({ paperId: "p-1", annotationKey: "k2", reportSectionId: "s1" }), invalid);
  assert.equal(await fs.readText(FILE), text);
});

test("a null report section is refused, never passed through as a string", async () => {
  const { fs, repo } = setup();
  const text = JSON.stringify([{ annotation_key: "k1", report_section_id: null, created_at: "2026-11-01T10:00:00Z" }]);
  await fs.writeFile(FILE, text);
  await assert.rejects(repo.listForPaper("p-1"), (error: unknown) =>
    error instanceof Error && error.message.startsWith("pins file is not valid"),
  );
});

test("a file in the exporter's shape reads back unchanged", async () => {
  const { fs, repo } = setup();
  const text = JSON.stringify(
    [{ annotation_key: "k1", report_section_id: "s1", created_at: "2026-11-01T10:00:00Z" }],
    null,
    2,
  );
  await fs.writeFile(FILE, text);
  const pins = await repo.listForPaper("p-1");
  assert.equal(pins.length, 1);
  assert.equal(pins[0]!.createdAt, "2026-11-01T10:00:00Z");
  await repo.save({ paperId: "p-1", annotationKey: "k2", reportSectionId: "s1" });
  await repo.remove("p-1", "k2");
  assert.equal(await fs.readText(FILE), text);
});

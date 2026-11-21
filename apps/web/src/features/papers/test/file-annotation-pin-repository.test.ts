import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { MemoryWorkspaceFs } from "@core-test/memory-workspace-fs";
import { renderJsonRows } from "@/lib/json-rows-file";
import { FileAnnotationPinRepository } from "../infrastructure/file-annotation-pin-repository";

const ROOT = "thesis";
const FILE = "thesis/.weaveforge/annotation-pins.json";

test("pins live in one project file; nothing is written before the first pin", async () => {
  const fs = new MemoryWorkspaceFs();
  const repo = new FileAnnotationPinRepository(fs, ROOT);
  assert.deepEqual(await repo.listForProject(), []);
  await repo.remove("p-1", "k");
  assert.equal(await fs.stat(FILE), null);
  const pin = await repo.save({ paperId: "p-1", annotationKey: "k", reportSectionId: "s-1" });
  assert.match(pin.id, /^annotation-pin-/);
  assert.ok(pin.createdAt);
  assert.deepEqual(JSON.parse(await fs.readText(FILE)), [pin]);
});

test("saving a pin again moves it and keeps its id and createdAt", async () => {
  const repo = new FileAnnotationPinRepository(new MemoryWorkspaceFs(), ROOT);
  const first = await repo.save({ paperId: "p-1", annotationKey: "k", reportSectionId: "s-1" });
  const moved = await repo.save({ paperId: "p-1", annotationKey: "k", reportSectionId: "s-2" });
  assert.equal(moved.id, first.id);
  assert.equal(moved.createdAt, first.createdAt);
  assert.deepEqual(await repo.listForProject(), [moved]);
  assert.deepEqual(await repo.listForSection("s-1"), []);
  assert.deepEqual(await repo.listForSection("s-2"), [moved]);
});

test("lists filter by paper and by section; remove takes only that pin", async () => {
  const repo = new FileAnnotationPinRepository(new MemoryWorkspaceFs(), ROOT);
  const a = await repo.save({ paperId: "p-1", annotationKey: "a", reportSectionId: "s-1" });
  const b = await repo.save({ paperId: "p-2", annotationKey: "a", reportSectionId: "s-1" });
  const c = await repo.save({ paperId: "p-1", annotationKey: "c", reportSectionId: "s-2" });
  assert.deepEqual(await repo.listForPaper("p-1"), [a, c]);
  assert.deepEqual(await repo.listForSection("s-1"), [a, b]);
  await repo.remove("p-1", "a");
  assert.deepEqual(await repo.listForProject(), [b, c]);
});

test("keys the app does not own on a pin row survive a move", async () => {
  const fs = new MemoryWorkspaceFs();
  await fs.mkdirp("thesis/.weaveforge");
  await fs.writeFile(
    FILE,
    renderJsonRows([
      { id: "pin-1", paperId: "p-1", annotationKey: "k", reportSectionId: "s-1", createdAt: "2026-01-01", note: "mine" },
    ]),
  );
  const repo = new FileAnnotationPinRepository(fs, ROOT);
  await repo.save({ paperId: "p-1", annotationKey: "k", reportSectionId: "s-2" });
  const [row] = JSON.parse(await fs.readText(FILE));
  assert.equal(row.note, "mine");
  assert.equal(row.reportSectionId, "s-2");
  assert.equal(row.id, "pin-1");
});

test("law: the file repository answers like a map keyed by (paper, annotation)", async () => {
  const op = fc.oneof(
    fc.record({
      kind: fc.constant("save" as const),
      paperId: fc.constantFrom("p-1", "p-2"),
      annotationKey: fc.constantFrom("a", "b"),
      reportSectionId: fc.constantFrom("s-1", "s-2"),
    }),
    fc.record({
      kind: fc.constant("remove" as const),
      paperId: fc.constantFrom("p-1", "p-2"),
      annotationKey: fc.constantFrom("a", "b"),
    }),
  );
  await fc.assert(
    fc.asyncProperty(fc.array(op, { maxLength: 12 }), async (ops) => {
      const repo = new FileAnnotationPinRepository(new MemoryWorkspaceFs(), ROOT);
      const model = new Map<string, string>();
      for (const step of ops) {
        const key = `${step.paperId}|${step.annotationKey}`;
        if (step.kind === "save") {
          await repo.save(step);
          model.set(key, step.reportSectionId);
        } else {
          await repo.remove(step.paperId, step.annotationKey);
          model.delete(key);
        }
      }
      const pins = await repo.listForProject();
      const actual = new Map(pins.map((pin) => [`${pin.paperId}|${pin.annotationKey}`, pin.reportSectionId]));
      assert.equal(pins.length, actual.size);
      assert.deepEqual([...actual].sort(), [...model].sort());
    }),
    { numRuns: 60 },
  );
});

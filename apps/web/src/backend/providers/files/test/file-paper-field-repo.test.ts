import { before, test } from "node:test";
import assert from "node:assert/strict";
import { NotFoundError, type PaperFieldDef } from "@weaveforge/core";
import { MemoryWorkspaceFs } from "@core-test/memory-workspace-fs";
import { FilePaperRepository } from "@/features/papers/infrastructure/file-paper-repository";
import { typedCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";
import { FilePaperFieldRepository } from "../file-paper-field-repo";
import { MemorySettings } from "./memory-settings";

before(loadTestCore);

const ROOT = "thesis";
const A = `${ROOT}/papers/a.paper.md`;

async function setup() {
  const fs = new MemoryWorkspaceFs();
  const core = typedCore();
  await fs.writeFile(A, core.writePaperRow(null, { id: "a", title: "A", tags: ["x"] }) + "Body.\n");
  await fs.writeFile(`${ROOT}/papers/ünïcode b.paper.md`, core.writePaperRow(null, { id: "b", title: "Ünïcode B" }));
  const papers = new FilePaperRepository(fs, ROOT);
  const settings = new MemorySettings();
  return { fs, papers, settings, fields: new FilePaperFieldRepository(papers, settings, fs, () => ROOT) };
}

function def(over: Partial<PaperFieldDef> = {}): PaperFieldDef {
  return { id: crypto.randomUUID(), name: "Venue", kind: "select", options: ["NeurIPS", "ICML"], sortOrder: 2, ...over };
}

test("T4: definitions round-trip through settings, ordered by sortOrder then name; delete drops one", async () => {
  const { fields, settings } = await setup();
  const venue = def();
  const note = def({ name: "Note", kind: "text", options: [], sortOrder: 0 });
  await fields.saveDef(venue);
  await fields.saveDef(note);
  assert.deepEqual(await fields.listDefs(), [note, venue]);
  assert.deepEqual(settings.get(["paperFields", venue.id]), { name: "Venue", kind: "select", options: ["NeurIPS", "ICML"], sortOrder: 2 });
  await fields.deleteDef(venue.id);
  assert.deepEqual(await fields.listDefs(), [note]);
});

test("T4: text, number and list values round-trip through the paper's fields; setValue upserts", async () => {
  const { fs, papers, fields } = await setup();
  const text = def({ kind: "text", options: [] });
  const num = def({ kind: "number", options: [] });
  const multi = def({ kind: "multi_select", options: ["nlp"] });
  for (const d of [text, num, multi]) await fields.saveDef(d);
  const first = await fields.setValue({ paperId: "a", fieldId: text.id, value: "héllo «x»" });
  assert.deepEqual(first, { id: `a:${text.id}`, paperId: "a", fieldId: text.id, value: "héllo «x»" });
  await fields.setValue({ paperId: "a", fieldId: num.id, value: 4.5 });
  await fields.setValue({ paperId: "a", fieldId: multi.id, value: ["nlp"] });
  const again = await fields.setValue({ paperId: "a", fieldId: text.id, value: "bye" });
  assert.equal(again.id, first.id);
  const values = await fields.listValuesForPaper("a");
  assert.deepEqual(
    Object.fromEntries(values.map((v) => [v.fieldId, v.value])),
    { [text.id]: "bye", [num.id]: 4.5, [multi.id]: ["nlp"] },
  );
  const file = await fs.readText(A);
  assert.match(file, /^fields: \{/m);
  assert.match(file, /Body\.\n$/);
  assert.deepEqual((await papers.getById("a"))?.tags, ["x"]);
  await fields.removeValue("a", num.id);
  assert.equal((await fields.listValuesForPaper("a")).length, 2);
  assert.deepEqual(await fields.listValuesForPaper("b"), []);
  assert.equal((await fields.listValuesForProject()).length, 2);
});

test("a relation field names papers by link and reads back ids", async () => {
  const { fs, fields } = await setup();
  const rel = def({ kind: "relation", options: [] });
  await fields.saveDef(rel);
  await fields.setValue({ paperId: "a", fieldId: rel.id, value: ["b", "ghost"] });
  const file = await fs.readText(A);
  assert.match(file, /\[\[ünïcode b\.paper\]\]/);
  assert.deepEqual((await fields.listValuesForPaper("a"))[0]?.value, ["b", "ghost"]);
});

test("setValue refuses a missing paper or field; values of a deleted field stay unlisted", async () => {
  const { fs, fields } = await setup();
  const d = def({ kind: "text", options: [] });
  await fields.saveDef(d);
  await assert.rejects(fields.setValue({ paperId: "missing", fieldId: d.id, value: "x" }), NotFoundError);
  await assert.rejects(fields.setValue({ paperId: "a", fieldId: "nope", value: "x" }), NotFoundError);
  await fields.setValue({ paperId: "a", fieldId: d.id, value: "kept" });
  await fields.deleteDef(d.id);
  assert.deepEqual(await fields.listValuesForProject(), []);
  assert.match(await fs.readText(A), /kept/);
});

test("an empty folder and settings have no fields", async () => {
  const fs = new MemoryWorkspaceFs();
  const fields = new FilePaperFieldRepository(new FilePaperRepository(fs, ROOT), new MemorySettings(), fs, () => ROOT);
  assert.deepEqual(await fields.listDefs(), []);
  assert.deepEqual(await fields.listValuesForProject(), []);
});

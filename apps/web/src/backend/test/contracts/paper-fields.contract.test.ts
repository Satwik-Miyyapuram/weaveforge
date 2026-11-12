// contract-repos: paper_fields
import assert from "node:assert/strict";
import test from "node:test";
import type { Paper, PaperFieldDef } from "@weaveforge/core";
import { rustPaperFieldRepository } from "@/features/papers/infrastructure/parts-1";
import { rustPaperRepository } from "@/features/papers/infrastructure/postgrest-paper-repository";
import { testDb } from "../pg-test-db";
import { clientFor, projectFor, seedProject, sessionFor, type Db } from "./harness";

/**
 * The `IPaperFieldRepository` contract, end to end: Rust plans each query, the TS
 * sender runs it against PGlite with the real migrations and RLS. Each test
 * seeds its own user, project and paper.
 */

const NOW = "2026-06-24T00:00:00.000Z";

/** A paper in `projectId`, written as `userId`. Same project as the caller's other rows, or RLS rejects the write. */
async function seedPaper(db: Db, userId: string, projectId: string): Promise<string> {
  const paper: Paper = {
    id: crypto.randomUUID(),
    title: "Auto-Encoding Variational Bayes",
    authors: ["Kingma"],
    status: "to_read",
    tags: [],
    metadata: {},
    createdAt: NOW,
    updatedAt: NOW,
  };
  await rustPaperRepository(clientFor(db, userId), projectFor(projectId)).save(paper);
  return paper.id;
}

async function seed(db: Db, userId?: string) {
  const owner = userId ?? (await db.createUser());
  const projectId = await seedProject(db, owner);
  const paperId = await seedPaper(db, owner, projectId);
  return { userId: owner, projectId, paperId };
}

function fields(db: Db, s: { projectId: string }, userId: string) {
  return rustPaperFieldRepository(clientFor(db, userId), projectFor(s.projectId), sessionFor(userId));
}

function sampleDef(overrides: Partial<PaperFieldDef> = {}): PaperFieldDef {
  return {
    id: crypto.randomUUID(),
    name: "Venue",
    kind: "select",
    options: ["NeurIPS", "ICML"],
    sortOrder: 2,
    ...overrides,
  };
}

test("saveDef then listDefs returns every field", async () => {
  const db = await testDb();
  const s = await seed(db);
  const repo = fields(db, s, s.userId);
  const def = sampleDef();

  await repo.saveDef(def);
  const [found] = await repo.listDefs();

  assert.ok(found);
  assert.equal(found.id, def.id);
  assert.equal(found.name, "Venue");
  assert.equal(found.kind, "select");
  assert.deepEqual(found.options, ["NeurIPS", "ICML"]);
  assert.equal(found.sortOrder, 2);
});

test("deleteDef removes the definition", async () => {
  const db = await testDb();
  const s = await seed(db);
  const repo = fields(db, s, s.userId);
  const def = sampleDef();
  await repo.saveDef(def);

  await repo.deleteDef(def.id);

  assert.deepEqual(await repo.listDefs(), []);
});

test("setValue then listValuesForPaper round-trips text, number and list values", async () => {
  const db = await testDb();
  const s = await seed(db);
  const repo = fields(db, s, s.userId);
  const text = sampleDef({ name: "Note", kind: "text", options: [], sortOrder: 0 });
  const num = sampleDef({ name: "Score", kind: "number", options: [], sortOrder: 1 });
  const tags = sampleDef({ name: "Topics", kind: "multi_select", options: ["nlp", "vision"], sortOrder: 2 });
  await repo.saveDef(text);
  await repo.saveDef(num);
  await repo.saveDef(tags);

  await repo.setValue({ paperId: s.paperId, fieldId: text.id, value: "hello" });
  await repo.setValue({ paperId: s.paperId, fieldId: num.id, value: 4.5 });
  await repo.setValue({ paperId: s.paperId, fieldId: tags.id, value: ["nlp"] });
  const values = await repo.listValuesForPaper(s.paperId);

  const byField = new Map(values.map((v) => [v.fieldId, v]));
  assert.equal(values.length, 3);
  assert.equal(byField.get(text.id)?.value, "hello");
  assert.equal(byField.get(num.id)?.value, 4.5);
  assert.deepEqual(byField.get(tags.id)?.value, ["nlp"]);
  assert.equal(byField.get(text.id)?.paperId, s.paperId);
});

test("setValue upserts by paper and field and keeps the id", async () => {
  const db = await testDb();
  const s = await seed(db);
  const repo = fields(db, s, s.userId);
  const def = sampleDef({ name: "Note", kind: "text", options: [], sortOrder: 0 });
  await repo.saveDef(def);

  const first = await repo.setValue({ paperId: s.paperId, fieldId: def.id, value: "draft" });
  const second = await repo.setValue({ paperId: s.paperId, fieldId: def.id, value: "final" });
  const values = await repo.listValuesForPaper(s.paperId);

  assert.equal(second.id, first.id);
  assert.equal(values.length, 1);
  assert.equal(values[0]!.value, "final");
});

test("removeValue clears one paper's value and leaves the others", async () => {
  const db = await testDb();
  const s = await seed(db);
  const otherPaperId = await seedPaper(db, s.userId, s.projectId);
  const repo = fields(db, s, s.userId);
  const def = sampleDef({ name: "Note", kind: "text", options: [], sortOrder: 0 });
  await repo.saveDef(def);
  await repo.setValue({ paperId: s.paperId, fieldId: def.id, value: "a" });
  await repo.setValue({ paperId: otherPaperId, fieldId: def.id, value: "b" });

  await repo.removeValue(s.paperId, def.id);

  assert.deepEqual(await repo.listValuesForPaper(s.paperId), []);
  assert.equal((await repo.listValuesForProject()).length, 1);
});

test("a stranger cannot read another user's definitions or values", async () => {
  const db = await testDb();
  const s = await seed(db);
  const repo = fields(db, s, s.userId);
  const def = sampleDef({ name: "Note", kind: "text", options: [], sortOrder: 0 });
  await repo.saveDef(def);
  await repo.setValue({ paperId: s.paperId, fieldId: def.id, value: "secret" });
  const strangerId = await db.createUser();
  const stranger = fields(db, s, strangerId);

  assert.deepEqual(await stranger.listDefs(), []);
  assert.deepEqual(await stranger.listValuesForPaper(s.paperId), []);
  assert.deepEqual(await stranger.listValuesForProject(), []);
});

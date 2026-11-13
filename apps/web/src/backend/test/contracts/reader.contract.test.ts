// contract-repos: reader_annotations, annotation_pins, annotation_quotation_types
import assert from "node:assert/strict";
import test from "node:test";
import type { IAnnotationQuotationTypeRepository, NewReaderAnnotation, Paper } from "@weaveforge/core";
import { rustRepository, projectUserCtx } from "@/backend/providers/postgrest/rust-repository";
import { rustAnnotationPinRepository } from "@/features/papers/infrastructure/parts-1";
import { rustPaperRepository } from "@/features/papers/infrastructure/postgrest-paper-repository";
import { rustReaderAnnotationRepository } from "@/features/reader/infrastructure/parts-1";
import { testDb } from "../pg-test-db";
import { clientFor, projectFor, seedProject, sessionFor, type Db } from "./harness";

/**
 * The reader annotation, annotation pin and quotation type repositories, end to
 * end: Rust plans each query, the TS sender runs it against PGlite with the real
 * migrations and RLS. Each test seeds its own user, project, paper and report
 * section.
 */

const NOW = "2026-06-24T00:00:00.000Z";

type Seeded = { userId: string; projectId: string; paperId: string; reportSectionId: string };

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

async function seed(db: Db, userId?: string): Promise<Seeded> {
  const owner = userId ?? (await db.createUser());
  const projectId = await seedProject(db, owner);
  const paperId = await seedPaper(db, owner, projectId);
  const reportSectionId = crypto.randomUUID();
  await db.sql("insert into report_sections (id, user_id, title) values ($1, $2, 'Results')", [
    reportSectionId,
    owner,
  ]);
  return { userId: owner, projectId, paperId, reportSectionId };
}

function annotations(db: Db, s: Seeded, userId = s.userId) {
  return rustReaderAnnotationRepository(clientFor(db, userId), projectFor(s.projectId), sessionFor(userId));
}

function pins(db: Db, s: Seeded, userId = s.userId) {
  return rustAnnotationPinRepository(clientFor(db, userId), projectFor(s.projectId), sessionFor(userId));
}

function quotationTypes(db: Db, s: Seeded, userId = s.userId) {
  return rustRepository<IAnnotationQuotationTypeRepository>(
    clientFor(db, userId),
    "annotation_quotation_types",
    ["save", "remove", "listForPaper"],
    projectUserCtx(projectFor(s.projectId), sessionFor(userId)),
  );
}

function draft(overrides: Partial<NewReaderAnnotation> = {}): NewReaderAnnotation {
  return {
    type: "highlight",
    color: "#ffd400",
    text: "the latent variable",
    comment: "check this",
    tags: ["method"],
    anchor: { contentHash: "hash-1" },
    sortIndex: "00000|000100|00000",
    pageIndex: 3,
    ...overrides,
  };
}

// ------------------------------------------------------------ reader_annotations

test("create then list returns every field", async () => {
  const db = await testDb();
  const s = await seed(db);
  const repo = annotations(db, s);
  const input = draft();

  const created = await repo.create(s.paperId, input);
  const [found] = await repo.list(s.paperId);

  assert.ok(found);
  assert.equal(found.id, created.id);
  assert.equal(found.type, "highlight");
  assert.equal(found.color, "#ffd400");
  assert.equal(found.text, "the latent variable");
  assert.equal(found.comment, "check this");
  assert.deepEqual(found.tags, ["method"]);
  assert.deepEqual(found.anchor, { contentHash: "hash-1" });
  assert.equal(found.origin, "local");
});

test("update changes the patched fields and keeps the rest", async () => {
  const db = await testDb();
  const s = await seed(db);
  const repo = annotations(db, s);
  const created = await repo.create(s.paperId, draft());

  const updated = await repo.update(created.id, { comment: "revised", color: "#00ff00" });

  assert.equal(updated.comment, "revised");
  assert.equal(updated.color, "#00ff00");
  assert.equal(updated.text, "the latent variable");
  assert.deepEqual(updated.tags, ["method"]);
});

test("list is scoped to the paper", async () => {
  const db = await testDb();
  const s = await seed(db);
  const repo = annotations(db, s);
  const mine = await repo.create(s.paperId, draft());
  const otherPaperId = await seedPaper(db, s.userId, s.projectId);
  await repo.create(otherPaperId, draft());

  const listed = await repo.list(s.paperId);

  assert.deepEqual(
    listed.map((a) => a.id),
    [mine.id],
  );
});

test("remove deletes the annotation", async () => {
  const db = await testDb();
  const s = await seed(db);
  const repo = annotations(db, s);
  const created = await repo.create(s.paperId, draft());

  await repo.remove(created.id);

  assert.deepEqual(await repo.list(s.paperId), []);
});

test("a stranger cannot read another user's annotations", async () => {
  const db = await testDb();
  const s = await seed(db);
  await annotations(db, s).create(s.paperId, draft());
  const strangerId = await db.createUser();

  assert.deepEqual(await annotations(db, s, strangerId).list(s.paperId), []);
});

// ------------------------------------------------------------- annotation_pins

test("save then listForPaper returns every field", async () => {
  const db = await testDb();
  const s = await seed(db);
  const repo = pins(db, s);

  const saved = await repo.save({
    paperId: s.paperId,
    annotationKey: "ABCD1234",
    reportSectionId: s.reportSectionId,
  });
  const [found] = await repo.listForPaper(s.paperId);

  assert.ok(found);
  assert.equal(found.id, saved.id);
  assert.equal(found.paperId, s.paperId);
  assert.equal(found.annotationKey, "ABCD1234");
  assert.equal(found.reportSectionId, s.reportSectionId);
  assert.equal(typeof found.createdAt, "string");
});

test("listForSection is scoped to the report section", async () => {
  const db = await testDb();
  const s = await seed(db);
  const repo = pins(db, s);
  const pin = await repo.save({
    paperId: s.paperId,
    annotationKey: "KEY1",
    reportSectionId: s.reportSectionId,
  });

  const listed = await repo.listForSection(s.reportSectionId);
  const elsewhere = await repo.listForSection(crypto.randomUUID());

  assert.deepEqual(
    listed.map((p) => p.id),
    [pin.id],
  );
  assert.deepEqual(elsewhere, []);
});

test("remove deletes the pin by paper and annotation key", async () => {
  const db = await testDb();
  const s = await seed(db);
  const repo = pins(db, s);
  await repo.save({ paperId: s.paperId, annotationKey: "KEY2", reportSectionId: s.reportSectionId });

  await repo.remove(s.paperId, "KEY2");

  assert.deepEqual(await repo.listForPaper(s.paperId), []);
});

test("a stranger cannot read another user's pins", async () => {
  const db = await testDb();
  const s = await seed(db);
  await pins(db, s).save({ paperId: s.paperId, annotationKey: "KEY3", reportSectionId: s.reportSectionId });
  const strangerId = await db.createUser();

  assert.deepEqual(await pins(db, s, strangerId).listForPaper(s.paperId), []);
});

// ------------------------------------------------- annotation_quotation_types

test("save then listForPaper returns every field", async () => {
  const db = await testDb();
  const s = await seed(db);
  const repo = quotationTypes(db, s);

  const saved = await repo.save({
    paperId: s.paperId,
    annotationKey: "QT1",
    quotationType: "paraphrase",
  });
  const [found] = await repo.listForPaper(s.paperId);

  assert.ok(found);
  assert.equal(found.id, saved.id);
  assert.equal(found.paperId, s.paperId);
  assert.equal(found.annotationKey, "QT1");
  assert.equal(found.quotationType, "paraphrase");
  assert.equal(typeof found.createdAt, "string");
  assert.equal(typeof found.updatedAt, "string");
});

test("remove deletes the quotation type", async () => {
  const db = await testDb();
  const s = await seed(db);
  const repo = quotationTypes(db, s);
  await repo.save({ paperId: s.paperId, annotationKey: "QT2", quotationType: "direct" });

  await repo.remove(s.paperId, "QT2");

  assert.deepEqual(await repo.listForPaper(s.paperId), []);
});

test("a stranger cannot read another user's quotation types", async () => {
  const db = await testDb();
  const s = await seed(db);
  await quotationTypes(db, s).save({ paperId: s.paperId, annotationKey: "QT3", quotationType: "summary" });
  const strangerId = await db.createUser();

  assert.deepEqual(await quotationTypes(db, s, strangerId).listForPaper(s.paperId), []);
});

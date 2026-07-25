import { test } from "node:test";
import assert from "node:assert/strict";
import { DuplicateSharedPaperUseCase } from "../src/features/library/application/duplicate-shared-paper.use-case.js";
import { AddPaperUseCase } from "../src/features/papers/application/add-paper.use-case.js";
import { LibraryPinError } from "../src/features/library/domain/library-pin.js";
import { InMemoryPaperRepository } from "../src/testing/in-memory-paper-repository.js";
import { InMemoryShareRepository } from "../src/testing/in-memory-share-repository.js";

const clock = { nowIso: () => "2026-01-01T00:00:00.000Z" };
const ids = { newId: () => "copy-1" };

test("duplicate paper creates an owned copy when shared", async () => {
  const ownerPapers = new InMemoryPaperRepository("alice");
  await ownerPapers.save({
    id: "p1",
    title: "Attention",
    authors: ["Vaswani"],
    tags: [],
    metadata: {},
    status: "to_read",
    createdAt: clock.nowIso(),
    updatedAt: clock.nowIso(),
  });

  const shares = new InMemoryShareRepository("alice");
  await shares.grant({
    recipientId: "me",
    resourceType: "paper",
    resourceId: "p1",
    access: "view",
  });
  shares.setCurrent("me");

  const myPapers = new InMemoryPaperRepository("me");
  // Recipient reads via RLS simulation: seed owner's paper visible to getById
  await myPapers.save({
    id: "p1",
    title: "Attention",
    authors: ["Vaswani"],
    tags: [],
    metadata: {},
    status: "to_read",
    createdAt: clock.nowIso(),
    updatedAt: clock.nowIso(),
  });

  const addPaper = new AddPaperUseCase({ repository: myPapers, clock, ids });
  const uc = new DuplicateSharedPaperUseCase({ shares, papers: myPapers, addPaper });

  const copy = await uc.execute({ resourceId: "p1", ownerId: "alice" });
  assert.equal(copy.title, "Attention (copy)");
  assert.equal(copy.authors[0], "Vaswani");
  assert.notEqual(copy.id, "p1");
});

test("duplicate paper rejects without share", async () => {
  const shares = new InMemoryShareRepository("alice");
  shares.setCurrent("me");
  const papers = new InMemoryPaperRepository("me");
  const addPaper = new AddPaperUseCase({ repository: papers, clock, ids });
  const uc = new DuplicateSharedPaperUseCase({ shares, papers, addPaper });

  await assert.rejects(
    () => uc.execute({ resourceId: "p1", ownerId: "alice" }),
    LibraryPinError,
  );
});

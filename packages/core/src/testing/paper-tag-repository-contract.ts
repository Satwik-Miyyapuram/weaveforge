import { test } from "node:test";
import assert from "node:assert/strict";
import type { PaperTag, TagSource } from "../features/tags/domain/tag.js";
import type { IPaperTagRepository } from "../features/tags/domain/tag-repository.js";

function link(
  paperId: string,
  tagId: string,
  source: TagSource = "manual",
): PaperTag {
  return { paperId, tagId, source };
}

export function runPaperTagRepositoryContract(
  label: string,
  makeRepo: () => IPaperTagRepository,
): void {
  test(`[${label}] link then listForPaper`, async () => {
    const repo = makeRepo();
    await repo.link(link("p1", "t1"));
    const links = await repo.listForPaper("p1");
    assert.equal(links.length, 1);
    assert.equal(links[0]!.tagId, "t1");
  });

  test(`[${label}] unlink removes matching source only`, async () => {
    const repo = makeRepo();
    await repo.link(link("p1", "t1", "manual"));
    await repo.link(link("p1", "t1", "zotero_annotation"));
    await repo.unlink("p1", "t1", "manual");
    const links = await repo.listForPaper("p1");
    assert.equal(links.length, 1);
    assert.equal(links[0]!.source, "zotero_annotation");
  });

  test(`[${label}] reconcile replaces links for given sources`, async () => {
    const repo = makeRepo();
    await repo.link(link("p1", "t1", "manual"));
    await repo.link(link("p1", "t2", "manual"));
    await repo.reconcile("p1", [link("p1", "t3", "manual")], ["manual"]);
    const links = await repo.listForPaper("p1");
    assert.equal(links.length, 1);
    assert.equal(links[0]!.tagId, "t3");
  });

  test(`[${label}] listForTag returns all memberships`, async () => {
    const repo = makeRepo();
    await repo.link(link("p1", "t1"));
    await repo.link(link("p2", "t1"));
    assert.equal((await repo.listForTag("t1")).length, 2);
  });
}

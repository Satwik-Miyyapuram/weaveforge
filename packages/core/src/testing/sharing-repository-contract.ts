/**
 * Shared CONTRACT suites for IShareRepository and ICommentRepository. Every
 * implementation (in-memory, Supabase) must pass these identical checks (Liskov).
 * The factories return a repo already scoped to a signed-in user.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { IShareRepository } from "../features/sharing/domain/share-repository.js";
import type { ICommentRepository } from "../features/sharing/domain/comment-repository.js";

export function runShareRepositoryContract(
  label: string,
  makeRepo: () => IShareRepository,
): void {
  test(`[${label}] grant then listForResource returns the grant`, async () => {
    const repo = makeRepo();
    const s = await repo.grant({ recipientId: "bob", resourceType: "milestone", resourceId: "m1" });
    assert.equal(s.recipientId, "bob");
    assert.equal(s.access, "comment"); // default
    const list = await repo.listForResource("milestone", "m1");
    assert.equal(list.length, 1);
    assert.equal(list[0]?.recipientId, "bob");
  });

  test(`[${label}] grant is idempotent and updates access`, async () => {
    const repo = makeRepo();
    await repo.grant({ recipientId: "bob", resourceType: "milestone", resourceId: "m1", access: "comment" });
    await repo.grant({ recipientId: "bob", resourceType: "milestone", resourceId: "m1", access: "view" });
    const list = await repo.listForResource("milestone", "m1");
    assert.equal(list.length, 1);
    assert.equal(list[0]?.access, "view");
  });

  test(`[${label}] blanket grant (null resource) is separate from per-item`, async () => {
    const repo = makeRepo();
    await repo.grant({ recipientId: "bob", resourceType: "experiment", resourceId: "e1" });
    await repo.grant({ recipientId: "carol", resourceType: "experiment", resourceId: null });
    assert.equal((await repo.listForResource("experiment", "e1")).length, 1);
    assert.equal((await repo.listForResource("experiment", null)).length, 1);
  });

  test(`[${label}] revoke removes the grant`, async () => {
    const repo = makeRepo();
    const s = await repo.grant({ recipientId: "bob", resourceType: "milestone", resourceId: "m1" });
    await repo.revoke(s.id);
    assert.equal((await repo.listForResource("milestone", "m1")).length, 0);
  });
}

export function runCommentRepositoryContract(
  label: string,
  makeRepo: () => ICommentRepository,
): void {
  test(`[${label}] add then list returns oldest-first`, async () => {
    const repo = makeRepo();
    await repo.add({ resourceType: "milestone", resourceId: "m1", body: "first" });
    await repo.add({ resourceType: "milestone", resourceId: "m1", body: "second" });
    const list = await repo.list("milestone", "m1");
    assert.deepEqual(list.map((c) => c.body), ["first", "second"]);
  });

  test(`[${label}] list scopes to the resource`, async () => {
    const repo = makeRepo();
    await repo.add({ resourceType: "milestone", resourceId: "m1", body: "a" });
    await repo.add({ resourceType: "experiment", resourceId: "e1", body: "b" });
    assert.equal((await repo.list("milestone", "m1")).length, 1);
  });

  test(`[${label}] remove deletes a comment`, async () => {
    const repo = makeRepo();
    const c = await repo.add({ resourceType: "milestone", resourceId: "m1", body: "x" });
    await repo.remove(c.id);
    assert.equal((await repo.list("milestone", "m1")).length, 0);
  });
}

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ManageCommentsUseCase,
  type Comment,
  type NewCommentInput,
  type ICommentRepository,
} from "../../../src/index.js";

class InMemoryCommentRepo implements ICommentRepository {
  readonly rows: Comment[] = [];
  lastAddInput: NewCommentInput | null = null;
  private n = 0;
  async list(resourceType: string, resourceId: string) {
    return this.rows.filter((c) => c.resourceType === resourceType && c.resourceId === resourceId);
  }
  async add(input: NewCommentInput) {
    this.lastAddInput = input;
    const comment: Comment = {
      id: `c-${++this.n}`,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      body: input.body,
      authorId: "user-1",
      createdAt: "2026-07-23T09:00:00.000Z",
    } as Comment;
    this.rows.push(comment);
    return comment;
  }
  async save(comment: Comment) {
    this.rows.push(comment);
    return comment;
  }
  async listAll() {
    return [...this.rows];
  }
  async remove(id: string) {
    const i = this.rows.findIndex((c) => c.id === id);
    if (i >= 0) this.rows.splice(i, 1);
  }
  async setResolved(id: string, resolved: boolean) {
    const c = this.rows.find((r) => r.id === id);
    if (c) c.resolvedAt = resolved ? "2026-07-23T10:00:00.000Z" : null;
    return c?.resolvedAt ?? null;
  }
}

test("add: normalizes (trims body) before delegating to the repository", async () => {
  const repo = new InMemoryCommentRepo();
  const uc = new ManageCommentsUseCase({ repository: repo });
  const comment = await uc.add({ resourceType: "paper", resourceId: "p1", body: "  looks good  " });
  assert.equal(comment.body, "looks good");
  assert.equal(repo.lastAddInput?.body, "looks good");
});

test("add: rejects an empty body and a missing resource", async () => {
  const uc = new ManageCommentsUseCase({ repository: new InMemoryCommentRepo() });
  await assert.rejects(uc.add({ resourceType: "paper", resourceId: "p1", body: "   " }), /can't be empty/);
  await assert.rejects(uc.add({ resourceType: "paper", resourceId: "", body: "hi" }), /target resource is required/);
});

test("list: returns only comments for the given resource; remove deletes", async () => {
  const repo = new InMemoryCommentRepo();
  const uc = new ManageCommentsUseCase({ repository: repo });
  const a = await uc.add({ resourceType: "paper", resourceId: "p1", body: "one" });
  await uc.add({ resourceType: "paper", resourceId: "p2", body: "two" });
  assert.deepEqual((await uc.list("paper", "p1")).map((c) => c.body), ["one"]);
  await uc.remove(a.id);
  assert.equal((await uc.list("paper", "p1")).length, 0);
});

test("add: keeps an anchor on a root and drops one on a reply", async () => {
  const repo = new InMemoryCommentRepo();
  const uc = new ManageCommentsUseCase({ repository: repo });
  const anchor = { quote: "the claim", prefix: "a ", suffix: " b" };
  await uc.add({ resourceType: "vault_page", resourceId: "n1", body: "why", anchor });
  assert.deepEqual(repo.lastAddInput?.anchor, anchor);
  await uc.add({ resourceType: "vault_page", resourceId: "n1", body: "because", anchor, parentId: "c-1" });
  assert.equal(repo.lastAddInput?.anchor, null);
  assert.equal(repo.lastAddInput?.parentId, "c-1");
});

test("add: a blank quote is no anchor at all", async () => {
  const repo = new InMemoryCommentRepo();
  const uc = new ManageCommentsUseCase({ repository: repo });
  await uc.add({ resourceType: "vault_page", resourceId: "n1", body: "hm", anchor: { quote: "  ", prefix: "", suffix: "" } });
  assert.equal(repo.lastAddInput?.anchor, null);
});

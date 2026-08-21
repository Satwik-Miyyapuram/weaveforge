import { test } from "node:test";
import assert from "node:assert/strict";
import {
  shareAllowsComment,
  shareAllowsEdit,
  shareCoversResource,
  type Share,
} from "../../../src/features/sharing/domain/share.js";

const base = (over: Partial<Share>): Share => ({
  id: "s1",
  ownerId: "alice",
  recipientId: "bob",
  resourceType: "paper",
  resourceId: "p1",
  access: "comment",
  createdAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

test("shareCoversResource matches exact resource", () => {
  assert.equal(shareCoversResource(base({}), "paper", "p1", "alice"), true);
  assert.equal(shareCoversResource(base({}), "paper", "p2", "alice"), false);
});

test("shareCoversResource matches blanket grant", () => {
  assert.equal(
    shareCoversResource(base({ resourceId: null }), "paper", "p9", "alice"),
    true,
  );
});

test("shareAllowsComment requires comment or edit access", () => {
  assert.equal(shareAllowsComment(base({}), "paper", "p1", "alice"), true);
  assert.equal(shareAllowsComment(base({ access: "edit" }), "paper", "p1", "alice"), true);
  assert.equal(
    shareAllowsComment(base({ access: "view" }), "paper", "p1", "alice"),
    false,
  );
});

test("shareAllowsEdit requires edit access", () => {
  assert.equal(shareAllowsEdit(base({ access: "edit" }), "paper", "p1", "alice"), true);
  assert.equal(shareAllowsEdit(base({ access: "comment" }), "paper", "p1", "alice"), false);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import type { AiWriteProposal } from "@weaveforge/core";
import { groupProposals, runBulk } from "../application/proposal-groups";

function proposal(id: string, kind: AiWriteProposal["kind"], resourceId: string): AiWriteProposal {
  return { id, kind, resourceId, content: id, createdAt: "2026-11-05T00:00:00Z", status: "pending", sourceLinks: [] };
}

const items = [
  proposal("a", "append_paper_note", "paper-1"),
  proposal("b", "relation", "paper-2"),
  proposal("c", "append_paper_note", "paper-2"),
  proposal("d", "relation", "paper-1"),
  proposal("e", "create_vault_note", "paper-1"),
];

test("groups by document in first-seen order, keeping item order inside each group", () => {
  const groups = groupProposals(items, "document");
  assert.deepEqual(
    groups.map((group) => [group.key, group.items.map((item) => item.id)]),
    [
      ["paper-1", ["a", "d", "e"]],
      ["paper-2", ["b", "c"]],
    ],
  );
});

test("groups by kind in first-seen order", () => {
  const groups = groupProposals(items, "kind");
  assert.deepEqual(
    groups.map((group) => [group.key, group.items.map((item) => item.id)]),
    [
      ["append_paper_note", ["a", "c"]],
      ["relation", ["b", "d"]],
      ["create_vault_note", ["e"]],
    ],
  );
});

test("no proposals, no groups", () => {
  assert.deepEqual(groupProposals([], "document"), []);
  assert.deepEqual(groupProposals([], "kind"), []);
});

test("bulk applies every proposal exactly once, even when an id repeats", async () => {
  const seen: string[] = [];
  const result = await runBulk(["a", "b", "a", "c"], async (id) => {
    seen.push(id);
    return "accepted";
  });
  assert.deepEqual(seen, ["a", "b", "c"]);
  assert.deepEqual(result, { done: ["a", "b", "c"], conflicted: [], failed: null, untouched: [] });
});

test("a conflict is reported and the batch carries on", async () => {
  const result = await runBulk(["a", "b", "c"], async (id) => (id === "b" ? "conflicted" : "accepted"));
  assert.deepEqual(result.done, ["a", "c"]);
  assert.deepEqual(result.conflicted, ["b"]);
  assert.equal(result.failed, null);
});

test("a failed apply stops the batch and leaves the rest pending", async () => {
  const seen: string[] = [];
  const result = await runBulk(["a", "b", "c", "d"], async (id) => {
    seen.push(id);
    if (id === "b") throw new Error("network down");
    return "accepted";
  });
  assert.deepEqual(seen, ["a", "b"]);
  assert.deepEqual(result.done, ["a"]);
  assert.equal(result.failed?.id, "b");
  assert.equal((result.failed?.error as Error).message, "network down");
  assert.deepEqual(result.untouched, ["c", "d"]);
});

test("a reject (void result) counts as done", async () => {
  const result = await runBulk(["a"], async () => undefined);
  assert.deepEqual(result.done, ["a"]);
});

// A "create" suggestion has no document yet: its resource id is a fresh random
// id, so grouping by it gave one group per suggestion, headed by that id.
// Ids that resolve to nothing are grouped under their kind instead.
test("by document, unknown targets are grouped under their kind", () => {
  const known = (id: string) => id === "paper-1";
  const groups = groupProposals([
    proposal("a", "create_log_entry", "rand-1"),
    proposal("b", "append_paper_note", "paper-1"),
    proposal("c", "create_log_entry", "rand-2"),
  ], "document", known);
  assert.deepEqual(
    groups.map((group) => [group.key, group.items.map((item) => item.id)]),
    [["kind:create_log_entry", ["a", "c"]], ["paper-1", ["b"]]],
  );
});

test("by document with no lookup keeps resource ids", () => {
  assert.deepEqual(groupProposals(items, "document").map((group) => group.key), ["paper-1", "paper-2"]);
});

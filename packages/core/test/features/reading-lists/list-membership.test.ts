/**
 * buildListMembership: the map four screens built by hand.
 *
 * It replaces the same five lines in the papers, vault and graph screens and the
 * lists facade. The cases below are the behaviours those copies had — or in one
 * case, quietly did not have and needed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildListMembership,
  paperIdOfItem,
  resourceIdOfItem,
  vaultPageIdOfItem,
} from "../../../src/features/reading-lists/application/list-membership.js";
import type { ReadingListItem } from "../../../src/features/reading-lists/domain/reading-list.js";

const list = (id: string) => ({ id });

const item = (listId: string, over: Partial<ReadingListItem> = {}): ReadingListItem => ({
  id: `item-${listId}-${over.paperId ?? over.vaultPageId ?? "x"}`,
  listId,
  sortOrder: 0,
  ...over,
});

test("every list gets an entry, including the empty ones", () => {
  // The list filter asks `membership.get(listId)`; a missing key reads as "no
  // list selected" rather than "nothing in this list", which filters the screen
  // down to nothing.
  const membership = buildListMembership([list("a"), list("b")], [], paperIdOfItem);

  assert.deepEqual([...membership.keys()], ["a", "b"]);
  assert.deepEqual([...membership.get("a")!], []);
});

test("items land under their own list, by the id the caller selects", () => {
  const membership = buildListMembership(
    [list("a"), list("b")],
    [item("a", { paperId: "p1" }), item("a", { paperId: "p2" }), item("b", { paperId: "p3" })],
    paperIdOfItem,
  );

  assert.deepEqual([...membership.get("a")!].sort(), ["p1", "p2"]);
  assert.deepEqual([...membership.get("b")!], ["p3"]);
});

test("the vault screen reads the page id, not the paper id", () => {
  const membership = buildListMembership(
    [list("a")],
    [item("a", { vaultPageId: "v1" })],
    vaultPageIdOfItem,
  );

  assert.deepEqual([...membership.get("a")!], ["v1"]);
});

test("the graph screen links either kind through one membership", () => {
  const membership = buildListMembership(
    [list("a")],
    [item("a", { paperId: "p1" }), item("a", { vaultPageId: "v1" })],
    resourceIdOfItem,
  );

  assert.deepEqual([...membership.get("a")!].sort(), ["p1", "v1"]);
});

test("a row naming no resource, or a list that is not there, is skipped", () => {
  // A reading_list_items row is one or the other by check constraint, but a row
  // whose list was deleted still arrives in the item list.
  const membership = buildListMembership(
    [list("a")],
    [item("a"), item("gone", { paperId: "p9" })],
    paperIdOfItem,
  );

  assert.deepEqual([...membership.get("a")!], []);
  assert.equal(membership.has("gone"), false, "and it does not invent a list for it");
});

test("a duplicate is a set, not a second entry", () => {
  const membership = buildListMembership(
    [list("a")],
    [item("a", { paperId: "p1" }), item("a", { paperId: "p1" })],
    paperIdOfItem,
  );

  assert.deepEqual([...membership.get("a")!], ["p1"]);
});

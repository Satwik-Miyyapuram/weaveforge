// Proves the Rust `buildListTree` (wf-core reading_lists::reading_list) returns the same nested
// tree as the TS original in packages/core/src/features/reading-lists/domain/reading-list.ts.
// createReadingList has no Rust port (the caller builds the record), so it is not compared here.

import { before, test } from "node:test";
import assert from "node:assert/strict";
import * as ts from "@weaveforge/core";
import type { RustCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";

let rs: RustCore;
before(async () => {
  rs = await loadTestCore();
});

/** Mulberry32, so a failure reproduces from the seed. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rand: () => number, items: readonly T[]): T {
  return items[Math.floor(rand() * items.length)]!;
}

/** JSON round trip: TS leaves `undefined` keys that serde omits; both mean "absent". */
const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value)) as unknown;

type Lists = Parameters<typeof ts.buildListTree>[0];
type List = Lists[number];

// Unicode spaces, combining marks, ligatures and emoji: localeCompare must agree with the port.
const NAMES = [
  "", " ", " ", " Intro ", "﻿Hidden", "Ölçü", "éclair", "école",
  "ǆ", "ß", "straße", "Strasse", "🙂 smile", "b", "A", "a", "Beta", "beta", "line\nbreak",
];
const SORT_ORDERS = [0, -1, 1, 1.5, 1e15, -0.5];
const IDS = ["a", "b", "c", "d", "e", "", "dup"];

function randomLists(rand: () => number): Lists {
  const count = Math.floor(rand() * 9);
  return Array.from({ length: count }, (_, i): List => {
    const parentId = rand() < 0.3 ? undefined : pick(rand, IDS);
    return {
      // Ids drawn from a small pool: duplicates, self-parents and parent loops occur.
      id: rand() < 0.2 ? pick(rand, IDS) : `l${i}`,
      name: pick(rand, NAMES),
      description: rand() < 0.5 ? pick(rand, NAMES) : undefined,
      parentId,
      sortOrder: pick(rand, SORT_ORDERS),
      color: rand() < 0.5 ? "#ff0000" : undefined,
      createdAt: "2026-11-05T00:00:00.000Z",
    };
  });
}

test("buildListTree matches TS on seeded flat lists (nesting, sort, orphans, loops)", () => {
  for (let seed = 1; seed <= 400; seed += 1) {
    const lists = randomLists(random(seed));
    assert.deepEqual(plain(rs.buildListTree(lists)), plain(ts.buildListTree(lists)), `seed ${seed}`);
  }
});

test("buildListTree: names differing only by case, accent or Unicode space order alike", () => {
  const lists: Lists = NAMES.map((name, i) => ({
    id: `n${i}`, name, sortOrder: 0, createdAt: "x",
  }));
  assert.deepEqual(plain(rs.buildListTree(lists)), plain(ts.buildListTree(lists)));
});

test("buildListTree: equal sortOrder falls back to name, and sortOrder beats name", () => {
  const lists: Lists = [
    { id: "x", name: "A", sortOrder: 2, createdAt: "x" },
    { id: "y", name: "z", sortOrder: 1, createdAt: "x" },
    { id: "w", name: "b", sortOrder: 1, createdAt: "x" },
  ];
  assert.deepEqual(plain(rs.buildListTree(lists)), plain(ts.buildListTree(lists)));
});

test("buildListTree: duplicate ids and self-parents match TS", () => {
  const lists: Lists = [
    { id: "p", name: "P", sortOrder: 0, createdAt: "x" },
    { id: "p", name: "P again", sortOrder: 0, parentId: "p", createdAt: "x" },
    { id: "s", name: "Self", sortOrder: 0, parentId: "s", createdAt: "x" },
    { id: "c", name: "Child", sortOrder: 0, parentId: "p", createdAt: "x" },
  ];
  assert.deepEqual(plain(rs.buildListTree(lists)), plain(ts.buildListTree(lists)));
});

test("buildListTree: empty, missing and empty-string parents are top level", () => {
  const lists: Lists = [
    { id: "x", name: "X", sortOrder: 0, parentId: "gone", createdAt: "x" },
    { id: "y", name: "Y", sortOrder: 0, parentId: "", createdAt: "x" },
    { id: "z", name: "Z", sortOrder: 0, createdAt: "x" },
  ];
  assert.deepEqual(plain(rs.buildListTree(lists)), plain(ts.buildListTree(lists)));
  assert.deepEqual(plain(rs.buildListTree([])), plain(ts.buildListTree([])));
});

test("buildListTree: numeric sortOrder edges (0, -1, 1.5, large) compare numerically", () => {
  const lists: Lists = [1e15, 1.5, 0, -1, -0.5, 1].map((sortOrder, i) => ({
    id: `s${i}`, name: "same", sortOrder, createdAt: "x",
  }));
  assert.deepEqual(plain(rs.buildListTree(lists)), plain(ts.buildListTree(lists)));
});

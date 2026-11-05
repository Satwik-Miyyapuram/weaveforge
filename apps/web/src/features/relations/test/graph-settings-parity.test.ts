import { before, test } from "node:test";
import assert from "node:assert/strict";
import * as ts from "@weaveforge/core";
import type { RustCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";

// Proves the Rust graph settings return exactly what the TS originals in
// packages/core/src/features/relations/domain/graph-view-settings.ts and
// graph-persisted-state.ts return. Inputs are seeded, so a failure reproduces from the seed.

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

const SEEDS = Array.from({ length: 500 }, (_, i) => i + 1);

// No -0: the JS-to-JSON bridge reads it as 0. No split surrogate pairs past 80 units.
const NUMBERS = [0, 1, 2.5, -22, 0.55, 1e9, Number.NaN, Number.POSITIVE_INFINITY];
const JUNK: unknown[] = [null, undefined, "x", "", true, false, [], {}, 3, ...NUMBERS];
const HEXES = ["#abcdef", "#ABCDEF", "#abc", "abcdef1", "#abcdeg", "#00ff00\n", "#123456"];
const QUERIES = ["tag:x", "list:y", "", "  words ", "x".repeat(90), "é".repeat(85), "a\u{1F600}b"];

function maybe<T>(rand: () => number, good: () => T): unknown {
  const r = rand();
  if (r < 0.35) return undefined;
  if (r < 0.55) return pick(rand, JUNK);
  return good();
}

function settingsLike(rand: () => number): unknown {
  if (rand() < 0.08) return pick(rand, JUNK);
  const o: Record<string, unknown> = {
    edgeMode: maybe(rand, () => pick(rand, ["cites", "tags", "both", "CITES"])),
    colorBy: maybe(rand, () => pick(rand, ["status", "tag", "list", "type", "year", "degree", "cluster", "groups", "x"])),
    groupBy: maybe(rand, () => pick(rand, ["none", "status", "list", "tag"])),
    layout: maybe(rand, () => pick(rand, ["force", "timeline", "grid"])),
    showConcepts: maybe(rand, () => rand() < 0.5),
    minConceptDegree: maybe(rand, () => pick(rand, NUMBERS)),
    hideOrphans: maybe(rand, () => rand() < 0.5),
    relationTypes: maybe(rand, () =>
      Array.from({ length: Math.floor(rand() * 4) }, () =>
        pick(rand, ["cites", "extends", "contradicts", "similar", "builds_on", "uses_method", "nope", 3, null]),
      ),
    ),
    showConceptCooccurrence: maybe(rand, () => rand() < 0.5),
    searchQuery: maybe(rand, () => pick(rand, ["", "  ", "q", " q "])),
    textFadeThreshold: maybe(rand, () => pick(rand, NUMBERS)),
    nodeSize: maybe(rand, () => pick(rand, NUMBERS)),
    linkThickness: maybe(rand, () => pick(rand, NUMBERS)),
    showAutoStyle: maybe(rand, () => rand() < 0.5),
    centerStrength: maybe(rand, () => pick(rand, NUMBERS)),
    chargeStrength: maybe(rand, () => pick(rand, NUMBERS)),
    linkDistance: maybe(rand, () => pick(rand, NUMBERS)),
    nodePalette: maybe(rand, () => pick(rand, ["theme", "classic", "dark"])),
    nodeColors: maybe(rand, () =>
      Object.fromEntries(
        ["paper", "to_read", "reading", "read", "skimmed", "note", "report", "experiment", "other"]
          .filter(() => rand() < 0.5)
          .map((k) => [k, rand() < 0.8 ? pick(rand, HEXES) : pick(rand, JUNK)]),
      ),
    ),
    colorGroups: maybe(rand, () =>
      Array.from({ length: Math.floor(rand() * 16) }, () =>
        rand() < 0.15 ? pick(rand, JUNK) : { query: rand() < 0.9 ? pick(rand, QUERIES) : 1, color: pick(rand, HEXES) },
      ),
    ),
    includeListsAsConcepts: maybe(rand, () => rand() < 0.5),
    boundedZoomScale: maybe(rand, () => rand() < 0.5),
  };
  return o;
}

test("normalizeGraphViewSettings matches TS", () => {
  assert.deepEqual(rs.defaultGraphSettings(), ts.DEFAULT_GRAPH_SETTINGS);
  for (const seed of SEEDS) {
    const raw = settingsLike(random(seed));
    assert.deepEqual(rs.normalizeGraphViewSettings(raw), ts.normalizeGraphViewSettings(raw), `seed ${seed}`);
  }
});

test("edge predicates and graphFilterCount match TS", () => {
  for (const seed of SEEDS) {
    const rand = random(seed);
    const settings = ts.normalizeGraphViewSettings(settingsLike(rand));
    if (rand() < 0.2) settings.relationTypes = [];
    if (rand() < 0.2) delete settings.includeListsAsConcepts;
    const tags = Array.from({ length: Math.floor(rand() * 3) }, () => "t");
    const lists = Array.from({ length: Math.floor(rand() * 3) }, () => "l");
    assert.deepEqual(rs.effectiveRelationTypes(settings), ts.effectiveRelationTypes(settings), `seed ${seed}`);
    assert.equal(rs.showRelationEdges(settings), ts.showRelationEdges(settings), `seed ${seed}`);
    assert.equal(rs.showConceptEdges(settings), ts.showConceptEdges(settings), `seed ${seed}`);
    assert.equal(rs.graphFilterCount(tags, lists, settings), ts.graphFilterCount(tags, lists, settings), `seed ${seed}`);
  }
});

test("parseGraphPersistedState matches TS", () => {
  for (const seed of SEEDS) {
    const rand = random(seed);
    const raw =
      rand() < 0.1
        ? pick(rand, JUNK)
        : {
            settings: maybe(rand, () => settingsLike(rand)),
            selectedLists: maybe(rand, () => ["a", "", 3, "b"].filter(() => rand() < 0.6)),
            selectedTags: maybe(rand, () => ["x", "", null, "y"].filter(() => rand() < 0.6)),
            localSeed: maybe(rand, () => pick(rand, ["", "p1"])),
            localDepth: maybe(rand, () => pick(rand, [0, 1, 1.5, 2.5, 3.49, 7, -2, ...NUMBERS])),
            pinned: maybe(rand, () =>
              Object.fromEntries(
                ["n1", "n2", "10", "2", "n3"]
                  .filter(() => rand() < 0.6)
                  .map((id) => [id, rand() < 0.7 ? { x: pick(rand, NUMBERS), y: pick(rand, NUMBERS) } : pick(rand, JUNK)]),
              ),
            ),
          };
    assert.deepEqual(rs.parseGraphPersistedState(raw), ts.parseGraphPersistedState(raw), `seed ${seed}`);
  }
});

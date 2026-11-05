import { before, test } from "node:test";
import assert from "node:assert/strict";
import * as ts from "@weaveforge/core";
import { loadTestCore } from "@/lib/test/load-test-core";

// Proves the Rust ink undo stack matches packages/core/src/reader/ink-undo.ts on seeded inputs.

// Typed as core: the bindings' mutable arrays reject core's readonly ones; runtime parity is what we test.
let rs: typeof ts;
before(async () => { rs = (await loadTestCore()) as unknown as typeof ts; });

/** Mulberry32, so a failure reproduces from the seed. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), state | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEEDS = Array.from({ length: 300 }, (_, i) => i + 1);
const pick = <T>(rand: () => number, items: readonly T[]): T => items[Math.floor(rand() * items.length)]!;
/** Inclusive integer in `lo..hi`; never yields -0. */
const int = (rand: () => number, lo: number, hi: number): number => Math.floor(rand() * (hi - lo + 1)) + lo;
/** JSON round trip: TS leaves `undefined` keys that serde omits; both mean "absent". */
const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value)) as unknown;

type State = Parameters<typeof ts.pushInkUndo>[0];
type Entry = Parameters<typeof ts.pushInkUndo>[1];
type Annotation = Extract<Entry, { kind: "create" }>["annotation"];
type Patch = Extract<Entry, { kind: "update" }>["before"];
type Step = { state: State; entry: Entry } | null; type Both = { ts: State; rs: State };
const IDS = ["a", "b", "c", "a2"];
const WORDS = ["", "ink", "Ölçü", "line\nbreak", "émile", "  spaced  "];
/** Required fields only; callers add the optional `syncState` and `zoteroVersion`. */
const BASE: Annotation = {
  id: "a", origin: "zotero", zoteroKey: "K1", type: "ink", color: "#ff0000", text: "", comment: "first",
  tags: ["t1", "é"], anchor: { contentHash: "hash" }, sortIndex: "00000|000000|00000",
  createdAt: "2026-11-05T00:00:00.000Z", updatedAt: "2026-11-05T00:00:00.000Z",
};
const UNDO = () => [ts.takeInkUndo, rs.takeInkUndo] as const, REDO = () => [ts.takeInkRedo, rs.takeInkRedo] as const;
const freshBoth = (): Both => ({ ts: ts.EMPTY_INK_UNDO, rs: rs.EMPTY_INK_UNDO });

function randomAnnotation(rand: () => number, id: string): Annotation {
  const annotation: Annotation = {
    ...BASE, id, origin: pick(rand, ["zotero", "local"] as const), zoteroKey: pick(rand, [null, "K1"]),
    comment: pick(rand, WORDS), tags: rand() < 0.5 ? [] : ["t1"], anchor: rand() < 0.5 ? {} : { contentHash: "h" },
  };
  if (rand() < 0.5) annotation.syncState = pick(rand, ["local", "synced", "pending", "conflict"] as const);
  if (rand() < 0.5) annotation.zoteroVersion = pick(rand, [null, 0, 42]);
  return annotation;
}

function randomPatch(rand: () => number): Patch {
  const patch: Patch = {};
  if (rand() < 0.5) patch.color = "#00ff00";
  if (rand() < 0.5) patch.comment = pick(rand, WORDS);
  if (rand() < 0.5) patch.tags = ["x"];
  if (rand() < 0.5) patch.text = pick(rand, WORDS);
  return patch;
}

function randomEntry(rand: () => number): Entry {
  const id = pick(rand, IDS);
  const anchor = () => (rand() < 0.5 ? {} : { contentHash: pick(rand, WORDS) });
  switch (int(rand, 0, 4)) {
    case 0: return { kind: "create", annotation: randomAnnotation(rand, id) };
    case 1: return { kind: "remove", annotation: randomAnnotation(rand, id) };
    case 2:
      return { kind: "removeMany", annotations: Array.from({ length: int(rand, 0, 3) }, () => randomAnnotation(rand, pick(rand, IDS))) };
    case 3: return { kind: "anchor", id, before: anchor(), after: anchor() };
    default: return { kind: "update", id, before: randomPatch(rand), after: randomPatch(rand) };
  }
}

/** Both sides take one step; the results must match, then both states advance. */
function takeBoth(take: readonly [(s: State) => Step, (s: State) => Step], both: Both, label: string): void {
  const t = take[0](both.ts);
  const r = take[1](both.rs);
  assert.deepEqual(plain(r ?? null), plain(t), label);
  if (t && r) {
    both.ts = t.state;
    both.rs = r.state;
  }
}

test("ink undo: Rust and TS agree on seeded push, undo, redo, rename and refresh sequences", () => {
  for (const seed of SEEDS) {
    const rand = random(seed);
    const both = freshBoth();
    for (let i = 0; i < 40; i += 1) {
      const op = int(rand, 0, 6);
      const label = `seed ${seed} step ${i} op ${op}`;
      if (op <= 2) {
        const entry = randomEntry(rand);
        both.ts = ts.pushInkUndo(both.ts, entry);
        both.rs = rs.pushInkUndo(both.rs, entry);
      } else if (op === 3) takeBoth(UNDO(), both, label);
      else if (op === 4) takeBoth(REDO(), both, label);
      else if (op === 5) {
        const from = pick(rand, IDS);
        const to = pick(rand, ["z", "a", "a2"]);
        both.ts = ts.renameInkUndoId(both.ts, from, to);
        both.rs = rs.renameInkUndoId(both.rs, from, to);
      } else {
        const annotation = randomAnnotation(rand, pick(rand, IDS));
        both.ts = ts.refreshInkUndoAnnotation(both.ts, annotation);
        both.rs = rs.refreshInkUndoAnnotation(both.rs, annotation);
      }
      assert.deepEqual(plain(both.rs), plain(both.ts), `${label} state`);
    }
  }
});

test("ink undo: full, minimal and null-version annotations survive undo and redo unchanged", () => {
  const annotations: Annotation[] = [
    { ...BASE, syncState: "conflict", zoteroVersion: 7 }, BASE, { ...BASE, zoteroVersion: null }, { ...BASE, syncState: "local" },
  ];
  for (const annotation of annotations) {
    const entry: Entry = { kind: "remove", annotation };
    const both = freshBoth();
    both.ts = ts.pushInkUndo(both.ts, entry);
    both.rs = rs.pushInkUndo(both.rs, entry);
    takeBoth(UNDO(), both, JSON.stringify(annotation));
    const undone = ts.takeInkUndo(ts.pushInkUndo(ts.EMPTY_INK_UNDO, entry));
    assert.deepEqual([plain(undone?.entry), plain(rs.takeInkUndo(rs.pushInkUndo(rs.EMPTY_INK_UNDO, entry))?.entry)], [plain(entry), plain(entry)]);
  }
});

test("ink undo: empty stacks give null, and rename or refresh on empty keeps it empty", () => {
  const E = ts.EMPTY_INK_UNDO;
  assert.deepEqual([plain(rs.EMPTY_INK_UNDO), rs.INK_UNDO_LIMIT], [plain(E), ts.INK_UNDO_LIMIT]);
  assert.deepEqual([rs.takeInkUndo(E) ?? null, rs.takeInkRedo(E) ?? null], [null, null]);
  assert.deepEqual([ts.takeInkUndo(E), ts.takeInkRedo(E)], [null, null]);
  assert.deepEqual(plain(rs.renameInkUndoId(E, "a", "b")), plain(ts.renameInkUndoId(E, "a", "b")));
  assert.deepEqual(plain(rs.refreshInkUndoAnnotation(E, BASE)), plain(ts.refreshInkUndoAnnotation(E, BASE)));
});

test("ink undo: undo past the start stays null, and redo replays the run in order", () => {
  const both = freshBoth();
  for (const id of ["a", "b"]) {
    const entry: Entry = { kind: "update", id, before: { comment: "old" }, after: { comment: id } };
    both.ts = ts.pushInkUndo(both.ts, entry);
    both.rs = rs.pushInkUndo(both.rs, entry);
  }
  for (let i = 0; i < 3; i += 1) takeBoth(UNDO(), both, `undo ${i}`);
  assert.deepEqual([both.ts.undo.length, both.ts.redo.length], [0, 2]);
  for (let i = 0; i < 3; i += 1) takeBoth(REDO(), both, `redo ${i}`);
  assert.deepEqual(plain(both.rs), plain(both.ts));
});

test("ink undo: a new push after undo clears the redo stack", () => {
  const a: Entry = { kind: "create", annotation: { ...BASE, id: "a" } }, b: Entry = { kind: "create", annotation: { ...BASE, id: "b" } };
  const c: Entry = { kind: "remove", annotation: { ...BASE, id: "c" } };
  const tsBase = ts.takeInkUndo(ts.pushInkUndo(ts.pushInkUndo(ts.EMPTY_INK_UNDO, a), b))!.state;
  const rsBase = rs.takeInkUndo(rs.pushInkUndo(rs.pushInkUndo(rs.EMPTY_INK_UNDO, a), b))!.state;
  const tsNext = ts.pushInkUndo(tsBase, c);
  const rsNext = rs.pushInkUndo(rsBase, c);
  assert.deepEqual([tsBase.redo.length, tsNext.redo.length], [1, 0]);
  assert.deepEqual(plain(rsNext), plain(tsNext));
  assert.deepEqual([rs.takeInkRedo(rsNext) ?? null, ts.takeInkRedo(tsNext)], [null, null]);
});

test("ink undo: the stack keeps only the newest INK_UNDO_LIMIT steps", () => {
  const both = freshBoth();
  for (let i = 0; i < ts.INK_UNDO_LIMIT + 5; i += 1) {
    const entry: Entry = { kind: "create", annotation: { ...BASE, id: `n${i}` } };
    both.ts = ts.pushInkUndo(both.ts, entry);
    both.rs = rs.pushInkUndo(both.rs, entry);
  }
  assert.equal(both.ts.undo.length, ts.INK_UNDO_LIMIT);
  assert.deepEqual(plain(both.rs), plain(both.ts));
});

test("ink undo: rename and refresh reach every entry kind on both stacks", () => {
  const annotation = { ...BASE, id: "old" };
  const entries: Entry[] = [
    { kind: "create", annotation },
    { kind: "remove", annotation },
    { kind: "removeMany", annotations: [annotation, { ...BASE, id: "other" }] },
    { kind: "anchor", id: "old", before: {}, after: { contentHash: "h" } },
    { kind: "update", id: "old", before: { tags: [] }, after: { text: "t" } },
  ];
  const both = freshBoth();
  for (const entry of entries) {
    both.ts = ts.pushInkUndo(both.ts, entry);
    both.rs = rs.pushInkUndo(both.rs, entry);
  }
  both.ts = ts.takeInkUndo(both.ts)!.state;
  both.rs = rs.takeInkUndo(both.rs)!.state;
  const renamedTs = ts.renameInkUndoId(both.ts, "old", "new");
  const renamedRs = rs.renameInkUndoId(both.rs, "old", "new");
  assert.deepEqual(plain(renamedRs), plain(renamedTs));
  assert.deepEqual(plain(rs.renameInkUndoId(renamedRs, "new", "new")), plain(ts.renameInkUndoId(renamedTs, "new", "new")));
  const fresh = { ...annotation, comment: "joined" };
  assert.deepEqual(plain(rs.refreshInkUndoAnnotation(renamedRs, fresh)), plain(ts.refreshInkUndoAnnotation(renamedTs, fresh)));
});

import { before, test } from "node:test";
import assert from "node:assert/strict";
import * as ts from "@weaveforge/core";
import type { RustCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";

// Proves the Rust Zotero sync functions return exactly what the TS originals in
// packages/core/src/reader/zotero-write-back.ts return: sync mode guard, decisions, field diffs,
// conflict merges, write payloads and the write-back filter. Seeded, so a failure reproduces from the seed.

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

const SEEDS = Array.from({ length: 200 }, (_, i) => i + 1);

function pick<T>(rand: () => number, items: readonly T[]): T {
  return items[Math.floor(rand() * items.length)]!;
}

type Row = Parameters<typeof ts.decideAnnotationSync>[0];
type Local = Row["local"];
type Remote = NonNullable<Row["remote"]>;
type Mode = Parameters<typeof ts.decideAnnotationSync>[1];
type Choice = Parameters<typeof ts.resolveAnnotationConflict>[1];
type Position = NonNullable<Local["anchor"]["zoteroPosition"]>;
type SyncState = NonNullable<Local["syncState"]>;
type Field = (typeof FIELDS)[number];

// --- Fixtures: every value is a valid TS shape; no unknown keys, no null positions, no lone surrogates ---

const MODES = ["bidirectional", "read_only", "ignored"] as const;
const MODE_EDGES: readonly string[] = [
  "Bidirectional",
  "readonly",
  "read-only",
  "",
  "ignored ",
  "toString",
  "__proto__",
  "constructor",
];
const TYPES = ["highlight", "underline", "note", "image", "ink", "text"] as const;
const ORIGINS = ["zotero", "local"] as const;
const FIELDS = ["color", "text", "comment", "tags", "anchor", "type", "sortIndex"] as const;
const CHOICES: readonly Choice[] = ["keep_local", "accept_remote", "merge"];
const SYNC_STATES: readonly (SyncState | undefined)[] = ["local", "synced", "pending", "conflict", undefined];
const LOCAL_VERSIONS: readonly (number | null | undefined)[] = [undefined, null, 1, 2, 3];
const REMOTE_VERSIONS: readonly number[] = [1, 2, 3];
const DIFF_SETS: (readonly Field[])[] = [[], ["color"], ["anchor", "type"], ["tags", "sortIndex"]];
const MODES_WITH_INVALID: readonly (string | undefined)[] = [...MODES, "bogus", undefined];

const COLORS = ["#ffd400", "#ff6666", "#5fb236", ""];
const TEXTS = ["", "alpha", "Ünïcode 😀", "two\nlines", "  padded  "];
const KEYS = ["ZK1", "ZK2", "ABCD1234"];
const HASHES = ["abc", "def", "0000"];
const SORT_INDEXES = ["00001|000100|00000", "00002|000000|00000", ""];
const DATES = ["2024-01-01T00:00:00Z", "2025-06-30T12:00:00Z"];
const TAG_SETS: (readonly string[])[] = [[], ["a"], ["a", "b"], ["Ü"]];
const PARENT_KEYS = ["ABCD1234", "", "P/1"];

interface RowOpts {
  remote: boolean;
  diff: readonly Field[];
  localVersion: number | null | undefined;
  remoteVersion: number;
  syncState: SyncState | undefined;
}

function rectsFor(rand: () => number): number[][] {
  const count = 1 + Math.floor(rand() * 2);
  return Array.from({ length: count }, () => [0, 0, 0, 0].map(() => Math.round(rand() * 200) / 2));
}

/** Omits the position entirely when absent; a page index is optional within it. */
function positionFor(rand: () => number): Position | undefined {
  if (rand() < 0.15) return undefined;
  // TS requires pageIndex; Rust must still cope when Zotero omits it.
  const position = {} as Position;
  if (rand() < 0.8) position.pageIndex = Math.floor(rand() * 5);
  if (rand() < 0.7) position.rects = rectsFor(rand);
  if (rand() < 0.2) position.paths = [[1, 2, 3, 4, 5, 6]];
  if (rand() < 0.2) position.width = 2;
  if (rand() < 0.15) position.nextPageRects = [[0, 0, 1, 1]];
  return position;
}

function anchorFor(rand: () => number): Local["anchor"] {
  const anchor: Local["anchor"] = {};
  if (rand() < 0.8) anchor.contentHash = pick(rand, HASHES);
  const position = positionFor(rand);
  if (position) anchor.zoteroPosition = position;
  return anchor;
}

function buildLocal(
  rand: () => number,
  zoteroVersion: number | null | undefined,
  syncState: SyncState | undefined,
): Local {
  const local = {
    id: `ann-${Math.floor(rand() * 1000)}`,
    origin: pick(rand, ORIGINS),
    zoteroKey: rand() < 0.5 ? null : pick(rand, KEYS),
    type: pick(rand, TYPES),
    color: pick(rand, COLORS),
    text: pick(rand, TEXTS),
    comment: pick(rand, TEXTS),
    tags: [...pick(rand, TAG_SETS)],
    anchor: anchorFor(rand),
    sortIndex: pick(rand, SORT_INDEXES),
    createdAt: pick(rand, DATES),
    updatedAt: pick(rand, DATES),
  } as Local;
  if (syncState !== undefined) local.syncState = syncState;
  if (zoteroVersion !== undefined) local.zoteroVersion = zoteroVersion;
  return local;
}

function randomLocal(rand: () => number): Local {
  return buildLocal(rand, pick(rand, LOCAL_VERSIONS), pick(rand, SYNC_STATES));
}

/** Changes one field so it always differs from the local value. */
function mutate(remote: Remote, base: Local, field: Field): void {
  if (field === "color") remote.color = `${base.color}*`;
  else if (field === "text") remote.text = `${base.text}!`;
  else if (field === "comment") remote.comment = `${base.comment}?`;
  else if (field === "tags") remote.tags = [...base.tags, "remote"];
  else if (field === "anchor") remote.anchor = { contentHash: "moved" };
  else if (field === "type") remote.type = TYPES[(TYPES.indexOf(base.type) + 1) % TYPES.length]!;
  else remote.sortIndex = `${base.sortIndex}9`;
}

function remoteOf(rand: () => number, base: Local, version: number, diff: readonly Field[]): Remote {
  const remote: Remote = {
    key: pick(rand, KEYS),
    version,
    type: base.type,
    color: base.color,
    text: base.text,
    comment: base.comment,
    tags: [...base.tags],
    anchor: structuredClone(base.anchor),
    sortIndex: base.sortIndex,
    updatedAt: base.updatedAt,
  };
  for (const field of diff) mutate(remote, base, field);
  return remote;
}

function buildRow(rand: () => number, o: RowOpts): Row {
  const local = buildLocal(rand, o.localVersion, o.syncState);
  // A missing remote is either an omitted key or `null`; both mean "no Zotero copy".
  if (!o.remote) return rand() < 0.5 ? { local, remote: null } : ({ local } as Row);
  return { local, remote: remoteOf(rand, local, o.remoteVersion, o.diff) };
}

function randomOpts(rand: () => number): RowOpts {
  return {
    remote: rand() < 0.8,
    diff: rand() < 0.5 ? [] : [pick(rand, FIELDS), ...(rand() < 0.3 ? [pick(rand, FIELDS)] : [])],
    localVersion: pick(rand, LOCAL_VERSIONS),
    remoteVersion: pick(rand, REMOTE_VERSIONS),
    syncState: pick(rand, SYNC_STATES),
  };
}

// --- Sync mode guard: isZoteroLibrarySyncMode ---

test("isZoteroLibrarySyncMode: Rust and TS agree on valid, invalid and undefined modes", () => {
  const values = [...MODES, ...MODE_EDGES, undefined] as (string | undefined)[];
  for (const value of values) {
    // undefined is outside the type but reaches the wrapper at runtime, so it is cast.
    assert.equal(
      rs.isZoteroLibrarySyncMode(value as string),
      ts.isZoteroLibrarySyncMode(value as string),
      `mode ${String(value)}`,
    );
  }
  for (const seed of SEEDS) {
    const rand = random(seed);
    const value = pick(rand, values) as string;
    assert.equal(
      rs.isZoteroLibrarySyncMode(value),
      ts.isZoteroLibrarySyncMode(value),
      `seed ${seed} mode ${String(value)}`,
    );
  }
});

// --- Decisions: decideAnnotationSync ---

test("decideAnnotationSync: Rust and TS agree on every mode, branch matrix and seeded rows", () => {
  // Every mode/remote/diff/version/state combination, so each decision branch is hit.
  let matrixSeed = 0;
  for (const mode of MODES_WITH_INVALID) {
    for (const remote of [true, false]) {
      for (const diff of DIFF_SETS) {
        for (const localVersion of LOCAL_VERSIONS) {
          for (const remoteVersion of REMOTE_VERSIONS) {
            for (const syncState of SYNC_STATES) {
              matrixSeed += 1;
              const row = buildRow(random(matrixSeed), { remote, diff, localVersion, remoteVersion, syncState });
              assert.deepEqual(
                rs.decideAnnotationSync(row, mode as Mode),
                ts.decideAnnotationSync(row, mode as Mode),
                `matrix ${String(mode)} remote ${remote} diff ${diff.join("|")} local ${String(localVersion)} remote ${remoteVersion} state ${String(syncState)}`,
              );
            }
          }
        }
      }
    }
  }
  for (const seed of SEEDS) {
    const rand = random(seed);
    const mode = pick(rand, MODES_WITH_INVALID) as Mode;
    const row = buildRow(rand, randomOpts(rand));
    assert.deepEqual(rs.decideAnnotationSync(row, mode), ts.decideAnnotationSync(row, mode), `seed ${seed} mode ${String(mode)}`);
  }
});

// --- Field diffs: diffAnnotationFields ---

test("diffAnnotationFields: Rust and TS agree on each field alone and on seeded rows", () => {
  for (const field of FIELDS) {
    const row = buildRow(random(FIELDS.indexOf(field) + 1), {
      remote: true,
      diff: [field],
      localVersion: 1,
      remoteVersion: 1,
      syncState: "synced",
    });
    assert.deepEqual(rs.diffAnnotationFields(row), ts.diffAnnotationFields(row), `field ${field}`);
  }
  for (const seed of SEEDS) {
    const rand = random(seed);
    const row = buildRow(rand, randomOpts(rand));
    assert.deepEqual(rs.diffAnnotationFields(row), ts.diffAnnotationFields(row), `seed ${seed}`);
  }
});

// --- Conflict merge: resolveAnnotationConflict ---

test("resolveAnnotationConflict: Rust and TS agree on every choice and seeded row", () => {
  for (const seed of SEEDS) {
    const rand = random(seed);
    const row = buildRow(rand, randomOpts(rand));
    for (const choice of CHOICES) {
      assert.deepEqual(
        rs.resolveAnnotationConflict(row, choice),
        ts.resolveAnnotationConflict(row, choice),
        `seed ${seed} choice ${choice}`,
      );
    }
  }
});

// --- Payloads: toZoteroWritePayload ---

test("toZoteroWritePayload: Rust and TS agree on every type, position and tag set", () => {
  for (const seed of SEEDS) {
    const rand = random(seed);
    const local = randomLocal(rand);
    const parent = pick(rand, PARENT_KEYS);
    assert.deepEqual(
      rs.toZoteroWritePayload(local, parent),
      ts.toZoteroWritePayload(local, parent),
      `seed ${seed} type ${local.type} parent ${parent}`,
    );
  }
});

// --- Write-back filter: zoteroWriteBackAnnotations ---

test("zoteroWriteBackAnnotations: Rust and TS agree on seeded batches and keep input references", () => {
  for (const seed of SEEDS) {
    const rand = random(seed);
    const count = Math.floor(rand() * 7);
    const input = Array.from({ length: count }, () => randomLocal(rand));
    const got = rs.zoteroWriteBackAnnotations(input as Parameters<RustCore["zoteroWriteBackAnnotations"]>[0]);
    assert.deepEqual(got, ts.zoteroWriteBackAnnotations(input as Parameters<typeof ts.zoteroWriteBackAnnotations>[0]), `seed ${seed} count ${count}`);
    for (const item of got) {
      assert.ok((input as unknown[]).includes(item), `seed ${seed}: returned item is not an input element`);
    }
  }
});

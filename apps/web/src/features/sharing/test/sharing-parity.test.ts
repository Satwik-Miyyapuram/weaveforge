import { before, test } from "node:test";
import assert from "node:assert/strict";
import * as ts from "@weaveforge/core";
import type { RustCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";

// Proves the Rust sharing grant rules return exactly what the TS originals in
// packages/core/src/features/sharing/domain/share.ts return, throws included.

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

/** A grant with an absent anchor reads as `null`, the TS default. */
function grant<T extends { resourceId?: string | null }>(share: T): T & { resourceId: string | null } {
  return { ...share, resourceId: share.resourceId ?? null };
}

type Input = Parameters<typeof ts.normalizeShareInput>[0];
type Grant = Parameters<typeof ts.shareAllowsComment>[0];
type Outcome = { ok: true; value: unknown } | { ok: false; message: string };

/** Runs one side and records its value, or its thrown message. */
function outcome(run: () => unknown): Outcome {
  try {
    return { ok: true, value: plain(run()) };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

/** Throw-ness must match; values match when both return; messages match when both throw. */
function expectSame(label: string, tsOut: Outcome, rsOut: Outcome, compareMessage = true): void {
  assert.equal(rsOut.ok, tsOut.ok, `${label}: throw parity`);
  if (tsOut.ok && rsOut.ok) assert.deepEqual(rsOut.value, tsOut.value, label);
  if (!tsOut.ok && !rsOut.ok && compareMessage) assert.equal(rsOut.message, tsOut.message, label);
}

const RECIPIENTS = ["", "u1", " ", "member-ö"];
const ANCHORS: (string | null)[] = [null, "r1", "", "r2"];
const ACCESS: ts.ShareAccess[] = ["view", "comment", "edit"];
const OWNERS = ["o1", "o2"];

test("SHAREABLE_TYPES and CRDT_EDITABLE_SHARE_TYPES match TS", () => {
  assert.deepEqual(plain(rs.SHAREABLE_TYPES), plain(ts.SHAREABLE_TYPES));
  assert.deepEqual(plain(rs.CRDT_EDITABLE_SHARE_TYPES), plain(ts.CRDT_EDITABLE_SHARE_TYPES));
});

test("normalizeShareInput matches TS over seeded grants", () => {
  for (let seed = 1; seed <= 400; seed += 1) {
    const rand = random(seed);
    // Absent `access` is a distinct input from an explicit one; both must default to comment.
    const input = {
      recipientId: pick(rand, RECIPIENTS),
      resourceType: pick(rand, ts.SHAREABLE_TYPES),
      resourceId: pick(rand, ANCHORS),
      ...(rand() < 0.5 ? {} : { access: pick(rand, ACCESS) }),
    } as Input;
    expectSame(
      `seed ${seed}`,
      outcome(() => grant(ts.normalizeShareInput(input))),
      outcome(() => grant(rs.normalizeShareInput(input))),
    );
  }
});

test("normalizeShareInput grid: every type, anchor, access and recipient", () => {
  for (const resourceType of ts.SHAREABLE_TYPES) {
    for (const resourceId of ANCHORS) {
      for (const access of [undefined, ...ACCESS]) {
        for (const recipientId of ["u1", ""]) {
          const input = {
            recipientId,
            resourceType,
            resourceId,
            ...(access === undefined ? {} : { access }),
          } as Input;
          expectSame(
            `${resourceType}/${resourceId}/${access}/${recipientId}`,
            outcome(() => grant(ts.normalizeShareInput(input))),
            outcome(() => grant(rs.normalizeShareInput(input))),
          );
        }
      }
    }
  }
});

test("normalizeShareInput: absent anchor and absent access default like TS", () => {
  const cases = [
    { recipientId: "u1", resourceType: "paper" },
    { recipientId: "u1", resourceType: "vault_page", access: undefined },
    { recipientId: "u1", resourceType: "vault_page", access: "edit" },
    { recipientId: "u1", resourceType: "report_section", access: "edit" },
    { recipientId: "u1", resourceType: "paper", access: "edit" },
  ] as unknown as Input[];
  for (const input of cases) {
    expectSame(
      JSON.stringify(input),
      outcome(() => grant(ts.normalizeShareInput(input))),
      outcome(() => grant(rs.normalizeShareInput(input))),
    );
  }
});

test("normalizeShareInput: unknown resourceType throws on both sides", () => {
  for (const resourceType of ["folder", "", "Paper", "vault-page"]) {
    const input = { recipientId: "u1", resourceType, resourceId: null } as unknown as Input;
    const tsOut = outcome(() => ts.normalizeShareInput(input));
    // Rust's message comes from serde, not the TS wording, so only throw-ness is compared.
    assert.equal(tsOut.ok, false, resourceType);
    expectSame(resourceType, tsOut, outcome(() => rs.normalizeShareInput(input)), false);
  }
});

test("share coverage predicates match TS over seeded grants", () => {
  for (let seed = 1; seed <= 400; seed += 1) {
    const rand = random(seed);
    const share: Grant = {
      resourceType: pick(rand, ts.SHAREABLE_TYPES),
      resourceId: pick(rand, ANCHORS),
      ownerId: pick(rand, OWNERS),
      access: pick(rand, ACCESS),
    };
    const resourceType = pick(rand, ts.SHAREABLE_TYPES);
    const resourceId = pick(rand, ["r1", "r2", ""]);
    const ownerId = pick(rand, OWNERS);
    assert.equal(
      rs.shareCoversResource(share, resourceType, resourceId, ownerId),
      ts.shareCoversResource(share, resourceType, resourceId, ownerId),
      `covers seed ${seed}`,
    );
    assert.equal(
      rs.shareAllowsComment(share, resourceType, resourceId, ownerId),
      ts.shareAllowsComment(share, resourceType, resourceId, ownerId),
      `comment seed ${seed}`,
    );
    assert.equal(
      rs.shareAllowsEdit(share, resourceType, resourceId, ownerId),
      ts.shareAllowsEdit(share, resourceType, resourceId, ownerId),
      `edit seed ${seed}`,
    );
  }
});

test("shareSupportsEditAccess and isBlanketShare match TS on every type and anchor", () => {
  for (const resourceType of ts.SHAREABLE_TYPES) {
    for (const anchor of ANCHORS) {
      assert.equal(
        rs.shareSupportsEditAccess(resourceType, anchor),
        ts.shareSupportsEditAccess(resourceType, anchor),
        `${resourceType}/${anchor}`,
      );
    }
  }
  for (const anchor of ANCHORS) {
    assert.equal(rs.isBlanketShare(anchor), ts.isBlanketShare(anchor), `blanket ${anchor}`);
  }
});

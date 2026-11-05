import { before, test } from "node:test";
import assert from "node:assert/strict";
import * as ts from "@weaveforge/core";
import type { RustCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";

// Proves the Rust experiment status and metric display helpers return exactly
// what the TS originals in packages/core/src/features/experiments/domain return.

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

const STATUSES = ["planned", "running", "done", "failed", "abandoned"] as const;

// Zoned or date-only timestamps only: a zone-less date-time is local time in JS.
const STAMPS = [
  "2026-11-05T10:00:00.000Z", "2026-11-05T10:00:00Z", "2026-11-05T09:58:30.5Z",
  "2026-11-05T11:00:00+01:00", "2026-11-05T04:30:00.123456-05:30", "2026-11-05T10:00Z",
  "2026-11-05", "2024-02-29T23:59:59.999Z", "1970-01-01T00:00:00Z",
  "", "yesterday", "2026-13-01T00:00:00Z", "2026-11-05T25:00:00Z",
];

const NOW_MS = Date.parse("2026-11-05T10:00:00.000Z");

function experiment(rand: () => number): ts.Experiment {
  const exp: ts.Experiment = {
    id: "e1",
    name: "run",
    status: pick(rand, STATUSES),
    config: {},
    metrics: {},
    artifacts: [],
    createdAt: pick(rand, STAMPS),
  };
  if (rand() < 0.6) exp.startedAt = pick(rand, STAMPS);
  return exp;
}

test("status patch, activity time and staleness match TS on seeded runs", () => {
  for (let seed = 1; seed <= 500; seed += 1) {
    const rand = random(seed);
    const exp = experiment(rand);
    const status = pick(rand, STATUSES);
    const now = pick(rand, STAMPS);
    const where = `seed ${seed}: ${JSON.stringify(exp)}`;
    assert.deepEqual(
      plain(rs.statusPatchForExperiment(exp, status, now)),
      plain(ts.statusPatchForExperiment(exp, status, now)),
      where,
    );
    assert.equal(rs.experimentActivityAt(exp), ts.experimentActivityAt(exp), where);
    const nowMs = NOW_MS + Math.floor((rand() - 0.5) * 600_000);
    const staleMs = rand() < 0.5 ? ts.STALE_RUNNING_MS : Math.floor(rand() * 300_000);
    const metricAt = rand() < 0.5 ? undefined : NOW_MS - Math.floor(rand() * 400_000);
    assert.equal(
      rs.isStaleRunningExperiment(exp, nowMs, staleMs, metricAt),
      ts.isStaleRunningExperiment(exp, nowMs, staleMs, metricAt),
      where,
    );
  }
  assert.deepEqual([...rs.TERMINAL_EXPERIMENT_STATUSES], [...ts.TERMINAL_EXPERIMENT_STATUSES]);
  assert.equal(rs.STALE_RUNNING_MS, ts.STALE_RUNNING_MS);
});

test("shortSha matches TS", () => {
  for (const sha of [undefined, "", "   ", "abc", "  0123456789abcdef  ", "\tdeadbeefcafe\n", "ÄÖÜäöüß12"]) {
    assert.equal(rs.shortSha(sha), ts.shortSha(sha), JSON.stringify(sha));
  }
});

test("formatMetricValue matches TS across magnitudes", () => {
  const fixed = [0, -0, NaN, Infinity, -Infinity, 1e6, 999_999.95, 100, 99.9995, 1, 0.99995, 0.01, 0.0099995, 1e-4, 9.9999e-5, 5e-324, 1.7976931348623157e308, 0.125, 2.5, 1.005];
  for (const v of fixed) {
    assert.equal(rs.formatMetricValue("m", v), ts.formatMetricValue("m", v), String(v));
    assert.equal(rs.formatMetricValue("m", -v), ts.formatMetricValue("m", -v), String(-v));
  }
  for (let seed = 1; seed <= 2000; seed += 1) {
    const rand = random(seed);
    const v = (rand() < 0.5 ? -1 : 1) * rand() * 10 ** Math.floor(rand() * 20 - 10);
    assert.equal(rs.formatMetricValue("m", v), ts.formatMetricValue("m", v), `seed ${seed}: ${v}`);
  }
});

test("formatMetricCell matches TS on every value kind", () => {
  const cyclic: Record<string, unknown> = { a: 1 };
  cyclic.self = cyclic;
  const values: unknown[] = [
    null, undefined, "", "   ", "0.5", " 42 ", "0x1f", "1e3", "Infinity", "-Infinity", "NaN", "abc", "12px",
    0, -1.5, NaN, Infinity, 123456789, true, false, 10n, -3n,
    {}, { b: 2, a: 1 }, { nested: { x: [1, "y", null] } }, { u: undefined, f: () => 1 },
    [], [1, 2, 3], [undefined, () => 1], ["a", { b: true }],
    new Date(Date.UTC(2026, 10, 5)), { toJSON: () => 7 }, { toJSON: () => "s" }, { toJSON: () => undefined },
    { toJSON: () => { throw new Error("no"); } }, cyclic, () => 1, Symbol("s"),
  ];
  for (const v of values) {
    const label = typeof v === "bigint" ? `${v}n` : typeof v === "symbol" ? "symbol" : String(v);
    assert.equal(rs.formatMetricCell("m", v), ts.formatMetricCell("m", v), label);
  }
});

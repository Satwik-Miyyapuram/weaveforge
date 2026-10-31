// Writes tests/goldens/sync-merge.json from the TypeScript three-way merge.
// Run from the repo root on Node 24 with TZ=UTC (offsetless timestamps are local time in JS):
//   TZ=UTC node crates/wf-core/tests/goldens/sync-merge.mjs
import { writeFileSync } from "node:fs";
import { mergeRows, sameValue } from "../../../../packages/core/src/shared/three-way-merge.ts";

const instants = [
  "2026-01-01T10:00:00Z", "2026-01-01T10:00:00.000Z", "2026-01-01 10:00:00+00", "2026-01-01 10:00:00+00:00",
  "2026-01-01T12:00:00+02:00", "2026-01-01T12:00+02", "2026-01-01T12:00:00+02","2026-01-01T10:00:00.123456Z", "2026-01-01T10:00:00.123Z", "2026-01-01T10:00:00.1239Z",
  "2026-01-01T10:00", "2026-01-01 10:00", "2026-01-01T10:00:00", "2026-01-01T10:00:00-05:30", "2026-01-01T04:30:00Z",
  "2026-01-01T10:00:00+0200", "2026-01-01 08:00:00.5+00", "2026-01-01T08:00:00.500Z", "2026-02-30T10:00:00Z",
  "2026-13-01T10:00:00Z", "2026-01-01T25:00:00Z", "2026-01-01T10:60:00Z", "2026-01-01T24:00:00Z", "2026-01-02T00:00:00Z",
  "2026-01-01T10:00:00ZZ", "2026-01-01T10:00:00 extra", "2026-01-01X10:00", "2026-01-01", "10:00", "", "abc",
  "+002026-01-01T10:00:00Z", "1970-01-01T00:00:00Z", "1969-12-31T23:59:59.999Z", "9999-12-31T23:59:59Z",
  "2024-02-29T10:00:00Z", "2023-02-29T10:00:00Z", "2026-01-01T10:00:00.Z", "2026-01-01T10:00:00,5Z",
  "2026-01-01T10:00:00+24:00", "2026-01-01T10:00:00+23:59", "2026-01-01t10:00:00z", "2026-01-01T1:00:00Z",
];
const values = [null, true, false, 0, 1, -1, 1.5, "a", "", "1", [], [1, 2], [2, 1], {}, { a: 1, b: 2 }, { b: 2, a: 1 },
  { a: { y: 1, x: 2 } }, { a: { x: 2, y: 1 } }, [{ b: 1, a: 2 }], [{ a: 2, b: 1 }], { a: null }, { a: [1, { d: 1, c: 2 }] }];

const same = [];
for (const a of instants) for (const b of instants) same.push([a, b, sameValue(a, b)]);
for (const a of values) for (const b of values) same.push([a, b, sameValue(a, b)]);
same.push([null, undefined, sameValue(null, undefined)]);

const rows = [
  [{}, {}, {}],
  [{ t: "a" }, { t: "b" }, { t: "a" }],
  [{ t: "a" }, { t: "a" }, { t: "b" }],
  [{ t: "a" }, { t: "b" }, { t: "b" }],
  [{ t: "a" }, { t: "b" }, { t: "c" }],
  [{ t: "a", r: false }, { t: "b", r: false }, { t: "a", r: true }],
  [{}, { t: "new" }, {}],
  [{}, {}, { t: "new" }],
  [{}, { t: "x" }, { t: "y" }],
  [{ t: "a" }, {}, { t: "a" }],
  [{ t: "a" }, { t: "a" }, {}],
  [{ t: "a" }, {}, { t: "b" }],
  [{ t: "a" }, { t: null }, { t: "b" }],
  [{ id: 1, server_seq: 1, row_version: 1, created_at: "x" }, { id: 2, server_seq: 2, row_version: 2, created_at: "y" }, { id: 3, server_seq: 3, row_version: 3, created_at: "z" }],
  [{ updated_at: "2026-01-01T10:00:00Z" }, { updated_at: "2026-01-02T10:00:00Z" }, { updated_at: "2026-01-03T10:00:00Z" }],
  [{ updated_at: "2026-01-01T10:00:00Z" }, { updated_at: "2026-01-04T10:00:00Z" }, { updated_at: "2026-01-03T10:00:00Z" }],
  [{ updated_at: "2026-01-01T10:00:00Z" }, { updated_at: "2026-01-04 10:00:00+00" }, { updated_at: "2026-01-04T10:00:00Z" }],
  [{ updated_at: "x" }, { updated_at: "y" }, { updated_at: "z" }],
  [{ updated_at: "x" }, { updated_at: "2026-01-04T10:00:00Z" }, { updated_at: "z" }],
  [{ updated_at: "2026-01-01T10:00:00Z" }, { updated_at: "2026-01-04T10:00:00Z" }, { updated_at: "2026-01-04T10:00:00.000Z" }],
  [{ at: "2026-01-01T10:00:00Z" }, { at: "2026-01-01 10:00:00+00" }, { at: "2026-01-02T10:00:00Z" }],
  [{ j: { a: 1, b: 2 } }, { j: { b: 2, a: 1 } }, { j: { a: 1, b: 3 } }],
  [{ j: { a: 1 } }, { j: { a: 2 } }, { j: { a: 3 } }],
  [{ n: 1 }, { n: 1.0 }, { n: 2 }],
  [{ n: 1 }, { n: "1" }, { n: 1 }],
  [{ a: 1, b: 1, c: 1 }, { a: 2, b: 1, c: 5 }, { a: 1, b: 3, c: 6, d: 9 }],
  [{ s: "2026-01-01T10:00:00Z" }, { s: "2026-01-01T10:00:00Z" }, { s: "2026-01-01T12:00:00+02:00" }],
];
const merge = rows.map(([base, local, remote]) => ({ base, local, remote, out: mergeRows(base, local, remote) }));
writeFileSync(new URL("./sync-merge.json", import.meta.url), `${JSON.stringify({ same, merge }, null, 1)}\n`);

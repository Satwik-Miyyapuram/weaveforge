import assert from "node:assert/strict";
import test from "node:test";
import { applyDelta, planDelta, readWithDelta, type EntityStamp } from "../src/index.js";

interface Row {
  id: string;
  updatedAt: string;
  body: string;
}

const row = (id: string, updatedAt: string, body = `body of ${id}`): Row => ({ id, updatedAt, body });
const stamp = (id: string, updatedAt: string): EntityStamp => ({ id, updatedAt });

/** A reader that counts what it was asked for, so cost is assertable. */
function reader(rows: Row[]) {
  const calls = { list: 0, stamps: 0, byIds: [] as string[][] };
  return {
    calls,
    async list() {
      calls.list += 1;
      return rows.map((r) => ({ ...r }));
    },
    async listStamps() {
      calls.stamps += 1;
      return rows.map((r) => stamp(r.id, r.updatedAt));
    },
    async listByIds(ids: readonly string[]) {
      calls.byIds.push([...ids]);
      return rows.filter((r) => ids.includes(r.id)).map((r) => ({ ...r }));
    },
    set(next: Row[]) {
      rows = next;
    },
  };
}

const stampOf = (r: Row) => r.updatedAt;

// ------------------------------------------------------------------- planning

test("an unchanged corpus needs nothing fetched", () => {
  const plan = planDelta(
    [stamp("a", "t1"), stamp("b", "t1")],
    new Map([["a", "t1"], ["b", "t1"]]),
  );
  assert.equal(plan.unchanged, true);
  assert.deepEqual(plan.fetch, []);
  assert.deepEqual(plan.drop, []);
});

test("a changed row is fetched, an untouched one is not", () => {
  const plan = planDelta(
    [stamp("a", "t2"), stamp("b", "t1")],
    new Map([["a", "t1"], ["b", "t1"]]),
  );
  assert.deepEqual(plan.fetch, ["a"]);
  assert.equal(plan.unchanged, false);
});

test("a new row is fetched", () => {
  const plan = planDelta([stamp("a", "t1"), stamp("new", "t1")], new Map([["a", "t1"]]));
  assert.deepEqual(plan.fetch, ["new"]);
});

test("a deleted row is dropped — the reason this compares ids rather than a timestamp", () => {
  const plan = planDelta([stamp("a", "t1")], new Map([["a", "t1"], ["gone", "t1"]]));
  assert.deepEqual(plan.drop, ["gone"]);
  assert.deepEqual(plan.fetch, [], "nothing needs re-reading, but something must go");
});

test("an empty database drops everything held", () => {
  const plan = planDelta([], new Map([["a", "t1"], ["b", "t1"]]));
  assert.deepEqual(plan.drop.sort(), ["a", "b"]);
});

// -------------------------------------------------------------------- merging

test("merging keeps the order the database reported", () => {
  const held = [row("a", "t1"), row("b", "t1"), row("c", "t1")];
  const merged = applyDelta(held, [row("b", "t2")], [stamp("c", "t1"), stamp("b", "t2"), stamp("a", "t1")]);
  assert.deepEqual(merged.map((r) => r.id), ["c", "b", "a"]);
});

test("a fetched row replaces the held one", () => {
  const merged = applyDelta([row("a", "t1", "old")], [row("a", "t2", "new")], [stamp("a", "t2")]);
  assert.equal(merged[0]!.body, "new");
});

test("a row absent from the order is not carried over", () => {
  const merged = applyDelta([row("a", "t1"), row("gone", "t1")], [], [stamp("a", "t1")]);
  assert.deepEqual(merged.map((r) => r.id), ["a"]);
});

// ------------------------------------------------------------------ reading

test("the first read is a full one; there is nothing to diff against", async () => {
  const source = reader([row("a", "t1"), row("b", "t1")]);
  const rows = await readWithDelta(source, undefined, stampOf);

  assert.equal(source.calls.list, 1);
  assert.equal(source.calls.stamps, 0, "no point describing a corpus about to be read whole");
  assert.equal(rows.length, 2);
});

test("a second read with nothing changed fetches no bodies at all", async () => {
  const source = reader([row("a", "t1"), row("b", "t1")]);
  const first = await readWithDelta(source, undefined, stampOf);
  const second = await readWithDelta(source, first, stampOf);

  assert.equal(source.calls.list, 1, "the full read happened once");
  assert.equal(source.calls.stamps, 1);
  assert.deepEqual(source.calls.byIds, [], "no row was re-downloaded");
  assert.deepEqual(second.map((r) => r.id), ["a", "b"]);
});

test("editing one note re-downloads one note", async () => {
  const source = reader([row("a", "t1"), row("b", "t1"), row("c", "t1")]);
  const first = await readWithDelta(source, undefined, stampOf);

  source.set([row("a", "t1"), row("b", "t2", "edited"), row("c", "t1")]);
  const second = await readWithDelta(source, first, stampOf);

  assert.deepEqual(source.calls.byIds, [["b"]], "only the edited row travelled");
  assert.equal(second.find((r) => r.id === "b")!.body, "edited");
  assert.equal(second.find((r) => r.id === "a")!.body, "body of a", "the rest is reused");
});

test("a deleted note leaves the snapshot", async () => {
  const source = reader([row("a", "t1"), row("b", "t1")]);
  const first = await readWithDelta(source, undefined, stampOf);

  source.set([row("a", "t1")]);
  const second = await readWithDelta(source, first, stampOf);

  assert.deepEqual(second.map((r) => r.id), ["a"]);
  assert.deepEqual(source.calls.byIds, [], "a deletion costs no body fetch");
});

test("a wholesale change reads everything rather than fetching it row by row", async () => {
  const source = reader(Array.from({ length: 10 }, (_, i) => row(`r${i}`, "t1")));
  const first = await readWithDelta(source, undefined, stampOf);

  source.set(Array.from({ length: 10 }, (_, i) => row(`r${i}`, "t2")));
  await readWithDelta(source, first, stampOf);

  assert.equal(source.calls.list, 2, "past a threshold one read beats many");
  assert.deepEqual(source.calls.byIds, []);
});

test("a reader that cannot describe itself simply reads in full", async () => {
  let listed = 0;
  const plain = {
    async list() {
      listed += 1;
      return [row("a", "t1")];
    },
  };

  const first = await readWithDelta(plain, undefined, stampOf);
  await readWithDelta(plain, first, stampOf);
  assert.equal(listed, 2, "no delta support means no behaviour change");
});

test("a row edited elsewhere is caught by its stamp, not by who wrote it", async () => {
  const source = reader([row("a", "t1")]);
  const first = await readWithDelta(source, undefined, stampOf);

  // Another device writes; this client made no local change.
  source.set([row("a", "t9", "written elsewhere")]);
  const second = await readWithDelta(source, first, stampOf);

  assert.equal(second[0]!.body, "written elsewhere");
});

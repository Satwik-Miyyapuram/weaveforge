import assert from "node:assert/strict";
import { test } from "node:test";
import type { ImportDiff, JsonDiffEntry } from "@weaveforge/core";

import {
  applyOutsideEdits,
  splitOutsideEdits,
  type FolderDiff,
} from "../application/outside-edits";

type NoteEntry = ImportDiff["entries"][number];

function note(action: string, path: string): NoteEntry {
  return { action, entity: { path } } as unknown as NoteEntry;
}

function json(action: string, path: string): JsonDiffEntry {
  return { action, kind: "tags", path, existing: { id: "t" } } as unknown as JsonDiffEntry;
}

function diffOf(entries: NoteEntry[], jsonEntries?: JsonDiffEntry[]): FolderDiff {
  const base = { entries, counts: {} } as unknown as FolderDiff;
  return jsonEntries
    ? { ...base, json: { entries: jsonEntries, counts: {} } as unknown as FolderDiff["json"] }
    : base;
}

function paths(entries: { entity?: { path: string }; path?: string }[] | undefined): string[] {
  return (entries ?? []).map((entry) => entry.entity?.path ?? entry.path ?? "");
}

test("a new note with no base is applied", () => {
  const { apply, held } = splitOutsideEdits(diffOf([note("created", "a.md")]), {});
  assert.deepEqual(paths(apply.entries as never), ["a.md"]);
  assert.equal(held.entries.length, 0);
});

test("a note the app once wrote and the folder re-created is held", () => {
  const { apply, held } = splitOutsideEdits(diffOf([note("created", "a.md")]), {
    "a.md": "digest",
  });
  assert.equal(apply.entries.length, 0);
  assert.deepEqual(paths(held.entries as never), ["a.md"]);
});

test("an updated note with a base is applied; without a base it is held", () => {
  const withBase = splitOutsideEdits(diffOf([note("updated", "a.md")]), { "a.md": "d" });
  assert.deepEqual(paths(withBase.apply.entries as never), ["a.md"]);
  assert.equal(withBase.held.entries.length, 0);

  const noBase = splitOutsideEdits(diffOf([note("updated", "b.md")]), {});
  assert.equal(noBase.apply.entries.length, 0);
  assert.deepEqual(paths(noBase.held.entries as never), ["b.md"]);
});

test("conflict and removed are held; unchanged is in neither", () => {
  const { apply, held } = splitOutsideEdits(
    diffOf([
      note("conflict", "c.md"),
      note("removed", "r.md"),
      note("unchanged", "u.md"),
    ]),
    { "c.md": "d", "r.md": "d", "u.md": "d" },
  );
  assert.equal(apply.entries.length, 0);
  assert.deepEqual(paths(held.entries as never), ["c.md", "r.md"]);
});

test("counts have all five keys and match the filtered entries", () => {
  const { apply, held } = splitOutsideEdits(
    diffOf([
      note("created", "new.md"),
      note("updated", "up.md"),
      note("updated", "nobase.md"),
      note("conflict", "c.md"),
      note("removed", "r.md"),
      note("unchanged", "u.md"),
    ]),
    { "up.md": "d" },
  );
  const keys = ["created", "updated", "unchanged", "conflict", "removed"];
  assert.deepEqual(Object.keys(apply.counts).sort(), [...keys].sort());
  assert.deepEqual(Object.keys(held.counts).sort(), [...keys].sort());
  assert.deepEqual(
    { ...apply.counts },
    { created: 1, updated: 1, unchanged: 0, conflict: 0, removed: 0 },
  );
  assert.deepEqual(
    { ...held.counts },
    { created: 0, updated: 1, unchanged: 0, conflict: 1, removed: 1 },
  );
});

test("JSON entries follow the same rules", () => {
  const { apply, held } = splitOutsideEdits(
    diffOf([], [json("updated", "data/tags.json"), json("removed", "data/gone.json")]),
    { "data/tags.json": "d" },
  );
  assert.deepEqual(paths(apply.json?.entries as never), ["data/tags.json"]);
  assert.deepEqual(paths(held.json?.entries as never), ["data/gone.json"]);
  assert.equal(apply.json?.counts.updated, 1);
  assert.equal(held.json?.counts.removed, 1);
});

test("a diff without json produces outputs without a json key", () => {
  const out = splitOutsideEdits(diffOf([note("created", "a.md")]), {});
  assert.equal("json" in out.apply, false);
  assert.equal("json" in out.held, false);
});

test("the input diff is not mutated", () => {
  const input = diffOf(
    [note("created", "a.md"), note("conflict", "c.md")],
    [json("updated", "data/tags.json")],
  );
  const before = structuredClone(input);
  splitOutsideEdits(input, { "data/tags.json": "d" });
  assert.deepEqual(input, before);
});

test("applyOutsideEdits applies only the safe part and settles the rest", async () => {
  const diff = diffOf(
    [note("created", "new.md"), note("conflict", "c.md")],
    [json("updated", "data/tags.json"), json("removed", "data/gone.json")],
  );
  const calls: { apply?: FolderDiff; settle?: FolderDiff } = {};
  const result = await applyOutsideEdits({
    preview: async () => diff,
    base: async () => ({ "data/tags.json": "d" }),
    apply: async (d) => {
      calls.apply = d;
    },
    settle: (h) => {
      calls.settle = h;
    },
  });
  assert.deepEqual(paths(calls.apply?.entries as never), ["new.md"]);
  assert.deepEqual(paths(calls.apply?.json?.entries as never), ["data/tags.json"]);
  assert.deepEqual(paths(calls.settle?.entries as never), ["c.md"]);
  assert.deepEqual(paths(calls.settle?.json?.entries as never), ["data/gone.json"]);
  assert.deepEqual(result, { applied: 2, held: 2 });
});

test("nothing safe: apply is not called, settle still is, applied 0", async () => {
  let applyCalls = 0;
  let settled: FolderDiff | undefined;
  const result = await applyOutsideEdits({
    preview: async () => diffOf([note("conflict", "c.md")]),
    base: async () => ({}),
    apply: async () => {
      applyCalls += 1;
    },
    settle: (h) => {
      settled = h;
    },
  });
  assert.equal(applyCalls, 0);
  assert.notEqual(settled, undefined);
  assert.deepEqual(result, { applied: 0, held: 1 });
});

test("preview or apply throwing rejects and skips settle", async () => {
  let settleCalls = 0;
  const settle = () => {
    settleCalls += 1;
  };
  await assert.rejects(
    applyOutsideEdits({
      preview: async () => {
        throw new Error("preview failed");
      },
      base: async () => ({}),
      apply: async () => undefined,
      settle,
    }),
    /preview failed/,
  );
  await assert.rejects(
    applyOutsideEdits({
      preview: async () => diffOf([note("created", "a.md")]),
      base: async () => ({}),
      apply: async () => {
        throw new Error("apply failed");
      },
      settle,
    }),
    /apply failed/,
  );
  assert.equal(settleCalls, 0);
});

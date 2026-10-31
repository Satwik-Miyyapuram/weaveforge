import assert from "node:assert/strict";
import { test } from "node:test";
import type { ChangeSide, ImportAction, ImportDiffEntry, JsonDiffEntry } from "@weaveforge/core";

import {
  applyOutsideEdits,
  splitOutsideEdits,
  type FolderDiff,
  type SeenFile,
} from "../application/outside-edits";

function note(action: ImportAction, path: string, id?: string): ImportDiffEntry {
  return {
    action,
    entity: { id, type: "vault_page", title: path, body: "", path, fields: {} },
  } as unknown as ImportDiffEntry;
}

function row(action: ImportAction, path: string, id: string): JsonDiffEntry {
  return { action, kind: "tags", path, existing: { id }, row: { id } } as unknown as JsonDiffEntry;
}

function tally(entries: { action: ImportAction }[]): Record<ImportAction, number> {
  const counts: Record<ImportAction, number> = {
    created: 0,
    updated: 0,
    unchanged: 0,
    conflict: 0,
    removed: 0,
  };
  for (const entry of entries) counts[entry.action] += 1;
  return counts;
}

function diffOf(
  entries: ImportDiffEntry[],
  json?: JsonDiffEntry[],
  seen?: Record<string, SeenFile>,
): FolderDiff {
  return {
    entries,
    counts: tally(entries),
    ...(json ? { json: { entries: json, counts: tally(json) } } : {}),
    ...(seen ? { seen } : {}),
  };
}

function seenAs(side: ChangeSide): SeenFile {
  return { side, digest: "digest" };
}

function pathOf(entry: ImportDiffEntry | JsonDiffEntry): string {
  return "entity" in entry ? entry.entity.path : entry.path;
}

function paths(entries: (ImportDiffEntry | JsonDiffEntry)[] | undefined): string[] {
  return (entries ?? []).map(pathOf);
}

test("a created note the folder alone wrote is applied", () => {
  const { apply, held } = splitOutsideEdits(
    diffOf([note("created", "a.md")], undefined, { "a.md": seenAs("folder") }),
  );
  assert.deepEqual(paths(apply.entries), ["a.md"]);
  assert.equal(held.entries.length, 0);
});

test("an updated note the folder alone changed is applied", () => {
  const { apply, held } = splitOutsideEdits(
    diffOf([note("updated", "a.md")], undefined, { "a.md": seenAs("folder") }),
  );
  assert.deepEqual(paths(apply.entries), ["a.md"]);
  assert.equal(held.entries.length, 0);
});

test("an updated note changed on both sides is held even when it merged cleanly", () => {
  const { apply, held } = splitOutsideEdits(
    diffOf([note("updated", "a.md")], undefined, { "a.md": seenAs("both") }),
  );
  assert.equal(apply.entries.length, 0);
  assert.deepEqual(paths(held.entries), ["a.md"]);
});

test("an updated note with an unknown side is held; a created note with no record is held", () => {
  const unknown = splitOutsideEdits(
    diffOf([note("updated", "u.md")], undefined, { "u.md": seenAs("unknown") }),
  );
  assert.equal(unknown.apply.entries.length, 0);
  assert.deepEqual(paths(unknown.held.entries), ["u.md"]);

  const noRecord = splitOutsideEdits(diffOf([note("created", "n.md")]));
  assert.equal(noRecord.apply.entries.length, 0);
  assert.deepEqual(paths(noRecord.held.entries), ["n.md"]);
});

test("a copy at a new path that updates a known note is held; a new note at a new path applies", () => {
  // e.g. "a copy.md" carrying a's id: the folder alone wrote it, but it would overwrite a.
  const fresh: SeenFile = { side: "folder", digest: "digest", newPath: true };
  const { apply, held } = splitOutsideEdits(
    diffOf([note("updated", "a copy.md", "a"), note("created", "b.md", "b")], undefined, {
      "a copy.md": fresh,
      "b.md": fresh,
    }),
  );
  assert.deepEqual(paths(apply.entries), ["b.md"]);
  assert.deepEqual(paths(held.entries), ["a copy.md"]);
});

test("a JSON data file at a new path with an updated row is held whole", () => {
  const fresh: SeenFile = { side: "folder", digest: "digest", newPath: true };
  const { apply, held } = splitOutsideEdits(
    diffOf(
      [],
      [row("updated", "data/tags copy.json", "t1"), row("created", "data/new.json", "n1")],
      { "data/tags copy.json": fresh, "data/new.json": fresh },
    ),
  );
  assert.deepEqual(paths(apply.json?.entries), ["data/new.json"]);
  assert.deepEqual(paths(held.json?.entries), ["data/tags copy.json"]);
});

test("a removed note and a conflict note are held even when the folder alone changed them", () => {
  const { apply, held } = splitOutsideEdits(
    diffOf([note("removed", "r.md"), note("conflict", "c.md")], undefined, {
      "r.md": seenAs("folder"),
      "c.md": seenAs("folder"),
    }),
  );
  assert.equal(apply.entries.length, 0);
  assert.deepEqual(paths(held.entries), ["r.md", "c.md"]);
});

test("an open note waits for review; the same note applies once it is closed", () => {
  const seen = { "a.md": seenAs("folder") };
  const open = splitOutsideEdits(
    diffOf([note("updated", "a.md", "n1")], undefined, seen),
    (id) => id === "n1",
  );
  assert.equal(open.apply.entries.length, 0);
  assert.deepEqual(paths(open.held.entries), ["a.md"]);

  const closed = splitOutsideEdits(
    diffOf([note("updated", "a.md", "n1")], undefined, seen),
    () => false,
  );
  assert.deepEqual(paths(closed.apply.entries), ["a.md"]);
  assert.equal(closed.held.entries.length, 0);
});

test("unchanged entries appear in neither output", () => {
  const { apply, held } = splitOutsideEdits(
    diffOf([note("unchanged", "u.md")], [row("unchanged", "data/tags.json", "t1")], {
      "u.md": seenAs("folder"),
      "data/tags.json": seenAs("folder"),
    }),
  );
  assert.equal(apply.entries.length, 0);
  assert.equal(held.entries.length, 0);
  assert.equal(apply.json?.entries.length, 0);
  assert.equal(held.json?.entries.length, 0);
  assert.equal(apply.counts.unchanged, 0);
  assert.equal(held.counts.unchanged, 0);
});

test("a JSON data file the folder alone changed goes in whole when every row is created or updated", () => {
  const { apply, held } = splitOutsideEdits(
    diffOf(
      [],
      [row("created", "data/tags.json", "t1"), row("updated", "data/tags.json", "t2")],
      { "data/tags.json": seenAs("folder") },
    ),
  );
  assert.deepEqual(paths(apply.json?.entries), ["data/tags.json", "data/tags.json"]);
  assert.equal(held.json?.entries.length, 0);
});

test("a JSON data file with an updated and a removed row is held whole", () => {
  const { apply, held } = splitOutsideEdits(
    diffOf(
      [],
      [row("updated", "data/tags.json", "t1"), row("removed", "data/tags.json", "t2")],
      { "data/tags.json": seenAs("folder") },
    ),
  );
  assert.equal(apply.json?.entries.length, 0);
  assert.equal(held.json?.entries.length, 2);
});

test("a JSON data file changed on both sides is held", () => {
  const { apply, held } = splitOutsideEdits(
    diffOf([], [row("updated", "data/tags.json", "t1")], {
      "data/tags.json": seenAs("both"),
    }),
  );
  assert.equal(apply.json?.entries.length, 0);
  assert.deepEqual(paths(held.json?.entries), ["data/tags.json"]);
});

test("counts have all five keys and match each output; seen is carried to apply", () => {
  const seen = {
    "new.md": seenAs("folder"),
    "up.md": seenAs("both"),
  };
  const { apply, held } = splitOutsideEdits(
    diffOf(
      [note("created", "new.md"), note("updated", "up.md"), note("conflict", "c.md")],
      undefined,
      seen,
    ),
  );
  const keys = ["created", "updated", "unchanged", "conflict", "removed"];
  assert.deepEqual(Object.keys(apply.counts).sort(), [...keys].sort());
  assert.deepEqual(Object.keys(held.counts).sort(), [...keys].sort());
  assert.deepEqual(
    { ...apply.counts },
    { created: 1, updated: 0, unchanged: 0, conflict: 0, removed: 0 },
  );
  assert.deepEqual(
    { ...held.counts },
    { created: 0, updated: 1, unchanged: 0, conflict: 1, removed: 0 },
  );
  assert.equal("json" in apply, false);
  assert.equal("json" in held, false);
  assert.deepEqual(apply.seen, seen);
});

test("applyOutsideEdits does not call apply when nothing is applyable, but still settles", async () => {
  let applyCalls = 0;
  let settled: FolderDiff | undefined;
  const result = await applyOutsideEdits({
    preview: async () => diffOf([note("conflict", "c.md")]),
    isOpen: () => false,
    apply: async () => {
      applyCalls += 1;
    },
    settle: (held) => {
      settled = held;
    },
  });
  assert.equal(applyCalls, 0);
  assert.notEqual(settled, undefined);
  assert.deepEqual(result, { applied: 0, held: 1 });
});

test("applyOutsideEdits calls apply before settle with only the applyable part", async () => {
  const events: string[] = [];
  const calls: { apply?: FolderDiff; settle?: FolderDiff } = {};
  const result = await applyOutsideEdits({
    preview: async () =>
      diffOf(
        [note("created", "new.md"), note("conflict", "c.md")],
        [row("created", "data/tags.json", "t1"), row("removed", "data/gone.json", "t2")],
        {
          "new.md": seenAs("folder"),
          "data/tags.json": seenAs("folder"),
          "data/gone.json": seenAs("folder"),
        },
      ),
    isOpen: () => false,
    apply: async (diff) => {
      events.push("apply");
      calls.apply = diff;
    },
    settle: (held) => {
      events.push("settle");
      calls.settle = held;
    },
  });
  assert.deepEqual(events, ["apply", "settle"]);
  assert.deepEqual(paths(calls.apply?.entries), ["new.md"]);
  assert.deepEqual(paths(calls.apply?.json?.entries), ["data/tags.json"]);
  assert.deepEqual(paths(calls.settle?.entries), ["c.md"]);
  assert.deepEqual(paths(calls.settle?.json?.entries), ["data/gone.json"]);
  assert.deepEqual(result, { applied: 2, held: 2 });
});

test("a throwing preview or apply rejects and skips settle", async () => {
  let settleCalls = 0;
  const settle = () => {
    settleCalls += 1;
  };
  await assert.rejects(
    applyOutsideEdits({
      preview: async () => {
        throw new Error("preview failed");
      },
      isOpen: () => false,
      apply: async () => undefined,
      settle,
    }),
    /preview failed/,
  );
  await assert.rejects(
    applyOutsideEdits({
      preview: async () => diffOf([note("created", "a.md")], undefined, { "a.md": seenAs("folder") }),
      isOpen: () => false,
      apply: async () => {
        throw new Error("apply failed");
      },
      settle,
    }),
    /apply failed/,
  );
  assert.equal(settleCalls, 0);
});

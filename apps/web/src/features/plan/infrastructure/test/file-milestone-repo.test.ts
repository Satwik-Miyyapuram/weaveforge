import { before, test } from "node:test";
import assert from "node:assert/strict";
import type { Milestone } from "@weaveforge/core";
import { MemoryWorkspaceFs } from "@core-test/memory-workspace-fs";
import { loadTestCore } from "@/lib/test/load-test-core";
import { FileMilestoneRepository, hasBadDate, type FeedItem } from "../file-milestone-repo";

before(loadTestCore);

function milestone(over: Partial<Milestone> = {}): Milestone {
  return {
    id: "ms-1",
    title: "Submit draft",
    status: "planned",
    targetDate: "2026-12-01",
    dependencies: [],
    compute: [],
    createdAt: "2026-11-01T00:00:00Z",
    ...over,
  };
}

function setup() {
  const fs = new MemoryWorkspaceFs();
  const published: FeedItem[][] = [];
  const repo = new FileMilestoneRepository(fs, "thesis", async (items) => {
    published.push(items);
  });
  return { fs, repo, published };
}

async function files(fs: MemoryWorkspaceFs): Promise<string[]> {
  const out: string[] = [];
  for await (const entry of fs.walk("")) out.push(entry.path);
  return out.sort();
}

test("a saved milestone reads back unchanged", async () => {
  const { repo } = setup();
  const saved = milestone({ description: "Chapters 1 to 3." });
  await repo.save(saved);
  assert.deepEqual(await repo.getById("ms-1"), saved);
  assert.deepEqual(await repo.list(), [saved]);
});

test("milestone_change_publishes_feed: every save and delete publishes the whole feed", async () => {
  const { repo, published } = setup();
  await repo.save(milestone());
  await repo.save(milestone({ status: "done" }));
  await repo.delete("ms-1");
  assert.equal(published.length, 3);
  assert.equal(published[1]?.[0]?.status, "done");
  assert.deepEqual(published[2], []);
});

test("F97-P2-24: a deleted milestone moves to .weaveforge/trash/<day>/, never unlinked", async () => {
  const { fs, repo } = setup();
  await repo.save(milestone());
  const [path] = await files(fs);
  await repo.delete("ms-1");
  const after = await files(fs);
  assert.equal(after.length, 1);
  const [trashed] = after;
  assert.match(trashed ?? "", /^\.weaveforge\/trash\/\d{4}-\d{2}-\d{2}\//);
  assert.ok(trashed?.endsWith(path ?? "missing"), trashed);
  assert.equal(await repo.getById("ms-1"), null);
  // A second delete of the same name the same day takes a free name, not the first one.
  await repo.save(milestone());
  await repo.delete("ms-1");
  assert.equal((await files(fs)).length, 2);
});

test("F97-P2-23: one unreadable milestone file is skipped and reported; the rest still list", async () => {
  const { fs, repo } = setup();
  await repo.save(milestone({ id: "ms-1", title: "One" }));
  await repo.save(milestone({ id: "ms-2", title: "Two" }));
  await repo.save(milestone({ id: "ms-3", title: "Three" }));
  const bad = (await files(fs)).find((p) => p.includes("two"));
  assert.ok(bad);
  const readText = fs.readText.bind(fs);
  fs.readText = async (path: string) => {
    if (path === bad) throw new Error("EACCES");
    return readText(path);
  };
  const warned: unknown[] = [];
  const warn = console.warn;
  console.warn = (...args: unknown[]) => void warned.push(args);
  try {
    const listed = (await repo.list()).map((m) => m.id).sort();
    assert.deepEqual(listed, ["ms-1", "ms-3"]);
    assert.equal(warned.length, 1);
  } finally {
    console.warn = warn;
  }
});

test("no_milestones_valid_calendar: an empty folder lists nothing and publishes an empty feed", async () => {
  const { repo, published } = setup();
  assert.deepEqual(await repo.list(), []);
  await repo.delete("missing");
  assert.deepEqual(published, [[]]);
});

test("a file with only `due` reads its date from `due`; `target-date` wins over it", async () => {
  const { fs, repo } = setup();
  await fs.writeFile(
    "thesis/plan/a--x.milestone.md",
    "---\nweaveforge-id: ms-a\nweaveforge-type: milestone\ntitle: A\ndue: 2026-10-10\n---\n",
  );
  await fs.writeFile(
    "thesis/plan/b--y.milestone.md",
    "---\nweaveforge-id: ms-b\nweaveforge-type: milestone\ntitle: B\ndue: 2026-10-10\ntarget-date: 2026-11-11\n---\n",
  );
  assert.equal((await repo.getById("ms-a"))?.targetDate, "2026-10-10");
  assert.equal((await repo.getById("ms-b"))?.targetDate, "2026-11-11");
});

test("invalid_due_date: badge, left out of the feed, file not changed", async () => {
  const { fs, repo, published } = setup();
  const path = "thesis/plan/bad--z.milestone.md";
  const text = "---\nweaveforge-id: ms-bad\nweaveforge-type: milestone\ntitle: Bad\ndue: 2026-02-30\n---\n";
  await fs.writeFile(path, text);
  const bad = await repo.getById("ms-bad");
  assert.ok(bad && hasBadDate(bad));
  await repo.save(milestone());
  const feed = published.at(-1) ?? [];
  assert.equal(feed.find((item) => item.id === "ms-bad")?.targetDate, undefined);
  assert.equal(await fs.readText(path), text);
});

test("filters by status and title, case-insensitively", async () => {
  const { repo } = setup();
  await repo.save(milestone());
  await repo.save(milestone({ id: "ms-2", title: "Defend", status: "done" }));
  assert.deepEqual((await repo.list({ status: "done" })).map((m) => m.id), ["ms-2"]);
  assert.deepEqual((await repo.list({ titleContains: "SUBMIT" })).map((m) => m.id), ["ms-1"]);
});

test("a save keeps fields it does not own and the path it was found at", async () => {
  const { fs, repo } = setup();
  const path = "thesis/plan/old-name--q.milestone.md";
  await fs.writeFile(path, "---\nweaveforge-id: ms-1\nweaveforge-type: milestone\ntitle: Old\ncolour: red\n---\nbody\n");
  await repo.save(milestone({ title: "New" }));
  assert.deepEqual(await files(fs), [path]);
  assert.match(await fs.readText(path), /colour: red/);
  assert.equal((await repo.getById("ms-1"))?.title, "New");
});

test("a file changed between read and write is not overwritten", async () => {
  const { fs, repo } = setup();
  await repo.save(milestone());
  const [path] = await files(fs);
  const real = fs.writeTextIf.bind(fs);
  fs.writeTextIf = async (p, text, expected) => {
    await fs.writeFile(p, "---\nweaveforge-id: ms-1\nweaveforge-type: milestone\ntitle: Theirs\n---\n");
    return real(p, text, expected);
  };
  await assert.rejects(repo.save(milestone({ title: "Mine" })));
  assert.match(await fs.readText(path ?? ""), /Theirs/);
});

test("non-milestone files in the plan folder are ignored", async () => {
  const { fs, repo } = setup();
  await fs.writeFile("thesis/plan/readme.md", "# Plan\n");
  await fs.writeFile("thesis/plan/n--a.note.md", "---\nweaveforge-id: n\nweaveforge-type: note\n---\n");
  assert.deepEqual(await repo.list(), []);
});

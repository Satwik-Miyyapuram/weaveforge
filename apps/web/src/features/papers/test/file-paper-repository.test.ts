import { before, test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import type { Paper } from "@weaveforge/core";
import { ConflictError } from "@weaveforge/core";
import { MemoryWorkspaceFs } from "@core-test/memory-workspace-fs";
import { loadTestCore } from "@/lib/test/load-test-core";
import { typedCore } from "@/lib/rust-core";
import { FilePaperRepository } from "../infrastructure/file-paper-repository";

before(async () => {
  await loadTestCore();
});

const ROOT = "thesis";

function paper(overrides: Partial<Paper> = {}): Paper {
  return {
    id: "p-1",
    title: "Attention Is All You Need",
    authors: ["Vaswani"],
    status: "to_read",
    tags: [],
    metadata: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function setup() {
  const fs = new MemoryWorkspaceFs();
  return { fs, repo: new FilePaperRepository(fs, ROOT) };
}

async function onlyFile(fs: MemoryWorkspaceFs): Promise<string> {
  const paths: string[] = [];
  for await (const entry of fs.walk(`${ROOT}/papers`)) paths.push(entry.path);
  assert.equal(paths.length, 1, `one file, got ${paths.join(", ")}`);
  return paths[0]!;
}

test("save writes one .paper.md under papers/ and reads it back", async () => {
  const { fs, repo } = setup();
  const p = paper({ doi: "10.1/x", year: 2017, summary: "short" });
  await repo.save(p);
  const path = await onlyFile(fs);
  assert.match(path, /^thesis\/papers\/[^/]+\.paper\.md$/);
  assert.match(await fs.readText(path), /weaveforge-id: "p-1"/);
  assert.deepEqual(await repo.getById("p-1"), p);
  assert.deepEqual(await repo.findByDoi("https://doi.org/10.1/X"), p);
  assert.deepEqual(await repo.findIdentityByDoi("10.1/x"), { id: "p-1", title: p.title, status: "to_read" });
});

test("save keeps the body and keys the app does not own", async () => {
  const { fs, repo } = setup();
  await repo.save(paper());
  const path = await onlyFile(fs);
  const text = await fs.readText(path);
  const edited = text.replace("---\n", "---\nmy-key: kept\n") + "\nMy notes.\n";
  await fs.writeFile(path, edited);
  await repo.save(paper({ title: "Renamed", status: "read" }));
  const after = await fs.readText(path);
  assert.match(after, /my-key: kept/);
  assert.match(after, /My notes\./);
  assert.equal((await repo.getById("p-1"))?.title, "Renamed");
  assert.equal(await onlyFile(fs), path, "renaming the title keeps the file");
});

test("list filters and sorts newest first; skips files that are not papers", async () => {
  const { fs, repo } = setup();
  await repo.save(paper({ id: "a", title: "Old", createdAt: "2026-01-01" }));
  await repo.save(paper({ id: "b", title: "New", status: "read", createdAt: "2026-02-01" }));
  await fs.writeFile(`${ROOT}/papers/broken.paper.md`, "no frontmatter");
  assert.deepEqual((await repo.list()).map((p) => p.id), ["b", "a"]);
  assert.deepEqual((await repo.list({ status: "read" })).map((p) => p.id), ["b"]);
  assert.deepEqual((await repo.list({ titleContains: "ol" })).map((p) => p.id), ["a"]);
});

test("setTags, replaceSummary and delete", async () => {
  const { fs, repo } = setup();
  await repo.save(paper({ summary: "one" }));
  await repo.setTags("p-1", ["ml", "nlp"], "2026-03-01");
  assert.deepEqual((await repo.getById("p-1"))?.tags, ["ml", "nlp"]);
  assert.equal(await repo.replaceSummary("p-1", "stale", "two", "2026-03-02"), false);
  assert.equal(await repo.replaceSummary("p-1", "one", "two", "2026-03-02"), true);
  assert.equal((await repo.getById("p-1"))?.summary, "two");
  await repo.setTags("missing", ["x"], "2026-03-03");
  await repo.delete("p-1");
  assert.equal(await repo.getById("p-1"), null);
  for await (const entry of fs.walk(`${ROOT}/papers`)) assert.fail(`left ${entry.path}`);
});

async function trashed(fs: MemoryWorkspaceFs): Promise<string[]> {
  const paths: string[] = [];
  if (!(await fs.stat(".weaveforge/trash"))) return paths;
  for await (const entry of fs.walk(".weaveforge/trash")) paths.push(entry.path);
  return paths.sort();
}

test("delete moves the file to the workspace trash; it never unlinks", async () => {
  const { fs, repo } = setup();
  await repo.save(paper());
  const path = await onlyFile(fs);
  const text = await fs.readText(path);
  const removed: string[] = [];
  const remove = fs.remove.bind(fs);
  fs.remove = async (target, options) => {
    removed.push(target);
    await remove(target, options);
  };
  await repo.delete("p-1");
  assert.deepEqual(removed, []);
  assert.equal(await fs.stat(path), null);
  const moved = await trashed(fs);
  assert.equal(moved.length, 1, moved.join(", "));
  assert.match(moved[0]!, /^\.weaveforge\/trash\/\d{4}-\d{2}-\d{2}\//);
  assert.ok(moved[0]!.endsWith(`/${path}`), moved[0]);
  assert.equal(await fs.readText(moved[0]!), text);
});

test("deleting the same path twice keeps both copies in the trash", async () => {
  const { fs, repo } = setup();
  await repo.save(paper({ summary: "first" }));
  await repo.delete("p-1");
  await repo.save(paper({ summary: "second" }));
  await repo.delete("p-1");
  const copies = await trashed(fs);
  assert.equal(copies.length, 2, copies.join(", "));
  assert.ok(copies.some((c) => /-2(\.paper)?\.md$/.test(c)), copies.join(", "));
  const texts = await Promise.all(copies.map((c) => fs.readText(c)));
  assert.ok(texts.some((t) => /summary: "?first"?$/m.test(t)), texts.join("\n"));
  assert.ok(texts.some((t) => /summary: "?second"?$/m.test(t)), texts.join("\n"));
});

test("two files with one id: every write is refused and neither file changes", async () => {
  const { fs, repo } = setup();
  await repo.save(paper({ summary: "one" }));
  const first = await onlyFile(fs);
  const second = `${ROOT}/papers/copy--p-1.paper.md`;
  const text = await fs.readText(first);
  await fs.writeFile(second, text);
  await assert.rejects(repo.save(paper({ title: "New" })), (error: unknown) => {
    assert.ok(error instanceof ConflictError);
    assert.ok(error.message.includes(first) && error.message.includes(second), error.message);
    return true;
  });
  await assert.rejects(repo.setTags("p-1", ["x"], "2026-03-01"), ConflictError);
  await assert.rejects(repo.replaceSummary("p-1", "one", "two", "2026-03-02"), ConflictError);
  await assert.rejects(repo.delete("p-1"), ConflictError);
  assert.equal(await fs.readText(first), text);
  assert.equal(await fs.readText(second), text);
  assert.deepEqual(await trashed(fs), []);
});

test("without a conditional write the repository refuses to write", async () => {
  const { fs, repo } = setup();
  Object.defineProperty(fs, "writeTextIf", { value: undefined });
  await assert.rejects(repo.save(paper()), /conditional write/i);
  assert.equal(await fs.stat(`${ROOT}/papers`), null);
});

test("a file from a newer app is never overwritten", async () => {
  const { fs, repo } = setup();
  const path = `${ROOT}/papers/future--p1.paper.md`;
  const text = "---\nweaveforge-id: p-1\nweaveforge-type: paper\nwf: 99\ntitle: Future\n---\nbody\n";
  await fs.writeFile(path, text);
  await assert.rejects(repo.save(paper()));
  assert.equal(await fs.readText(path), text);
});

// ---- Identity by path, names, failures, CRLF (review rows L1L2 P1/P2) ----

test("a new file is named after the title only; a second paper of that title gets -2", async () => {
  const { fs, repo } = setup();
  await repo.save(paper({ id: "p-1" }));
  await repo.save(paper({ id: "p-2" }));
  const paths: string[] = [];
  for await (const entry of fs.walk(`${ROOT}/papers`)) paths.push(entry.path);
  paths.sort();
  assert.equal(paths.length, 2, paths.join(", "));
  for (const path of paths) assert.ok(!path.includes("--"), `no id in ${path}`);
  assert.ok(paths.some((path) => path.endsWith("-2.paper.md")), paths.join(", "));
  assert.equal((await repo.getById("p-1"))?.id, "p-1");
  assert.equal((await repo.getById("p-2"))?.id, "p-2");
});

test("a file with no weaveforge-id is the paper at its path; a write adds no id", async () => {
  const { fs, repo } = setup();
  const path = `${ROOT}/papers/Hand made.paper.md`;
  await fs.writeFile(path, '---\nweaveforge-type: "paper"\ntitle: "Hand made"\nstatus: "to_read"\n---\nnotes\n');
  const [listed] = await repo.list();
  assert.equal(listed?.id, path);
  assert.equal((await repo.getById(path))?.title, "Hand made");
  await repo.setTags(path, ["x"], "2026-03-01");
  const after = await fs.readText(path);
  assert.doesNotMatch(after, /weaveforge-id/);
  assert.match(after, /notes/);
  assert.deepEqual((await repo.getById(path))?.tags, ["x"]);
});

test("writeIds: false writes no id; the paper is then known by its path", async () => {
  const fs = new MemoryWorkspaceFs();
  const repo = new FilePaperRepository(fs, ROOT, { writeIds: false });
  await repo.save(paper());
  const path = await onlyFile(fs);
  assert.doesNotMatch(await fs.readText(path), /weaveforge-id/);
  assert.equal((await repo.list())[0]?.id, path);
  assert.equal(await repo.pathOf(path), path);
});

test("failures() names each file that is not a paper; list still skips it", async () => {
  const { fs, repo } = setup();
  await repo.save(paper());
  await fs.writeFile(`${ROOT}/papers/broken.paper.md`, "no frontmatter");
  const failures = await repo.failures();
  assert.deepEqual(failures.map((f) => f.path), [`${ROOT}/papers/broken.paper.md`]);
  assert.ok(failures[0]!.error.length > 0);
  assert.equal((await repo.list()).length, 1);
});

test("one unreadable file in a folder of 3: list keeps the other 2, failures() reports it", async () => {
  const { fs, repo } = setup();
  await repo.save(paper({ id: "p-1", title: "One" }));
  await repo.save(paper({ id: "p-2", title: "Two" }));
  await repo.save(paper({ id: "p-3", title: "Three" }));
  const bad = (await repo.list()).find((p) => p.id === "p-2")!;
  const badPath = await repo.pathOf(bad.id);
  const readText = fs.readText.bind(fs);
  fs.readText = async (path: string) => {
    if (path === badPath) throw new Error("EACCES: permission denied");
    return readText(path);
  };
  assert.deepEqual((await repo.list()).map((p) => p.id).sort(), ["p-1", "p-3"]);
  const failures = await repo.failures();
  assert.deepEqual(failures.map((f) => f.path), [badPath]);
  assert.match(failures[0]!.error, /EACCES/);
});

test("a CRLF file stays CRLF after setTags", async () => {
  const { fs, repo } = setup();
  await repo.save(paper());
  const path = await onlyFile(fs);
  await fs.writeFile(path, (await fs.readText(path)).replace(/\n/g, "\r\n") + "Body\r\n");
  await repo.setTags("p-1", ["ml"], "2026-03-01");
  const after = await fs.readText(path);
  assert.doesNotMatch(after.replace(/\r\n/g, ""), /\n/, "every line ends in CRLF");
  assert.match(after, /Body\r\n$/);
});

test("a file without createdAt never gets an empty createdAt written", async () => {
  const { fs, repo } = setup();
  const path = `${ROOT}/papers/Bare.paper.md`;
  await fs.writeFile(path, '---\nweaveforge-id: "p-9"\nweaveforge-type: "paper"\ntitle: "Bare"\nstatus: "to_read"\n---\n');
  await repo.setTags("p-9", ["x"], "2026-03-01");
  assert.doesNotMatch(await fs.readText(path), /createdAt|created-at|created: ""/i);
});

test("delete trashes the paper, its annotations and comments sidecars and its PDF together", async () => {
  const { fs, repo } = setup();
  const pdf = `${ROOT}/papers/pdf/attention.pdf`;
  await fs.writeFile(pdf, "%PDF");
  await repo.save(paper({ pdfPath: pdf }));
  // papers/ also holds the PDF, so pick out the one paper file.
  const papers: string[] = [];
  for await (const entry of fs.walk(`${ROOT}/papers`)) if (entry.path.endsWith(".paper.md")) papers.push(entry.path);
  assert.equal(papers.length, 1, papers.join(", "));
  const path = papers[0]!;
  const stem = path.slice(0, -".paper.md".length);
  await fs.writeFile(`${stem}.annotations.json`, "[]\n");
  await fs.writeFile(`${stem}.comments.json`, "[]\n");
  await repo.delete("p-1");
  for (const gone of [path, `${stem}.annotations.json`, `${stem}.comments.json`, pdf]) {
    assert.equal(await fs.stat(gone), null, `${gone} moved`);
  }
  const moved = await trashed(fs);
  assert.equal(moved.length, 4, moved.join(", "));
  const day = moved[0]!.split("/").slice(0, 3).join("/");
  for (const entry of moved) assert.ok(entry.startsWith(`${day}/`), "one day folder");
});

test("delete keeps a PDF another paper still uses, and never touches one outside the workspace", async () => {
  const { fs, repo } = setup();
  const pdf = `${ROOT}/papers/pdf/shared.pdf`;
  await fs.writeFile(pdf, "%PDF");
  await repo.save(paper({ id: "p-1", title: "One", pdfPath: pdf }));
  await repo.save(paper({ id: "p-2", title: "Two", pdfPath: pdf }));
  await repo.save(paper({ id: "p-3", title: "Three", pdfPath: "../outside.pdf" }));
  await repo.delete("p-1");
  await repo.delete("p-3");
  assert.equal(await fs.readText(pdf), "%PDF");
});

test("delete never overwrites a trash file that appears after it looked (time-of-check gap)", async () => {
  const fs = new MemoryWorkspaceFs();
  const repo = new FilePaperRepository(fs, ROOT);
  await repo.save(paper());
  const path = await onlyFile(fs);
  const first = typedCore().trashPathFor(path, Date.now(), 1);
  await fs.writeFile(first, "someone else's file");
  const stat = fs.stat.bind(fs);
  fs.stat = async (target) => (target.startsWith(".weaveforge/trash") ? null : stat(target));
  await repo.delete("p-1");
  assert.equal(await fs.readText(first), "someone else's file");
  fs.stat = stat;
  const moved = await trashed(fs);
  assert.equal(moved.length, 2, moved.join(", "));
  assert.ok(moved.some((entry) => entry.endsWith("-2.paper.md")), moved.join(", "));
});

/** A file system whose next conditional write first lets "another app" edit the file. */
class RacingFs extends MemoryWorkspaceFs {
  race: (() => Promise<void>) | null = null;

  override async writeTextIf(path: string, text: string, expected: string | null): Promise<boolean> {
    const race = this.race;
    this.race = null;
    if (race) await race();
    return super.writeTextIf(path, text, expected);
  }
}

test("setTags racing an outside edit keeps that edit", async () => {
  const fs = new RacingFs();
  const repo = new FilePaperRepository(fs, ROOT);
  await repo.save(paper());
  const path = await onlyFile(fs);
  fs.race = async () => fs.writeFile(path, (await fs.readText(path)) + "Outside edit.\n");
  await repo.setTags("p-1", ["ml"], "2026-03-01");
  const after = await fs.readText(path);
  assert.match(after, /Outside edit\./);
  assert.deepEqual((await repo.getById("p-1"))?.tags, ["ml"]);
});

// ---- Laws (fast-check) ----

const text = fc.string({ maxLength: 20 });
const paperArb = fc.record({
  title: text,
  authors: fc.array(text, { maxLength: 3 }),
  status: fc.constantFrom("to_read", "reading", "read"),
  tags: fc.uniqueArray(fc.stringMatching(/^[a-z]{1,8}$/), { maxLength: 3 }),
  year: fc.option(fc.integer({ min: 1900, max: 2100 }), { nil: undefined }),
  summary: fc.option(text.filter((s) => s.length > 0), { nil: undefined }),
});

test("law: getById(save(p)) == p", async () => {
  await fc.assert(
    fc.asyncProperty(paperArb, async (fields) => {
      const { repo } = setup();
      const p = paper(stripUndefined(fields) as Partial<Paper>);
      await repo.save(p);
      assert.deepEqual(await repo.getById(p.id), p);
    }),
    { numRuns: 60 },
  );
});

test("law: save never drops the body or unknown keys of the file it rewrites", async () => {
  await fc.assert(
    fc.asyncProperty(paperArb, text, async (fields, body) => {
      const { fs, repo } = setup();
      await repo.save(paper());
      const path = await onlyFile(fs);
      const original = await fs.readText(path);
      await fs.writeFile(path, original.replace("---\n", "---\nmy-key: kept\n") + body);
      await repo.save(paper(stripUndefined(fields) as Partial<Paper>));
      const after = await fs.readText(path);
      assert.ok(after.includes("my-key: kept"));
      assert.ok(after.endsWith(body), "body kept");
    }),
    { numRuns: 60 },
  );
});

test("law: delete moves exactly that paper's file to the trash and changes no other file", async () => {
  await fc.assert(
    fc.asyncProperty(fc.integer({ min: 1, max: 5 }), fc.nat(), async (count, pick) => {
      const { fs, repo } = setup();
      for (let i = 0; i < count; i += 1) await repo.save(paper({ id: `p-${i}`, title: `T${i}` }));
      const before = new Map<string, string>();
      for await (const entry of fs.walk(`${ROOT}/papers`)) before.set(entry.path, await fs.readText(entry.path));
      const id = `p-${pick % count}`;
      // Found by the id the file carries, not by its name: the name's id suffix drops the dash.
      const [gone] = [...before].filter(([, body]) => body.includes(`weaveforge-id: "${id}"`)).map(([path]) => path);
      assert.ok(gone, `a file carries ${id}`);
      await repo.delete(id);
      for (const [path, text] of before) {
        if (path === gone) assert.equal(await fs.stat(path), null);
        else assert.equal(await fs.readText(path), text);
      }
      const moved = await trashed(fs);
      assert.equal(moved.length, 1);
      assert.equal(await fs.readText(moved[0]!), before.get(gone!));
    }),
    { numRuns: 40 },
  );
});

function stripUndefined(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).filter(([, v]) => v !== undefined));
}

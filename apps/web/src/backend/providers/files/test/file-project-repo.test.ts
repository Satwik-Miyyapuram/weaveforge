/**
 * Projects are folders (0.9.8): every top-level folder of the workspace whose
 * name does not start with "." is a project, named after the folder. A
 * 0.9.7 `<name>--<id6>` folder is renamed to `<name>` the first time the list is
 * read.
 */
import { before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ProjectValidationError } from "@weaveforge/core";
import { MemoryWorkspaceFs } from "@core-test/memory-workspace-fs";
import { loadTestCore } from "@/lib/test/load-test-core";
import { FileProjectRepository, PROJECT_FOLDERS } from "../file-project-repo";

before(loadTestCore);

function setup(fs = new MemoryWorkspaceFs()) {
  const moves: [string, string][] = [];
  const repo = new FileProjectRepository(fs, async (from, to) => void moves.push([from, to]));
  return { fs, repo, moves };
}

const names = async (repo: FileProjectRepository) => (await repo.list()).map((p) => p.name);

test("every non-dot top-level folder is a project; files and dot folders are not", async () => {
  const { fs, repo } = setup();
  await fs.writeFile("Thesis/notes/a.md", "a");
  await fs.mkdirp("My own folder");
  await fs.mkdirp(".weaveforge");
  await fs.mkdirp(".git");
  await fs.writeFile("README.md", "root file");
  assert.deepEqual(await names(repo), ["My own folder", "Thesis"]);
  const thesis = await repo.getById("Thesis");
  assert.equal(thesis?.id, "Thesis");
  assert.equal(thesis?.name, "Thesis");
});

test("an empty workspace lists nothing; an unknown id is null", async () => {
  const { repo } = setup();
  assert.deepEqual(await repo.list(), []);
  assert.equal(await repo.getById("nope"), null);
});

test("create makes the folder with the standard subfolders and its extras file", async () => {
  const { fs, repo } = setup();
  const created = await repo.create({ name: "  Thesis  ", color: "#336699" });
  assert.equal(created.id, "Thesis");
  assert.equal(created.name, "Thesis");
  for (const dir of PROJECT_FOLDERS) assert.equal((await fs.stat(`Thesis/${dir}`))?.kind, "dir", dir);
  const extras = JSON.parse(await fs.readText("Thesis/.weaveforge/project.json")) as Record<string, unknown>;
  assert.equal(extras.color, "#336699");
  assert.equal(extras.createdAt, created.createdAt);
  assert.deepEqual(await repo.list(), [created]);
});

test("a second project does not replace the first", async () => {
  const { repo } = setup();
  await repo.create({ name: "One" });
  await repo.create({ name: "Two" });
  assert.deepEqual(await names(repo), ["One", "Two"]);
});

test("a name already taken by a folder or file is refused and nothing is written", async () => {
  const { fs, repo } = setup();
  await fs.writeFile("Thesis/notes/a.md", "keep");
  await fs.writeFile("loose.txt", "x");
  await assert.rejects(repo.create({ name: "Thesis" }), ProjectValidationError);
  await assert.rejects(repo.create({ name: "loose.txt" }), ProjectValidationError);
  assert.equal(await fs.stat("Thesis/.weaveforge/project.json"), null);
  assert.equal(await fs.readText("Thesis/notes/a.md"), "keep");
});

test("names a folder cannot have are refused", async () => {
  const { repo } = setup();
  for (const bad of ["   ", "a/b", "a\\b", "a:b", "a*b", "a?b", 'a"b', "a<b", "a>b", "a|b", ".hidden", "trailing.", "dot then space. ", "CON", "nul", "com1", "LPT9", "..", "."]) {
    await assert.rejects(repo.create({ name: bad }), ProjectValidationError, JSON.stringify(bad));
  }
  assert.deepEqual(await repo.list(), []);
});

test("extras: colour and created date come from project.json; a broken file means defaults", async () => {
  const { fs, repo } = setup();
  await fs.writeFile("A/.weaveforge/project.json", JSON.stringify({ color: "#112233", createdAt: "2026-01-01T00:00:00.000Z" }));
  await fs.writeFile("B/.weaveforge/project.json", "{not json");
  const [a, b] = await repo.list();
  assert.deepEqual(a, { id: "A", name: "A", color: "#112233", createdAt: "2026-01-01T00:00:00.000Z" });
  assert.deepEqual(b, { id: "B", name: "B", createdAt: "" });
});

test("save writes the colour into project.json and keeps its other keys", async () => {
  const { fs, repo } = setup();
  const created = await repo.create({ name: "Thesis" });
  const path = "Thesis/.weaveforge/project.json";
  await fs.writeFile(path, JSON.stringify({ ...JSON.parse(await fs.readText(path)), description: "kept" }));
  await repo.save({ ...created, color: "#abcdef" });
  const after = JSON.parse(await fs.readText(path)) as Record<string, unknown>;
  assert.equal(after.color, "#abcdef");
  assert.equal(after.description, "kept");
  assert.equal(after.createdAt, created.createdAt);
});

test("save of a project whose folder is gone is NotFound", async () => {
  const { repo } = setup();
  await assert.rejects(repo.save({ id: "Gone", name: "Gone", createdAt: "" }), /not found/i);
});

test("workspace.json is no longer read as a project", async () => {
  const { fs, repo } = setup();
  await fs.writeFile(".weaveforge/workspace.json", JSON.stringify({ id: "x", name: "Old" }));
  assert.deepEqual(await repo.list(), []);
});

// --- 0.9.7 folder names ---

test("a 0.9.7 `slug--id6` project folder becomes the workspace.json name", async () => {
  const fs = new MemoryWorkspaceFs();
  await fs.writeFile(
    ".weaveforge/workspace.json",
    JSON.stringify({ id: "8d731734-bdcd-4f08", name: "MSc Thesis", color: "#7c9885", createdAt: "2026-01-01T00:00:00.000Z", other: 1 }),
  );
  await fs.writeFile("msc-thesis--8d7317/notes/a.md", "hello");
  await fs.writeFile("msc-thesis--8d7317/notes/a.md.ink/p1.inkb", "ink");
  await fs.mkdirp("msc-thesis--8d7317/papers");
  const { repo, moves } = setup(fs);

  assert.deepEqual(await repo.list(), [
    { id: "MSc Thesis", name: "MSc Thesis", color: "#7c9885", createdAt: "2026-01-01T00:00:00.000Z" },
  ]);
  assert.equal(await fs.readText("MSc Thesis/notes/a.md"), "hello");
  assert.equal(await fs.readText("MSc Thesis/notes/a.md.ink/p1.inkb"), "ink");
  assert.equal((await fs.stat("MSc Thesis/papers"))?.kind, "dir");
  assert.equal(await fs.stat("msc-thesis--8d7317"), null);
  assert.deepEqual(moves, [["msc-thesis--8d7317", "MSc Thesis"]]);
  assert.equal(JSON.parse(await fs.readText(".weaveforge/workspace.json")).other, 1);
});

test("a 0.9.7 folder with no matching workspace.json keeps its slug as the name", async () => {
  const fs = new MemoryWorkspaceFs();
  await fs.writeFile("side-project--abc123/notes/a.md", "a");
  const { repo } = setup(fs);
  assert.deepEqual(await names(repo), ["side-project"]);
  assert.equal(await fs.readText("side-project/notes/a.md"), "a");
});

test("a 0.9.7 folder whose new name is taken is left alone and still listed", async () => {
  const fs = new MemoryWorkspaceFs();
  await fs.writeFile("thesis--abc123/notes/a.md", "old");
  await fs.writeFile("thesis/notes/a.md", "new");
  const { repo, moves } = setup(fs);
  assert.deepEqual(await names(repo), ["thesis", "thesis--abc123"]);
  assert.equal(await fs.readText("thesis--abc123/notes/a.md"), "old");
  assert.equal(await fs.readText("thesis/notes/a.md"), "new");
  assert.deepEqual(moves, []);
});

test("a `--` folder without the project layout is the user's and is not renamed", async () => {
  const fs = new MemoryWorkspaceFs();
  await fs.writeFile("photos--2024/a.jpg", "x");
  const { repo } = setup(fs);
  assert.deepEqual(await names(repo), ["photos--2024"]);
});

test("the rename runs once, not on every list", async () => {
  const fs = new MemoryWorkspaceFs();
  await fs.writeFile("thesis--abc123/notes/a.md", "a");
  const { repo } = setup(fs);
  await repo.list();
  await fs.writeFile("later--def456/notes/b.md", "b");
  assert.deepEqual(await names(repo), ["later--def456", "thesis"]);
});

// --- 0.9.7 root project ---

test("a 0.9.7 root project moves into a folder named after workspace.json", async () => {
  const fs = new MemoryWorkspaceFs();
  await fs.writeFile(".weaveforge/workspace.json", JSON.stringify({ id: "8d731734-bdcd", name: "MSc Thesis", color: "#7c9885", createdAt: "2026-01-01T00:00:00.000Z" }));
  await fs.writeFile("notes/a.md", "hello");
  await fs.writeFile("papers/p.md", "paper");
  await fs.writeFile("assets/vault/img.png", "png");
  await fs.writeFile(".weaveforge/annotation-pins.json", "[]");
  await fs.writeFile(".weaveforge/settings.json", "{}");
  await fs.writeFile("photos/a.jpg", "mine");
  const { repo, moves } = setup(fs);

  assert.deepEqual(await names(repo), ["MSc Thesis", "photos"]);
  assert.equal(await fs.readText("MSc Thesis/notes/a.md"), "hello");
  assert.equal(await fs.readText("MSc Thesis/papers/p.md"), "paper");
  assert.equal(await fs.readText("MSc Thesis/assets/vault/img.png"), "png");
  assert.equal(await fs.readText("MSc Thesis/.weaveforge/annotation-pins.json"), "[]");
  assert.equal(await fs.readText(".weaveforge/settings.json"), "{}");
  assert.equal(await fs.stat("notes"), null);
  assert.equal(await fs.stat("assets"), null);
  assert.equal((await repo.getById("MSc Thesis"))?.color, "#7c9885");
  assert.deepEqual(moves, [["", "MSc Thesis"]]);
});

test("a root project without a usable name goes to Project", async () => {
  const fs = new MemoryWorkspaceFs();
  await fs.writeFile(".weaveforge/workspace.json", JSON.stringify({ name: "a/b" }));
  await fs.writeFile("plan/m.md", "m");
  const { repo } = setup(fs);
  assert.deepEqual(await names(repo), ["Project"]);
  assert.equal(await fs.readText("Project/plan/m.md"), "m");
});

test("a root project whose name is taken stays in the root", async () => {
  const fs = new MemoryWorkspaceFs();
  await fs.writeFile(".weaveforge/workspace.json", JSON.stringify({ name: "Thesis" }));
  await fs.writeFile("notes/a.md", "root");
  await fs.writeFile("Thesis/notes/a.md", "other");
  const { repo, moves } = setup(fs);
  await repo.list();
  assert.equal(await fs.readText("notes/a.md"), "root");
  assert.equal(await fs.readText("Thesis/notes/a.md"), "other");
  assert.deepEqual(moves, []);
});

test("the root project takes its name before an older `--id6` copy of it", async () => {
  const fs = new MemoryWorkspaceFs();
  await fs.writeFile(".weaveforge/workspace.json", JSON.stringify({ id: "8d731734-bdcd", name: "MSc Thesis" }));
  await fs.writeFile("notes/a.md", "live");
  await fs.writeFile("msc-thesis--8d7317/notes/a.md", "old");
  const { repo, moves } = setup(fs);
  assert.deepEqual(await names(repo), ["MSc Thesis", "msc-thesis--8d7317"]);
  assert.equal(await fs.readText("MSc Thesis/notes/a.md"), "live");
  assert.equal(await fs.readText("msc-thesis--8d7317/notes/a.md"), "old");
  assert.deepEqual(moves, [["", "MSc Thesis"]]);
});

test("an assets folder alone is not a root project", async () => {
  const fs = new MemoryWorkspaceFs();
  await fs.writeFile("assets/x.png", "x");
  const { repo, moves } = setup(fs);
  assert.deepEqual(await names(repo), ["assets"]);
  assert.deepEqual(moves, []);
});

test("the standard subfolders match the Rust project layout", () => {
  const rust = readFileSync(
    fileURLToPath(new URL("../../../../../../../crates/wf-core/src/sync/folder_layout.rs", import.meta.url)),
    "utf8",
  );
  const block = rust.match(/ENTITY_DIRS[^=]*=\s*&?\[([\s\S]*?)\];/);
  assert.ok(block, "ENTITY_DIRS not found");
  const dirs = [...(block[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual([...PROJECT_FOLDERS].sort(), [...new Set(dirs)].sort());
});

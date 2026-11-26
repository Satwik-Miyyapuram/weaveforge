import { before, test } from "node:test";
import assert from "node:assert/strict";
import { NotFoundError, ProjectValidationError, type Project } from "@weaveforge/core";
import { MemoryWorkspaceFs } from "@core-test/memory-workspace-fs";
import { loadTestCore } from "@/lib/test/load-test-core";
import { FileProjectRepository } from "../file-project-repo";

before(loadTestCore);

/** Renames folders too, as the desktop disk does. */
class DiskFs extends MemoryWorkspaceFs {
  override async rename(from: string, to: string): Promise<void> {
    const inside = Object.keys(this.toRecord()).filter((path) => path.startsWith(`${from}/`));
    if (!inside.length) return super.rename(from, to);
    for (const path of inside) {
      const next = to + path.slice(from.length);
      await this.mkdirp(next.slice(0, next.lastIndexOf("/")));
      await super.rename(path, next);
    }
    await this.remove(from, { recursive: true });
  }
}

const HNVAE: Project = {
  id: "0fdf00eb-b151-4dd7-b74d-4944bc612b1f",
  name: "HNVAE",
  createdAt: "2026-01-02T00:00:00.000Z",
};
const TRIAL: Project = {
  id: "407c3746-13be-4230-bdfa-47c065d7c189",
  name: "Offline Trial (Windows)",
  createdAt: "2026-01-01T00:00:00.000Z",
};

function setup(fs: MemoryWorkspaceFs = new DiskFs()) {
  return { fs, repo: new FileProjectRepository(fs) };
}

const json = async (fs: MemoryWorkspaceFs, path: string) =>
  JSON.parse(await fs.readText(path)) as Record<string, unknown>;

async function put(fs: MemoryWorkspaceFs, path: string, data: unknown) {
  await fs.mkdirp(path.slice(0, path.lastIndexOf("/")));
  await fs.writeFile(path, typeof data === "string" ? data : JSON.stringify(data));
}

test("every project has its own folder, oldest first, none in the root", async () => {
  const { fs, repo } = setup();
  assert.equal(await repo.adopt(HNVAE), "hnvae--0fdf00");
  assert.equal(await repo.adopt(TRIAL), "offline-trial-windows--407c37");
  assert.deepEqual(await repo.list(), [TRIAL, HNVAE]);
  assert.deepEqual(await json(fs, "hnvae--0fdf00/.weaveforge/project.json"), { ...HNVAE });
  assert.equal(await fs.stat(".weaveforge/workspace.json"), null);
});

test("create, getById, list and folderOf agree", async () => {
  const { repo } = setup();
  const made = await repo.create({ name: "Thesis" });
  assert.deepEqual(await repo.getById(made.id), made);
  assert.deepEqual(await repo.list(), [made]);
  assert.equal(await repo.folderOf(made.id), `thesis--${made.id.replaceAll("-", "").slice(0, 6)}`);
});

test("an empty workspace has no projects", async () => {
  const { repo } = setup();
  assert.deepEqual(await repo.list(), []);
  assert.equal(await repo.getById("x"), null);
  assert.equal(await repo.folderOf("x"), null);
});

test("a folder without a project file is not a project", async () => {
  const { fs, repo } = setup();
  await put(fs, "old--e88ade/.weaveforge/manifest.json", {});
  await repo.adopt(HNVAE);
  assert.deepEqual(await repo.list(), [HNVAE]);
});

test("a project file that does not parse hides only its own project", async () => {
  const { fs, repo } = setup();
  await put(fs, "bad--aaaaaa/.weaveforge/project.json", "{ not json");
  await repo.adopt(HNVAE);
  assert.deepEqual(await repo.list(), [HNVAE]);
});

test("adopt reuses the folder the project had under an older name", async () => {
  const { fs, repo } = setup();
  await put(fs, "offline-trial--407c37/notes/a.note.md", "# a");
  assert.equal(await repo.adopt(TRIAL), "offline-trial--407c37");
  assert.equal(await repo.folderOf(TRIAL.id), "offline-trial--407c37");
});

test("adopt prefers the folder with the project's own name over a stale copy", async () => {
  const { fs, repo } = setup();
  await put(fs, "offline-trial--407c37/notes/a.note.md", "# a");
  await put(fs, "offline-trial-windows--407c37/notes/a.note.md", "# a");
  assert.equal(await repo.adopt(TRIAL), "offline-trial-windows--407c37");
});

test("folderFor finds the folder the project had under an older name and writes nothing", async () => {
  const { fs, repo } = setup();
  await put(fs, "offline-trial--407c37/notes/a.note.md", "# a");
  const before = fs.toRecord();
  assert.equal(await repo.folderFor(TRIAL), "offline-trial--407c37");
  assert.deepEqual(fs.toRecord(), before);
});

test("folderFor gives a new project its own slug--id6 folder", async () => {
  const { repo } = setup();
  assert.equal(await repo.folderFor(TRIAL), "offline-trial-windows--407c37");
});

test("adopt keeps a project that is already listed", async () => {
  const { repo } = setup();
  await repo.adopt(HNVAE);
  assert.equal(await repo.adopt({ ...HNVAE, name: "Other" }), "hnvae--0fdf00");
  assert.deepEqual(await repo.list(), [HNVAE]);
});

test("a copied folder with the same id is listed once, under its own name", async () => {
  const { fs, repo } = setup();
  await put(fs, "a-copy/.weaveforge/project.json", HNVAE);
  await put(fs, "hnvae--0fdf00/.weaveforge/project.json", HNVAE);
  await put(fs, "z-copy/.weaveforge/project.json", HNVAE);
  assert.deepEqual(await repo.list(), [HNVAE]);
  assert.equal(await repo.folderOf(HNVAE.id), "hnvae--0fdf00");
});

test("a rename moves the folder and keeps createdAt, other keys and files", async () => {
  const { fs, repo } = setup();
  await put(fs, "hnvae--0fdf00/.weaveforge/project.json", { ...HNVAE, layout: 2 });
  await put(fs, "hnvae--0fdf00/notes/a.note.md", "# a");
  await repo.save({ ...HNVAE, name: "Hierarchical", createdAt: "2030-01-01T00:00:00.000Z" });
  assert.equal(await repo.folderOf(HNVAE.id), "hierarchical--0fdf00");
  assert.deepEqual(await json(fs, "hierarchical--0fdf00/.weaveforge/project.json"), {
    ...HNVAE,
    name: "Hierarchical",
    layout: 2,
  });
  assert.equal(await fs.readText("hierarchical--0fdf00/notes/a.note.md"), "# a");
  assert.equal(await fs.stat("hnvae--0fdf00"), null);
});

test("a folder that cannot move keeps its name and still works", async () => {
  const { repo } = setup(new MemoryWorkspaceFs());
  await repo.adopt(HNVAE);
  await repo.save({ ...HNVAE, name: "Hierarchical" });
  assert.equal(await repo.folderOf(HNVAE.id), "hnvae--0fdf00");
  assert.equal((await repo.getById(HNVAE.id))?.name, "Hierarchical");
});

test("a rename never lands on a folder that is already there", async () => {
  const { fs, repo } = setup();
  await repo.adopt(HNVAE);
  await put(fs, "hierarchical--0fdf00/notes/mine.md", "mine");
  await repo.save({ ...HNVAE, name: "Hierarchical" });
  assert.equal(await repo.folderOf(HNVAE.id), "hnvae--0fdf00");
  assert.equal(await fs.readText("hierarchical--0fdf00/notes/mine.md"), "mine");
});

test("saving an unknown project is refused", async () => {
  const { repo } = setup();
  await assert.rejects(repo.save(HNVAE), NotFoundError);
});

test("delete unlists the project and keeps its files", async () => {
  const { fs, repo } = setup();
  await repo.adopt(HNVAE);
  await put(fs, "hnvae--0fdf00/notes/a.note.md", "# a");
  await repo.remove(HNVAE.id);
  assert.deepEqual(await repo.list(), []);
  assert.equal(await repo.folderOf(HNVAE.id), null);
  assert.equal(await fs.readText("hnvae--0fdf00/notes/a.note.md"), "# a");
  assert.deepEqual(await json(fs, "hnvae--0fdf00/.weaveforge/project.deleted.json"), { ...HNVAE });
});

test("a folder renamed outside the app is found again", async () => {
  const fs = new DiskFs();
  let at = 0;
  const repo = new FileProjectRepository(fs, () => at);
  await repo.adopt(HNVAE);
  await fs.rename("hnvae--0fdf00", "my-project");
  at += 60_000;
  assert.equal(await repo.folderOf(HNVAE.id), "my-project");
});

test("an early 0.9.7 project in the root stays listed there", async () => {
  const { fs, repo } = setup();
  await put(fs, ".weaveforge/workspace.json", { ...HNVAE, layout: 2 });
  assert.deepEqual(await repo.list(), [HNVAE]);
  assert.equal(await repo.folderOf(HNVAE.id), "");
  await repo.save({ ...HNVAE, name: "Renamed" });
  assert.deepEqual(await json(fs, ".weaveforge/workspace.json"), { ...HNVAE, name: "Renamed", layout: 2 });
  await repo.delete(HNVAE.id);
  assert.deepEqual(await repo.list(), []);
  assert.deepEqual(await json(fs, ".weaveforge/workspace.json"), { layout: 2 });
});

test("a blank name is refused", async () => {
  const { repo } = setup();
  await assert.rejects(repo.create({ name: "  " }), ProjectValidationError);
});

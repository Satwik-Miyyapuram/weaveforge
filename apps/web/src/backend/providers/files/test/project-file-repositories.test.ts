import { before, test } from "node:test";
import assert from "node:assert/strict";
import { MemoryWorkspaceFs } from "@core-test/memory-workspace-fs";
import type { Project } from "@weaveforge/core";
import type { SecretsStore } from "@/features/settings/infrastructure/parts";
import { typedCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";
import { wireProjectFileBackend } from "../project-file-repositories";
import { MemorySettings } from "./memory-settings";

before(loadTestCore);

const SECRETS: SecretsStore = { load: async () => ({}) as never, save: async () => {} };
const ONE: Project = { id: "11111111-0000-4000-8000-000000000000", name: "One", createdAt: "2026-01-01T00:00:00.000Z" };
const TWO: Project = { id: "22222222-0000-4000-8000-000000000000", name: "Two", createdAt: "2026-01-02T00:00:00.000Z" };

const paths = (fs: MemoryWorkspaceFs) => Object.keys(fs.toRecord());

async function putPaper(fs: MemoryWorkspaceFs, folder: string, id: string) {
  const path = `${folder ? `${folder}/` : ""}papers/${id}.paper.md`;
  await fs.mkdirp(path.slice(0, path.lastIndexOf("/")));
  await fs.writeFile(path, typedCore().writePaperRow(null, { id, title: id.toUpperCase() } as never) + "Body.\n");
  return path;
}

async function setup() {
  const fs = new MemoryWorkspaceFs();
  const active = { id: null as string | null };
  const repos = wireProjectFileBackend({ fs, settings: new MemorySettings(), secrets: SECRETS }, () => active.id);
  return { fs, active, repos };
}

async function two() {
  const made = await setup();
  const one = await made.repos.projectRepository.adopt(ONE);
  const other = await made.repos.projectRepository.adopt(TWO);
  await putPaper(made.fs, one, "a");
  await putPaper(made.fs, other, "b");
  return { ...made, one, other };
}

test("switching the project switches the rows", async () => {
  const { active, repos } = await two();
  active.id = ONE.id;
  assert.deepEqual((await repos.paperRepository.list()).map((p) => p.id), ["a"]);
  active.id = TWO.id;
  assert.deepEqual((await repos.paperRepository.list()).map((p) => p.id), ["b"]);
});

test("with no active project the oldest one is used", async () => {
  const { repos } = await two();
  assert.deepEqual((await repos.paperRepository.list()).map((p) => p.id), ["a"]);
});

test("a new row is written in the active project's folder", async () => {
  const { fs, active, repos, other } = await two();
  active.id = TWO.id;
  const outside = () => paths(fs).filter((p) => !p.startsWith(`${other}/`));
  const before = outside();
  await repos.libraryPinRepository.pin({ resourceType: "paper", resourceId: "b", ownerId: "me" } as never);
  assert.deepEqual(outside(), before);
  assert.deepEqual(await repos.paperRepository.listPinnedIds(), ["b"]);
  active.id = ONE.id;
  assert.deepEqual(await repos.paperRepository.listPinnedIds(), []);
});

test("a project created in the app holds its own rows", async () => {
  const { fs, active, repos } = await two();
  const made = await repos.projectRepository.create({ name: "Three" });
  active.id = made.id;
  assert.deepEqual(await repos.paperRepository.list(), []);
  await putPaper(fs, (await repos.projectRepository.folderOf(made.id))!, "c");
  assert.deepEqual((await repos.projectRepository.list()).map((p) => p.name), ["One", "Two", "Three"]);
});

test("each project has its own settings file", async () => {
  const { fs, active, repos, one, other } = await two();
  active.id = ONE.id;
  await repos.citationAlertTrackRepository.track({ paperId: "a" } as never);
  active.id = TWO.id;
  await repos.citationAlertTrackRepository.track({ paperId: "b" } as never);
  const read = async (folder: string) => Object.keys(JSON.parse(await fs.readText(`${folder}/.weaveforge/settings.json`)).citationAlerts);
  assert.deepEqual(await read(one), ["a"]);
  assert.deepEqual(await read(other), ["b"]);
});

test("a row of another project opens by id and is written back there", async () => {
  const { fs, active, repos, one, other } = await two();
  active.id = ONE.id;
  const b = await repos.paperRepository.getById("b");
  assert.equal(b?.title, "B");
  await repos.paperRepository.save({ ...b!, title: "B2" });
  assert.match(await fs.readText(`${other}/papers/b.paper.md`), /B2/);
  assert.ok(!paths(fs).some((p) => p.startsWith(`${one}/`) && p.includes("b.paper")));
  assert.equal(await repos.paperRepository.getById("none"), null);
});

test("a project at the workspace root works as before", async () => {
  const { fs, active, repos } = await setup();
  await fs.mkdirp(".weaveforge");
  await fs.writeFile(".weaveforge/workspace.json", JSON.stringify(ONE));
  await putPaper(fs, "", "a");
  for (const id of [null, ONE.id]) {
    active.id = id;
    assert.deepEqual((await repos.paperRepository.list()).map((p) => p.id), ["a"]);
  }
});

test("an id with no folder is refused, not written into another project", async () => {
  const { active, repos } = await two();
  active.id = "99999999-0000-4000-8000-000000000000";
  await assert.rejects(repos.paperRepository.list(), /not in the workspace/);
});

test("an annotation made on another project's paper is updated and removed there", async () => {
  // The reader opens a paper of another project, makes a mark, then joins the next stroke to it by the mark's id.
  const { fs, active, repos, other } = await two();
  active.id = ONE.id;
  assert.ok(await repos.paperRepository.getById("b"));
  const draft = { type: "ink", color: "#000000", text: "", anchor: { rects: [], locus: null }, pageIndex: 0 } as never;
  const made = await repos.readerAnnotationRepository.create("b", { ...(draft as object), id: "m1" } as never);
  await repos.readerAnnotationRepository.create("b", { ...(draft as object), id: "m2" } as never);
  const updated = await repos.readerAnnotationRepository.update(made.id, { comment: "joined" });
  assert.equal(updated.comment, "joined");
  await repos.readerAnnotationRepository.remove("m2");
  assert.deepEqual((await repos.readerAnnotationRepository.list("b")).map((a) => [a.id, a.comment]), [["m1", "joined"]]);
  assert.match(await fs.readText(`${other}/papers/b.annotations.json`), /joined/);
});

test("an annotation of another project's paper listed after a restart is still updated there", async () => {
  const { fs, active, repos, other } = await two();
  active.id = TWO.id;
  const draft = { type: "ink", color: "#000000", text: "", anchor: { rects: [], locus: null }, pageIndex: 0, id: "m1" } as never;
  await repos.readerAnnotationRepository.create("b", draft);
  // A fresh backend (the app restarted) with project One active: the reader opens paper b and lists its marks.
  const again = wireProjectFileBackend({ fs, settings: new MemorySettings(), secrets: SECRETS }, () => ONE.id);
  assert.ok(await again.paperRepository.getById("b"));
  assert.deepEqual((await again.readerAnnotationRepository.list("b")).map((a) => a.id), ["m1"]);
  await again.readerAnnotationRepository.update("m1", { comment: "after restart" });
  assert.match(await fs.readText(`${other}/papers/b.annotations.json`), /after restart/);
});

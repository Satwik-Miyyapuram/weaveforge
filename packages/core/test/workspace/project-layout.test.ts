import { rust } from "../../src/shared/rust.js";
import assert from "node:assert/strict";
import test from "node:test";


/**
 * The workspace layout, once it is scoped to a project.
 *
 * Every entity path is inside the project's folder, and the bookkeeping that
 * belongs to that project's mirror sits in a `.weaveforge/` beside its files.
 * The root of the folder keeps only the database and the shared asset tree.
 */
const THESIS = { id: "8d731734-bdcd-4f08-b648-efd15fdf75da", name: "MSc Thesis" };
const ROOT = "msc-thesis--8d7317";

test("a project's folder is a slug plus a short id, so names may repeat", () => {
  assert.equal(rust().projectDir(THESIS), ROOT);
  // Two projects with one name are still two folders.
  assert.notEqual(rust().projectDir({ id: "aaaaaaaa-1111-2222-3333-444444444444", name: "MSc Thesis" }), ROOT);
  // A name that slugs to nothing still lands somewhere.
  assert.match(rust().projectDir({ id: "b2c3d4e5-0000-0000-0000-000000000000", name: "???" }), /^project--b2c3d4$/);
});

test("every path an entity can have is inside its project", () => {
  const dir = rust().projectDir(THESIS);
  assert.equal(rust().flatPath("paper", "p1", "Attention Is All You Need", dir), `${ROOT}/papers/attention-is-all-you-need--p1.paper.md`);
  assert.equal(rust().flatPath("experiment", "e1", "ROME sweep", dir), `${ROOT}/experiments/rome-sweep--e1.experiment.md`);
  assert.equal(rust().flatPath("milestone", "m1", "Submit", dir), `${ROOT}/plan/submit--m1.milestone.md`);
  assert.equal(rust().logPath("l1", "2026-03-14", dir), `${ROOT}/logbook/2026/03/2026-03-14--l1.log.md`);
  assert.equal(rust().paperPdfPath("p1", dir), `${ROOT}/papers/pdf/p1.pdf`);
  assert.equal(rust().paperHtmlPath("p1", dir), `${ROOT}/papers/html/p1.html`);
  assert.equal(rust().treePaths([{ id: "s1", title: "Results" }], "report_section", dir).get("s1"), `${ROOT}/report/results.report.md`);
  assert.equal(rust().entityDir("vault_page", dir), `${ROOT}/notes`);
  assert.equal(rust().projectMetaDir(dir), `${ROOT}/.weaveforge`);
});

test("a project's own bookkeeping is beside its files, not at the root", () => {
  const dir = rust().projectDir(THESIS);
  // What the mirror wrote for this project, so a run for another project cannot
  // mistake these files for its own departed ones.
  assert.equal(`${rust().projectMetaDir(dir)}/mirror.json`, `${ROOT}/.weaveforge/mirror.json`);
  assert.equal(`${rust().projectMetaDir(dir)}/relations.json`, `${ROOT}/.weaveforge/relations.json`);
});

test("with no project the old paths are what they always were", () => {
  // Callers that resolve a path with no project in hand — an export of one
  // entity, a test, a folder written before this existed — keep the old shape.
  assert.equal(rust().flatPath("paper", "p1", "Attention"), "papers/attention--p1.paper.md");
  assert.equal(rust().logPath("l1", "2026-03-14"), "logbook/2026/03/2026-03-14--l1.log.md");
  assert.equal(rust().paperPdfPath("p1"), "papers/pdf/p1.pdf");
  assert.equal(rust().treePaths([{ id: "s1", title: "Results" }], "report_section").get("s1"), "report/results.report.md");
  assert.equal(rust().entityDir("vault_page"), "notes");
});

test("a hand-written file inside a project folder still imports", () => {
  const parsed = rust().parseWorkspaceFolder({ "msc-thesis--8d7317/notes/hand-written.md": "Typed into the folder." });

  assert.equal(parsed[0]!.type, "vault_page");
  assert.equal(parsed[0]!.title, "hand-written");
});

test("bookkeeping beside a project's files is never read as an entity", () => {
  assert.deepEqual(
    rust().parseWorkspaceFolder({
      "msc-thesis--8d7317/.weaveforge/notes.md": "See the notes.",
      ".weaveforge/notes.md": "And the root copy.",
      "msc-thesis--8d7317/README.md": "About this project.",
    }),
    [],
  );
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initSync } from "../src/index.js";
import { projectFromRow } from "../src/index.js";
import type { ProjectRow } from "../src/bindings.js";

const pkgDir = new URL("../pkg/", import.meta.url);
initSync({ module: readFileSync(new URL("wf_wasm_bg.wasm", pkgDir)) });

const base = { id: "p1", name: "Thesis", created_at: "2026-01-02T03:04:05Z" };

test("maps the row to the camelCase project with its colour", () => {
  assert.deepEqual(projectFromRow({ ...base, color: "#ff0000" } as ProjectRow), {
    id: "p1",
    name: "Thesis",
    color: "#ff0000",
    createdAt: "2026-01-02T03:04:05Z",
  });
});

test("a null colour is left out, so the project has no colour key", () => {
  const project = projectFromRow({ ...base, color: null } as ProjectRow);
  assert.equal("color" in project, false);
  assert.equal(project.createdAt, "2026-01-02T03:04:05Z");
});

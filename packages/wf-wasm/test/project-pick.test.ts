import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { pickProject } from "../src/index.js";
import { initSync } from "../src/index.js";

const pkgDir = new URL("../pkg/", import.meta.url);
initSync({ module: readFileSync(new URL("wf_wasm_bg.wasm", pkgDir)) });

test("pickProject returns the index of the one project it picks", () => {
  const projects = [
    { id: "p1", name: "Alpha", dir: "alpha--p1" },
    { name: "My  Thesis", dir: "projects/my-thesis" },
  ];
  assert.equal(pickProject(projects, "P1"), 0);
  assert.equal(pickProject(projects, "  my thesis "), 1);
  assert.throws(() => pickProject(projects, null), /No project matches ''/);
});

test("pickProject throws an Error that lists the projects on a miss", () => {
  assert.throws(() => pickProject([{ name: "Alpha", dir: "a" }], "zeta"), {
    name: "Error",
    message: "No project matches 'zeta'. Projects: Alpha.",
  });
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { preflightGates } from "../preflight-gates.mjs";

test("each check:boundaries step becomes its own gate", () => {
  const gates = preflightGates({ "check:boundaries": "npm run check:solid && npm run check:docs" });
  assert.deepEqual(
    gates.map((g) => g.name),
    ["lint", "typecheck", "check:solid", "check:docs", "cargo fmt"],
  );
});

test("a step that is not `npm run <script>` is skipped, not run as a gate", () => {
  const gates = preflightGates({ "check:boundaries": "npm run check:solid && node x.mjs" });
  assert.ok(!gates.some((g) => g.cmd.includes("x.mjs")));
});

test("the real package.json yields every boundary gate", () => {
  const pkg = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8"));
  const names = preflightGates(pkg.scripts).map((g) => g.name);
  for (const name of ["check:solid", "check:docs", "check:ci-parity"]) assert.ok(names.includes(name), name);
  for (const g of preflightGates(pkg.scripts).filter((g) => g.name.startsWith("check:"))) {
    assert.ok(pkg.scripts[g.name], `${g.name} exists`);
  }
});

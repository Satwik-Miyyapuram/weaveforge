/**
 * 0.9.8: the showcase demo button is hidden in no-account mode, because its
 * seeder still writes through the removed local database. It shows when signed in.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const source = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "ui", "projects-screen.tsx"),
  "utf8",
);

test("demo button is absent in no-account mode", () => {
  assert.doesNotMatch(source, /const demoButton = local \?/);
  assert.match(source, /const demoButton = !local \?/);
});

test("demo button is present when signed in", () => {
  assert.match(source, /const demoButton = !local \? \(\s*<Button/);
});

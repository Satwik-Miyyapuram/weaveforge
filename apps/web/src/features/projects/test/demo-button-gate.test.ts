/**
 * 0.9.8: the showcase demo button is hidden in both modes until the seeder
 * writes through the File* repositories (no local database).
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
  assert.match(source, /const demoButton = null;/);
  assert.doesNotMatch(source, /const demoButton = !local \?/);
});

test("hidden demo button renders no demo error", () => {
  assert.doesNotMatch(source, /\{demoError && /);
});

test("demo button is absent when signed in", () => {
  assert.doesNotMatch(source, /const demoButton = local \?/);
  assert.doesNotMatch(source, /const demoButton = \(?\s*<Button/);
});

/**
 * The demo seeder carries the whole showcase data set. ProjectsScreen sits in
 * the app shell, so a static import ships that data with every route and
 * breaks the bundle budget (WF-P07). The demo button was PGlite-only and is gone
 * in 0.9.7, so the screen must not reference the seeder at all.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const uiDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "ui");

test("projects screen never loads the demo seeder", () => {
  const source = readFileSync(path.join(uiDir, "projects-screen.tsx"), "utf8");
  assert.doesNotMatch(source, /features\/showcase/);
  assert.doesNotMatch(source, /load-local-demo/);
});

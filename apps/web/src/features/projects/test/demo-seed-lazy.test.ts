/**
 * The demo seeder carries the whole showcase data set. ProjectsScreen sits in
 * the app shell, so a static import ships that data with every route and
 * breaks the bundle budget (WF-P07). It must load only when the button is used.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const uiDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "ui");

test("projects screen has no demo loader and no static showcase import", () => {
  const source = readFileSync(path.join(uiDir, "projects-screen.tsx"), "utf8");
  assert.doesNotMatch(source, /^import[^;]*features\/showcase/m);
  assert.doesNotMatch(source, /load-local-demo|loadLocalDemoWorkspace|isLocalMode|Load demo workspace/);
});

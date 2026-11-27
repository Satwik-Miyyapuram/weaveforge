import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

// Files mode keeps the privacy accept and the project list in the workspace folder, so the
// remembered folder must be connected before startup reads them.

const repo = resolve(process.cwd(), "../..");
const read = (rel: string) => readFileSync(resolve(repo, rel), "utf8");

test("the remembered folder is restored above the startup reads", () => {
  const shell = read("apps/web/src/app/app-shell.tsx");
  const restore = shell.indexOf("<WorkspaceFolderRestore />");
  const startup = shell.indexOf("<StartupProvider");
  assert.ok(restore > -1 && startup > -1);
  assert.ok(restore < startup, "WorkspaceFolderRestore must mount before StartupProvider");
  assert.equal(shell.split("<WorkspaceFolderRestore />").length - 1, 1, "mounted once");
});

test("startup waits for the folder before reading settings", () => {
  const src = read("apps/web/src/features/startup/startup-provider.tsx");
  const wait = src.indexOf("await folderRestored()");
  const settings = src.indexOf("light.settings.getMetadata()");
  assert.ok(wait > -1, "startup must await folderRestored()");
  assert.ok(wait < settings, "await folderRestored() must come before the settings read");
});

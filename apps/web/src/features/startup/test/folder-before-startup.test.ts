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

test("the settings file loads above the startup reads", () => {
  const shell = read("apps/web/src/app/app-shell.tsx");
  const sync = shell.indexOf("<WorkspaceSettingsSync />");
  const startup = shell.indexOf("<StartupProvider");
  assert.ok(sync > -1 && sync < startup, "WorkspaceSettingsSync must mount before StartupProvider");
  assert.equal(shell.split("<WorkspaceSettingsSync />").length - 1, 1, "mounted once");
});

test("startup loads the settings file before reading it", () => {
  const src = read("apps/web/src/features/startup/startup-provider.tsx");
  const wait = src.indexOf("await folderRestored()");
  const load = src.indexOf("await workspaceSettings.load()");
  const settings = src.indexOf("light.settings.getMetadata()");
  assert.ok(load > -1, "startup must await workspaceSettings.load()");
  assert.ok(wait < load && load < settings, "folder, then settings load, then the settings read");
});

test("the project list waits for the folder", () => {
  const src = read("apps/web/src/features/projects/ui/project-provider.tsx");
  const wait = src.indexOf("await folderRestored()");
  const list = src.indexOf("listProjects()");
  assert.ok(wait > -1, "the project list must await folderRestored()");
  assert.ok(wait < list, "await folderRestored() must come before listProjects()");
});

test("0.9.8: the restore starts from a plain effect, not a lazy component", () => {
  // A `dynamic()` component's effect waits for React's Suspense reveal (~300 ms) and the startup reads wait for the folder.
  const shell = read("apps/web/src/app/app-shell.tsx");
  assert.doesNotMatch(shell, /const WorkspaceFolderRestore = dynamic\(/);
  assert.match(shell, /function WorkspaceFolderRestore\(\)[\s\S]*?useEffect\([\s\S]*?restoreRememberedFolder\(\)/);
  const restore = read("apps/web/src/features/workspace/ui/workspace-folder-restore.tsx");
  const bind = restore.indexOf("bindWorkspaceSettingsFolder(activeWorkspaceFs, folderRestored)");
  const connect = restore.indexOf("chooseDesktopFolder(");
  assert.ok(bind > -1 && bind < connect, "the settings reader is bound before the folder connects");
});

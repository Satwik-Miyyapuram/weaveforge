import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { firstRunQuestion } from "../application/workspace-setup";
import { CHANGE_FOLDER_NOTE, ChangeFolderAction } from "../ui/change-folder-action";
import { WorkspaceSetupView } from "../ui/workspace-setup-dialog";

test("the question is due only when the shell says so, and says where Skip goes", async () => {
  assert.equal(await firstRunQuestion(null), null);
  assert.equal(await firstRunQuestion({}), null);
  assert.deepEqual(
    await firstRunQuestion({
      workspaceSetup: async () => ({ needed: true, defaultFolder: "C:\\Users\\me\\Documents" }),
    }),
    { defaultFolder: "C:\\Users\\me\\Documents" },
  );
  assert.equal(
    await firstRunQuestion({ workspaceSetup: async () => ({ needed: false, defaultFolder: "x" }) }),
    null,
  );
});

test("a failed setup read asks nothing, so a broken shell never blocks the app", async () => {
  assert.equal(
    await firstRunQuestion({
      workspaceSetup: async () => {
        throw new Error("shell gone");
      },
    }),
    null,
  );
});

test("the question offers Choose folder and Skip, with Skip's folder named", () => {
  const html = renderToStaticMarkup(
    createElement(WorkspaceSetupView, {
      defaultFolder: "D:\\Docs",
      busy: false,
      error: null,
      onChoose: () => {},
      onSkip: () => {},
    }),
  );
  assert.match(html, /Choose folder…/);
  assert.match(html, />Skip</);
  assert.match(html, /Skip uses D:\\Docs/);
  assert.doesNotMatch(html, /role="alert"/);
});

test("without a Documents folder there is no Skip, and a failure is announced inline", () => {
  const html = renderToStaticMarkup(
    createElement(WorkspaceSetupView, {
      defaultFolder: null,
      busy: false,
      error: "That folder is inside the WeaveForge app folder. Pick a folder outside the app.",
      onChoose: () => {},
      onSkip: () => {},
    }),
  );
  assert.doesNotMatch(html, />Skip</);
  assert.match(html, /role="alert"/);
  assert.match(html, /inside the WeaveForge app folder/);
});

test("Change folder says what moves and what stays, with no extra confirm", () => {
  const html = renderToStaticMarkup(createElement(ChangeFolderAction, { onChanged: () => {} }));
  assert.equal(CHANGE_FOLDER_NOTE, "Moves where your files are mirrored; nothing is deleted.");
  assert.match(html, /Moves where your files are mirrored; nothing is deleted\./);
  assert.match(html, /Change folder…/);
});

test("the app shell mounts the first-open question beside the folder restore", () => {
  const shell = readFileSync(new URL("../../../app/app-shell.tsx", import.meta.url), "utf8");
  assert.match(shell, /<WorkspaceSetupDialog \/>/);
  assert.match(shell, /<WorkspaceFolderRestore \/>\s*\n\s*<WorkspaceSetupDialog \/>/);
});

test("Settings offers Change folder only on the desktop shell", () => {
  const panel = readFileSync(
    new URL("../../../features/settings/ui/workspace-folder-panel.tsx", import.meta.url),
    "utf8",
  );
  assert.match(panel, /\{hasShell && \(\s*\n\s*<ChangeFolderAction/);
});

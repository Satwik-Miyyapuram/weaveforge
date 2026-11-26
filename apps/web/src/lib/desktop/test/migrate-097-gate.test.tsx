import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { DesktopBridge } from "../desktop-bridge";
import { Migrate097Gate } from "../migrate-097-gate";
import { desktopRunExport } from "../desktop-run-export";
import { shouldShowFinishRemoving, shouldShowRetry, shouldShowUpgrade } from "../migrate-097-gate-decision";

const FOLDER = "C:\\Users\\me\\Documents\\WeaveForge";

test("every folder with old data not yet on files shows the upgrade screen", () => {
  assert.equal(shouldShowUpgrade("incomplete", FOLDER), true);
  assert.equal(shouldShowUpgrade("unexported", FOLDER), true, "a folder removed by another device must be exported here first");
  assert.equal(shouldShowUpgrade("none", FOLDER), true, "an old local database never exported must be exported to files");
  assert.equal(shouldShowUpgrade("verified", FOLDER), false, "a verified folder needs no screen");
  assert.equal(shouldShowUpgrade("unavailable", FOLDER), false, "an unanswered read shows nothing");
  assert.equal(shouldShowUpgrade("incomplete", null), false, "no folder, no upgrade");
});

test("a verified run whose desktop mark never landed shows the upgrade screen, not removal", async () => {
  const { migrate097Status } = await import("../migrate-097");
  const { canRemoveOld } = await import("../migrate-097-remove-old");
  const status = { state: "verified", deviceId: "d", ownRunVerified: true, exportedHere: false, backupPath: "C:/b.dump" } as const;
  const resolved = await migrate097Status({ migrate097Status: async () => status }, FOLDER);
  assert.equal(shouldShowUpgrade(resolved, FOLDER), true);
  assert.equal(canRemoveOld(status), false);
});

test("any state that leaves the window read-only or unknown shows a Retry banner", () => {
  for (const state of ["unavailable", "removing-other"] as const) {
    assert.equal(shouldShowRetry(state, FOLDER), true, `${state} must offer Retry`);
  }
  assert.equal(shouldShowRetry("incomplete", FOLDER), false, "incomplete shows the upgrade screen alone");
  for (const state of ["none", "verified", "removed", "removing", "unexported"] as const) {
    assert.equal(shouldShowRetry(state, FOLDER), false, `${state} needs no Retry`);
  }
  assert.equal(shouldShowRetry("unavailable", null), false, "no folder, nothing to retry");
});

test("only this device's own removal offers Finish removing", () => {
  assert.equal(shouldShowFinishRemoving("removing", FOLDER), true);
  for (const state of ["removing-other", "unavailable", "incomplete", "verified", "removed", "none"] as const) {
    assert.equal(shouldShowFinishRemoving(state, FOLDER), false, `${state} must not offer Finish removing`);
  }
  assert.equal(shouldShowFinishRemoving("removing", null), false, "no folder, nothing to finish");
});

test("outside the desktop shell the gate renders its children and no upgrade screen", () => {
  const html = renderToStaticMarkup(
    <Migrate097Gate>
      <p>workspace</p>
    </Migrate097Gate>,
  );
  assert.equal(html, "<p>workspace</p>");
});

test("inside the shell the desktop upgrade gets a real exporter, never null", async () => {
  const calls: string[] = [];
  const shell = {
    migrate097Read: async () => [],
    vaultRoot: async () => ({ path: "C:\\other", state: "existing" }),
    migrate097Backup: async () => {
      calls.push("backup");
      return { deviceId: "d", dumpPath: "x.dump" };
    },
  } as unknown as DesktopBridge;
  const runner = desktopRunExport(shell);
  assert.ok(runner, "the desktop exporter is wired");
  // The real runner checks the open folder first: a different one refuses before any backup.
  await assert.rejects(runner(FOLDER, () => {}), /open workspace is not the folder/);
  assert.deepEqual(calls, []);
  assert.equal(desktopRunExport(null), null, "outside the shell there is no desktop exporter");
});
import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { Migrate097UpgradeBody, runUpgrade, upgradeReportFolder } from "../migrate-097-upgrade";
import type { Migrate097Progress } from "../desktop-bridge";

const FOLDER = "C:\\Users\\me\\Documents\\WeaveForge";
const noop = () => {};

test("report folder is the migration folder inside the workspace, with the folder's separator", () => {
  assert.equal(
    upgradeReportFolder(FOLDER),
    "C:\\Users\\me\\Documents\\WeaveForge\\.weaveforge\\migration-0.9.7",
  );
  assert.equal(upgradeReportFolder("/home/me/ws/"), "/home/me/ws/.weaveforge/migration-0.9.7");
});

test("runUpgrade returns verified and forwards in-process progress when the exporter verifies", async () => {
  const seen: Migrate097Progress[] = [];
  const outcome = await runUpgrade(
    FOLDER,
    async (folder, onProgress) => {
      assert.equal(folder, FOLDER);
      onProgress({ kind: "notes", done: 1, total: 2 });
      onProgress({ kind: "notes", done: 2, total: 2 });
      return { state: "verified" };
    },
    (p) => seen.push(p),
  );
  assert.equal(outcome, "verified");
  assert.deepEqual(seen, [
    { kind: "notes", done: 1, total: 2 },
    { kind: "notes", done: 2, total: 2 },
  ]);
});

test("runUpgrade stops on an incomplete answer", async () => {
  const outcome = await runUpgrade(FOLDER, async () => ({ state: "incomplete" }), noop);
  assert.equal(outcome, "stopped");
});

test("runUpgrade stops when the exporter throws, so the file backend is never wired", async () => {
  const outcome = await runUpgrade(
    FOLDER,
    async () => {
      throw new Error("disk full");
    },
    noop,
  );
  assert.equal(outcome, "stopped");
});

test("runUpgrade stops when no exporter is injected", async () => {
  assert.equal(await runUpgrade(FOLDER, null, noop), "stopped");
});

test("running view shows per-kind progress and no retry or keep-old controls", () => {
  const html = renderToStaticMarkup(
    <Migrate097UpgradeBody
      phase="running"
      progress={{ notes: { done: 2, total: 5 } }}
      reportFolder={upgradeReportFolder(FOLDER)}
      copied={false}
      onCopy={noop}
      onRetry={noop}
      onKeepOld={noop}
    />,
  );
  assert.match(html, /notes: 2 of 5/);
  assert.doesNotMatch(html, /Retry/);
  assert.doesNotMatch(html, /Keep using old data/);
});

test("stopped view offers Retry, Keep using old data and a selectable report path", () => {
  const html = renderToStaticMarkup(
    <Migrate097UpgradeBody
      phase="stopped"
      progress={{}}
      reportFolder={upgradeReportFolder(FOLDER)}
      copied={false}
      onCopy={noop}
      onRetry={noop}
      onKeepOld={noop}
    />,
  );
  assert.match(html, /Retry/);
  assert.match(html, /Keep using old data/);
  assert.match(html, /Copy report folder/);
  assert.match(html, /user-select:text/);
  assert.match(html, /migration-0\.9\.7/);
});

test("stopped view lists the kinds the shell could not move", () => {
  const html = renderToStaticMarkup(
    <Migrate097UpgradeBody
      phase="stopped"
      progress={{}}
      reportFolder={upgradeReportFolder(FOLDER)}
      missing={["notes", "papers"]}
      copied={false}
      onCopy={noop}
      onRetry={noop}
      onKeepOld={noop}
    />,
  );
  assert.match(html, /Not moved yet: notes, papers/);
});

test("stopped view without missing kinds shows no missing line", () => {
  const html = renderToStaticMarkup(
    <Migrate097UpgradeBody
      phase="stopped"
      progress={{}}
      reportFolder={upgradeReportFolder(FOLDER)}
      copied={false}
      onCopy={noop}
      onRetry={noop}
      onKeepOld={noop}
    />,
  );
  assert.doesNotMatch(html, /Not moved yet/);
});

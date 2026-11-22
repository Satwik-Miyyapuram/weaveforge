import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { Migrate097UpgradeBody, runUpgrade, upgradeReportFolder } from "../migrate-097-upgrade";
import type { Migrate097Progress } from "../desktop-bridge";
import { InstallIdLocksUnavailableError } from "@/container/browser-install-id";

// The component file uses JSX without importing React; under node --test the transform is classic, so expose React first.
Object.assign(globalThis, { React });

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

test("web stopped view names the reconnect providers and the undecryptable count", () => {
  const html = renderToStaticMarkup(
    <Migrate097UpgradeBody
      phase="stopped"
      progress={{}}
      reportFolder={upgradeReportFolder(FOLDER)}
      copied={false}
      onCopy={noop}
      onRetry={noop}
      onKeepOld={noop}
      reconnectProviders={["zotero"]}
      undecryptable={4}
    />,
  );
  assert.match(html, /Reconnect zotero/);
  assert.match(html, /open the desktop app to export these 4 items/i);
  assert.doesNotMatch(html, /Report:/, "no report path is shown on the web");
  assert.doesNotMatch(html, /Copy report path/);
});

test("web stopped view says to sync pending changes first when the outbox is not empty", () => {
  const html = renderToStaticMarkup(
    <Migrate097UpgradeBody
      phase="stopped"
      progress={{}}
      reportFolder={upgradeReportFolder(FOLDER)}
      copied={false}
      onCopy={noop}
      onRetry={noop}
      onKeepOld={noop}
      pendingSync
    />,
  );
  assert.match(html, /sync pending changes first/i);
});

test("web Start runs the web export once and reports verified with its reconnect names", async () => {
  let calls = 0;
  let reply: { reconnectProviders?: string[] } | null = null;
  const runExport = async () => {
    calls += 1;
    return { state: "verified" as const, reconnectProviders: ["zotero"] };
  };
  const outcome = await runUpgrade(FOLDER, runExport, noop, (r) => {
    reply = r;
  });
  assert.equal(outcome, "verified");
  assert.equal(calls, 1, "one Start calls the export once");
  assert.deepEqual(reply, { state: "verified", reconnectProviders: ["zotero"] });
});

test("web idle view offers Start and shows no progress or retry until Start is pressed", () => {
  const html = renderToStaticMarkup(
    <Migrate097UpgradeBody
      phase="idle"
      progress={{}}
      reportFolder={upgradeReportFolder(FOLDER)}
      copied={false}
      onCopy={noop}
      onRetry={noop}
      onKeepOld={noop}
      onStart={noop}
    />,
  );
  assert.match(html, />Start</);
  assert.doesNotMatch(html, /Starting/);
  assert.doesNotMatch(html, /Retry/);
});

test("web verified view names the reconnect providers and offers Continue before the reload", () => {
  const html = renderToStaticMarkup(
    <Migrate097UpgradeBody
      phase="verified"
      progress={{}}
      reportFolder={upgradeReportFolder(FOLDER)}
      copied={false}
      onCopy={noop}
      onRetry={noop}
      onKeepOld={noop}
      onContinue={noop}
      reconnectProviders={["zotero"]}
    />,
  );
  assert.match(html, /Reconnect zotero/);
  assert.match(html, />Continue</);
  assert.doesNotMatch(html, /Retry/);
});

test("runUpgrade hands the error to onError and stops, so the screen can name a WebView lock failure", async () => {
  const errors: unknown[] = [];
  const outcome = await runUpgrade(
    FOLDER,
    async () => {
      throw new InstallIdLocksUnavailableError();
    },
    noop,
    undefined,
    (err) => errors.push(err),
  );
  assert.equal(outcome, "stopped");
  assert.equal(errors.length, 1);
  assert.ok(errors[0] instanceof InstallIdLocksUnavailableError);
});
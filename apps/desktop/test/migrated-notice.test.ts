import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { migratedNotice, showMigratedNotice } from "../src/migrated-notice";

const root = mkdtempSync(path.join(tmpdir(), "wf-notice-"));
process.on("exit", () => rmSync(root, { recursive: true, force: true }));

function freshDir(name: string): string {
  const dir = path.join(root, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

test("no marker: no notice, and the dialog is never shown", async () => {
  const dir = freshDir("none");
  assert.equal(migratedNotice(dir), null);
  let calls = 0;
  const shown = await showMigratedNotice(dir, async () => {
    calls += 1;
  });
  assert.equal(shown, false);
  assert.equal(calls, 0);
});

test("a marker with a valid date: the notice carries the date and is shown as a warning", async () => {
  const dir = freshDir("dated");
  writeFileSync(
    path.join(dir, "migrated"),
    JSON.stringify({ to: "/new", at: "2026-10-30T08:00:00.000Z" }),
  );
  const notice = migratedNotice(dir);
  assert.ok(notice?.includes(" on 2026-10-30."));

  const seen: unknown[] = [];
  const shown = await showMigratedNotice(dir, async (options) => {
    seen.push(options);
  });
  assert.equal(shown, true);
  assert.deepEqual(seen, [
    { type: "warning", message: "WeaveForge has moved to a new app", detail: notice },
  ]);
});

test("a marker that is not JSON is still a notice, without a date", () => {
  const dir = freshDir("garbage");
  writeFileSync(path.join(dir, "migrated"), "not json");
  const notice = migratedNotice(dir);
  assert.ok(notice?.includes("new WeaveForge app."));
  assert.ok(!notice?.includes(" on "));
});

test("a marker that is a directory is still a notice, not nothing", () => {
  const dir = freshDir("dir-marker");
  mkdirSync(path.join(dir, "migrated"));
  assert.notEqual(migratedNotice(dir), null);
});

test("a dialog that rejects is swallowed: still resolves true", async () => {
  const dir = freshDir("rejects");
  writeFileSync(path.join(dir, "migrated"), "{}");
  const shown = await showMigratedNotice(dir, async () => {
    throw new Error("no display");
  });
  assert.equal(shown, true);
});

test("a second instance (not primary) with a marker: resolves false and the dialog is never shown", async () => {
  const dir = freshDir("second-instance");
  writeFileSync(path.join(dir, "migrated"), "{}");
  let calls = 0;
  const shown = await showMigratedNotice(
    dir,
    async () => {
      calls += 1;
    },
    () => false,
  );
  assert.equal(shown, false);
  assert.equal(calls, 0);
});

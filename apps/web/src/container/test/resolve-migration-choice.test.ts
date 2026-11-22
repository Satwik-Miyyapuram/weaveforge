import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveMigrationChoice, type MigrationChoiceBridge } from "../resolve-migration-choice";

const folder = { path: "C:\\Notes" };

function bridge(status: () => Promise<{ state: unknown }>, root: () => Promise<{ path: string } | null> = async () => folder): MigrationChoiceBridge {
  return { migrate097Status: status, vaultRoot: root };
}

test("a verified report resolves to verified", async () => {
  const b = bridge(async () => ({ state: "verified" }));
  assert.equal(await resolveMigrationChoice(b), "verified");
});

test("incomplete and none resolve to their own state", async () => {
  assert.equal(await resolveMigrationChoice(bridge(async () => ({ state: "incomplete" }))), "incomplete");
  assert.equal(await resolveMigrationChoice(bridge(async () => ({ state: "none" }))), "none");
});

test("an unknown shell state reads as none, never verified", async () => {
  assert.equal(await resolveMigrationChoice(bridge(async () => ({ state: "verified-ish" }))), "none");
});

test("no bridge resolves to unavailable", async () => {
  assert.equal(await resolveMigrationChoice(null), "unavailable");
  assert.equal(await resolveMigrationChoice(undefined), "unavailable");
});

test("no folder open resolves to unavailable and never asks the shell", async () => {
  let asked = false;
  const b = bridge(async () => { asked = true; return { state: "verified" }; }, async () => null);
  assert.equal(await resolveMigrationChoice(b), "unavailable");
  assert.equal(asked, false);
});

test("a throwing status or folder read resolves to unavailable", async () => {
  assert.equal(await resolveMigrationChoice(bridge(async () => { throw new Error("gone"); })), "unavailable");
  assert.equal(await resolveMigrationChoice(bridge(async () => ({ state: "verified" }), async () => { throw new Error("x"); })), "unavailable");
});

test("a status that never answers times out to unavailable", async () => {
  const b = bridge(() => new Promise(() => {}));
  const started = Date.now();
  assert.equal(await resolveMigrationChoice(b, 20), "unavailable");
  assert.ok(Date.now() - started < 2_000);
});

test("createAppContainer awaits the migration choice before wireBackend", async () => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const src = readFileSync(fileURLToPath(new URL("../../create-app-container.ts", import.meta.url)), "utf8");
  const awaited = src.indexOf("await resolveMigrationChoice(");
  const wired = src.indexOf("wireBackend(readBackendConfig()");
  assert.ok(awaited > 0 && wired > awaited, "the await must come before wireBackend");
});

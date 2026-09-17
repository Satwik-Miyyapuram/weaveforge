import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { homeConfigPath, readHomeConfig, writeHomeConfig } from "../src/home-config";

/** The pointer under the home directory: written, read back, and shrugged at when missing or wrong. */

function home(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "wf-home-"));
}

test("home-config: round-trips the workspace folder", async () => {
  const dir = home();
  await writeHomeConfig(dir, { vaultRoot: "D:/notes" });
  assert.equal(homeConfigPath(dir), path.join(dir, ".weaveforge", "desktop.json"));
  assert.deepEqual(await readHomeConfig(dir), { vaultRoot: "D:/notes" });
  assert.deepEqual(fs.readdirSync(path.join(dir, ".weaveforge")), ["desktop.json"], "no draft left");
});

test("home-config: forgetting writes null, and null reads as none", async () => {
  const dir = home();
  await writeHomeConfig(dir, { vaultRoot: "D:/notes" });
  await writeHomeConfig(dir, { vaultRoot: null });
  assert.deepEqual(await readHomeConfig(dir), { vaultRoot: null });
});

test("home-config: a missing or broken file is an empty config", async () => {
  const dir = home();
  assert.deepEqual(await readHomeConfig(dir), { vaultRoot: null });
  fs.mkdirSync(path.join(dir, ".weaveforge"));
  fs.writeFileSync(homeConfigPath(dir), "{not json");
  assert.deepEqual(await readHomeConfig(dir), { vaultRoot: null });
  fs.writeFileSync(homeConfigPath(dir), JSON.stringify({ vaultRoot: 42 }));
  assert.deepEqual(await readHomeConfig(dir), { vaultRoot: null });
});

test("home-config: a home that cannot be written is not an error", async () => {
  const file = path.join(home(), "file");
  fs.writeFileSync(file, "");
  await assert.doesNotReject(() => writeHomeConfig(path.join(file, "x"), { vaultRoot: "D:/n" }));
});

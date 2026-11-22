/**
 * The personal-settings writes are refused in a desktop folder whose state is
 * read-only (not wired to files, not "none"). Files-mode states write to files
 * and allow them. Account rows (acceptDisclaimer, ensureProvisioned) are never
 * guarded: they are server rows, not exported data.
 */
import { before, test } from "node:test";
import assert from "node:assert/strict";

import { guardPersonalSettings, guardWrites, personalWritesBlocked, PERSONAL_SETTINGS_WRITES } from "../light-write-guard";
import { loadTestCore } from "@/lib/test/load-test-core";

before(loadTestCore);

class FakeSettings {
  #accepted = 0;
  writes = 0;
  async acceptDisclaimer(): Promise<string> {
    this.writes++;
    this.#accepted++;
    return "ok";
  }
  async save(): Promise<string> {
    this.writes++;
    return "saved";
  }
  async saveDisclaimer(): Promise<string> {
    this.writes++;
    return "saved";
  }
  async saveAppearance(): Promise<string> {
    this.writes++;
    return "saved";
  }
  async saveNoticeSeen(): Promise<string> {
    this.writes++;
    return "saved";
  }
  // Reads a private field, so it only works when called on the real instance.
  async accepted(): Promise<number> {
    return this.#accepted;
  }
}

test("a blocked write rejects and never reaches the repository", async () => {
  const repo = new FakeSettings();
  const guarded = guardWrites(repo, ["acceptDisclaimer"], async () => true);
  await assert.rejects(() => guarded.acceptDisclaimer(), /read-only until export verified/);
  assert.equal(repo.writes, 0);
});

test("an allowed write passes through and returns the repository's value", async () => {
  const repo = new FakeSettings();
  const guarded = guardWrites(repo, ["acceptDisclaimer"], async () => false);
  assert.equal(await guarded.acceptDisclaimer(), "ok");
  assert.equal(repo.writes, 1);
});

test("reads are never blocked and keep the repository as receiver", async () => {
  const repo = new FakeSettings();
  const guarded = guardWrites(repo, ["acceptDisclaimer"], async () => true);
  assert.equal(await guarded.accepted(), 0);
});

test("the block is checked at call time, not when the guard is built", async () => {
  const repo = new FakeSettings();
  let blocked = false;
  const guarded = guardWrites(repo, ["acceptDisclaimer"], async () => blocked);
  blocked = true;
  await assert.rejects(() => guarded.acceptDisclaimer());
  assert.equal(repo.writes, 0);
});

// --- personalWritesBlocked: read-only states block, files-mode states allow ---

const g = globalThis as Record<string, unknown>;

function withShell(weaveforge: Record<string, unknown> | undefined, run: () => Promise<void>) {
  return async () => {
    const saved = g.window;
    g.window = weaveforge === undefined ? {} : { weaveforge: { fetchTitle() {}, ...weaveforge } };
    try {
      await run();
    } finally {
      g.window = saved;
    }
  };
}

const FOLDER = { vaultRoot: async () => ({ path: "C:/Users/me/Documents/WeaveForge" }) };
const READ_ONLY_STATES = ["incomplete", "unexported", "unavailable", "removing-other"];
const FILES_STATES = ["verified", "removing", "removed"];
// A device that verified its own export: read() wires files only for this shape.
const OWN_VERIFIED = { ownRunVerified: true, deviceId: "d1", removingDeviceId: "d1" };

test("outside the desktop shell writes are not blocked", withShell(undefined, async () => {
  assert.equal(await personalWritesBlocked(), false);
}));

test("a desktop folder with no migration keeps writes on", withShell({
  ...FOLDER,
  migrate097Status: async () => ({ state: "none" }),
}, async () => {
  assert.equal(await personalWritesBlocked(), false);
}));

for (const state of FILES_STATES) {
  test(`a desktop folder in files-mode state ${state} allows writes`, withShell({
    ...FOLDER,
    migrate097Status: async () => ({ state, ...OWN_VERIFIED }),
  }, async () => {
    assert.equal(await personalWritesBlocked(), false);
  }));
}

for (const state of READ_ONLY_STATES) {
  test(`a desktop folder in read-only state ${state} blocks writes`, withShell({
    ...FOLDER,
    migrate097Status: async () => ({ state }),
  }, async () => {
    assert.equal(await personalWritesBlocked(), true);
  }));
}

test("a shell that cannot name its folder fails closed", withShell({
  vaultRoot: async () => { throw new Error("no folder"); },
  migrate097Status: async () => ({ state: "none" }),
}, async () => {
  assert.equal(await personalWritesBlocked(), true);
}));

// --- guardPersonalSettings: which settings writes the guard covers ---

test("the guarded settings list is the personal writes only, never account rows", () => {
  assert.deepEqual([...PERSONAL_SETTINGS_WRITES].sort(), ["save", "saveAppearance", "saveDisclaimer", "saveNoticeSeen"]);
  assert.equal((PERSONAL_SETTINGS_WRITES as readonly string[]).includes("acceptDisclaimer"), false);
});

test("in a files-mode folder the settings writes it can hold go through", withShell({
  ...FOLDER,
  migrate097Status: async () => ({ state: "verified", ...OWN_VERIFIED }),
}, async () => {
  const repo = new FakeSettings();
  const guarded = guardPersonalSettings(repo);
  await guarded.saveAppearance();
  await guarded.saveNoticeSeen();
  await guarded.save();
  await guarded.saveDisclaimer();
  assert.equal(repo.writes, 4);
}));

test("a new account gets past the disclaimer in a verified folder", withShell({
  ...FOLDER,
  migrate097Status: async () => ({ state: "verified", ...OWN_VERIFIED }),
}, async () => {
  const repo = new FakeSettings();
  assert.equal(await guardPersonalSettings(repo).acceptDisclaimer(), "ok");
  assert.equal(repo.writes, 1);
}));

test("a new account gets past the disclaimer in an unexported folder", withShell({
  ...FOLDER,
  migrate097Status: async () => ({ state: "unexported" }),
}, async () => {
  const repo = new FakeSettings();
  assert.equal(await guardPersonalSettings(repo).acceptDisclaimer(), "ok");
  assert.equal(repo.writes, 1);
}));

for (const state of READ_ONLY_STATES) {
  test(`settings writes are refused in read-only state ${state}`, withShell({
    ...FOLDER,
    migrate097Status: async () => ({ state }),
  }, async () => {
    const repo = new FakeSettings();
    const guarded = guardPersonalSettings(repo);
    await assert.rejects(() => guarded.saveAppearance(), /read-only until export verified/);
    await assert.rejects(() => guarded.saveNoticeSeen(), /read-only until export verified/);
    assert.equal(repo.writes, 0);
  }));
}

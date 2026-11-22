/**
 * The pre-disclaimer backend writes settings and provisions identity. In a
 * desktop folder that has not finished its move to files, those writes must
 * be refused before they reach the repository, while reads still work.
 */
import { before, test } from "node:test";
import assert from "node:assert/strict";

import { guardWrites, personalWritesBlocked } from "../light-write-guard";
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

// --- personalWritesBlocked: the same rule as chooseFileBackend's read-only branch ---

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

test("outside the desktop shell writes are not blocked", withShell(undefined, async () => {
  assert.equal(await personalWritesBlocked(), false);
}));

test("a desktop folder with no migration keeps writes on", withShell({
  vaultRoot: async () => ({ path: "C:/Users/me/Documents/WeaveForge" }),
  migrate097Status: async () => ({ state: "none" }),
}, async () => {
  assert.equal(await personalWritesBlocked(), false);
}));

for (const state of ["incomplete", "verified", "removing", "removed", "unexported", "unavailable"]) {
  test(`a desktop folder in state ${state} blocks writes`, withShell({
    vaultRoot: async () => ({ path: "C:/Users/me/Documents/WeaveForge" }),
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

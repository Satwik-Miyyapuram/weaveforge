import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  tierFromOldFlags,
  upgradeTier,
  type OldAccount,
  type UpgradeTierDeps,
} from "../application/upgrade-tier";

function fakeDeps(flag: string | null, account: OldAccount | null, failWrite = false) {
  const state = {
    flag,
    done: false,
    writes: [] as { tier: string; account: string | null }[],
    moved: 0,
  };
  const deps: UpgradeTierDeps = {
    done: () => state.done,
    markDone: () => void (state.done = true),
    localModeFlag: () => state.flag,
    removeLocalModeFlag: () => void (state.flag = null),
    oldAccount: () => account,
    setTier: async (tier, acc) => {
      if (failWrite) throw new Error("no folder open");
      state.writes.push({ tier, account: acc });
    },
    moveSession: async () => void state.moved++,
  };
  return { deps, state };
}

describe("tierFromOldFlags", () => {
  it("maps the local-mode flag to local", () => {
    assert.deepEqual(tierFromOldFlags("1", { id: "u1" }), { tier: "local", freshInstall: false });
  });
  it("maps an old account to sharing", () => {
    assert.deepEqual(tierFromOldFlags(null, { id: null }), { tier: "sharing", freshInstall: false });
  });
  it("maps neither to local on a fresh install", () => {
    assert.deepEqual(tierFromOldFlags(null, null), { tier: "local", freshInstall: true });
  });
  it("ignores a flag that is not exactly 1", () => {
    assert.equal(tierFromOldFlags("0", null).tier, "local");
    assert.equal(tierFromOldFlags("0", { id: "u1" }).tier, "sharing");
  });
});

describe("upgradeTier", () => {
  it("writes local and removes the flag", async () => {
    const { deps, state } = fakeDeps("1", null);
    assert.deepEqual(await upgradeTier(deps), { ran: true, tier: "local", freshInstall: false });
    assert.deepEqual(state.writes, [{ tier: "local", account: null }]);
    assert.equal(state.flag, null);
    assert.equal(state.moved, 0);
  });

  it("writes sharing with the account and moves the session", async () => {
    const { deps, state } = fakeDeps(null, { id: "u1" });
    const outcome = await upgradeTier(deps);
    assert.deepEqual(outcome, { ran: true, tier: "sharing", freshInstall: false });
    assert.deepEqual(state.writes, [{ tier: "sharing", account: "u1" }]);
    assert.equal(state.moved, 1);
  });

  it("reports a fresh install so the first start can offer a git remote", async () => {
    const { deps } = fakeDeps(null, null);
    assert.deepEqual(await upgradeTier(deps), { ran: true, tier: "local", freshInstall: true });
  });

  it("does nothing on a second run", async () => {
    const { deps, state } = fakeDeps(null, { id: "u1" });
    await upgradeTier(deps);
    assert.deepEqual(await upgradeTier(deps), { ran: false });
    assert.equal(state.writes.length, 1);
    assert.equal(state.moved, 1);
  });

  it("keeps the flag and retries next start when the write fails", async () => {
    const { deps, state } = fakeDeps("1", null, true);
    await assert.rejects(upgradeTier(deps), /no folder open/);
    assert.equal(state.flag, "1");
    assert.equal(state.done, false);
  });
});

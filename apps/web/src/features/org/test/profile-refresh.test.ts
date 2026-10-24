/**
 * Profile refresh (B65).
 *
 * - 32-27: a failed standalone sync is logged, and the first read still shows.
 * - 32-28: a slow earlier refresh does not overwrite a later one.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { Member, OrgMembershipView } from "@weaveforge/core";

import { latestGate, loadProfileBundle, type ProfileSources } from "../application/profile-refresh";

type Log = { level: string; source: string; message: string; detail?: string };

const me = { id: "u1", email: "u@x", role: "phd", orgSetupComplete: true, activeOrgId: "o1" } as Member;

function sources(over: Partial<ProfileSources> = {}): ProfileSources & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    org: {
      loadProfile: async () => me,
      loadTeam: async () => [me],
      loadLab: async () => [me],
    },
    fetchMemberships: async () => [] as OrgMembershipView[],
    continueStandalone: async () => void calls.push("standalone"),
    invalidateCaches: () => void calls.push("invalidate"),
    ...over,
  };
}

async function withLogs(run: () => Promise<void>): Promise<Log[]> {
  const logs: Log[] = [];
  const g = globalThis as { window?: unknown };
  const original = g.window;
  g.window = { weaveforge: { fetchTitle: () => Promise.resolve({}), reportAppLog: (e: Log) => void logs.push(e) } };
  try {
    await run();
  } finally {
    g.window = original;
  }
  return logs;
}

test("a failed standalone sync is logged and the first read kept (32-27)", async () => {
  let bundle: Awaited<ReturnType<typeof loadProfileBundle>> | undefined;
  const logs = await withLogs(async () => {
    bundle = await loadProfileBundle(sources({ continueStandalone: () => Promise.reject(new Error("rpc gone")) }));
  });
  assert.equal(bundle!.profile, me);
  assert.deepEqual(bundle!.memberships, []);
  assert.equal(logs.length, 1);
  assert.equal(logs[0]!.source, "profile");
  assert.match(logs[0]!.detail ?? "", /rpc gone/);
});

test("a failed memberships read answers null and runs no standalone sync", async () => {
  const src = sources({ fetchMemberships: () => Promise.reject(new Error("503")) });
  let bundle: Awaited<ReturnType<typeof loadProfileBundle>> | undefined;
  await withLogs(async () => {
    bundle = await loadProfileBundle(src);
  });
  assert.equal(bundle!.memberships, null);
  assert.ok(!src.calls.includes("standalone"));
});

test("a failed profile read rejects, so the caller keeps what it showed", async () => {
  await assert.rejects(
    loadProfileBundle(sources({ org: { loadProfile: () => Promise.reject(new Error("down")), loadTeam: async () => [], loadLab: async () => [] } })),
    /down/,
  );
});

test("a slow earlier refresh is ignored (32-28)", async () => {
  const gate = latestGate();
  const shown: string[] = [];
  let releaseFirst!: () => void;
  const first = (async () => {
    const isLatest = gate.begin();
    await new Promise<void>((r) => (releaseFirst = r));
    if (isLatest()) shown.push("first");
  })();
  const second = (async () => {
    const isLatest = gate.begin();
    await Promise.resolve();
    if (isLatest()) shown.push("second");
  })();
  await second;
  releaseFirst();
  await first;
  assert.deepEqual(shown, ["second"]);
});

test("a lone refresh is the latest", () => {
  const gate = latestGate();
  const isLatest = gate.begin();
  assert.equal(isLatest(), true);
  gate.begin();
  assert.equal(isLatest(), false);
});

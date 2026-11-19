/**
 * The web app's GitHub token (D-1a): an 8-hour access token held in memory
 * only, refreshed through the server before it runs out, and refreshed once
 * more when GitHub answers 401 in the middle of a push.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import fc from "fast-check";

import { createGithubToken, GithubRevokedError, type GithubTokenGrant } from "../infrastructure/github-token-memory";

const HOUR = 60 * 60_000;

function harness(grants: Array<GithubTokenGrant | Error>) {
  let clock = 0;
  let refreshes = 0;
  let reconnects = 0;
  const source = createGithubToken({
    refresh: async () => {
      const next = grants[Math.min(refreshes, grants.length - 1)]!;
      refreshes++;
      if (next instanceof Error) throw next;
      return next;
    },
    now: () => clock,
    onReconnect: () => reconnects++,
  });
  return {
    source,
    advance: (ms: number) => (clock += ms),
    refreshes: () => refreshes,
    reconnects: () => reconnects,
  };
}

test("the first ask fetches a token; later asks reuse it", async () => {
  const h = harness([{ token: "t1", expiresAt: 8 * HOUR }]);
  assert.equal(await h.source.token(), "t1");
  h.advance(HOUR);
  assert.equal(await h.source.token(), "t1");
  assert.equal(h.refreshes(), 1);
});

test("asks that land together share one refresh", async () => {
  const h = harness([{ token: "t1", expiresAt: 8 * HOUR }]);
  const tokens = await Promise.all([h.source.token(), h.source.token(), h.source.token()]);
  assert.deepEqual(tokens, ["t1", "t1", "t1"]);
  assert.equal(h.refreshes(), 1);
});

test("a token close to running out is refreshed before use", async () => {
  const h = harness([
    { token: "t1", expiresAt: 8 * HOUR },
    { token: "t2", expiresAt: 16 * HOUR },
  ]);
  await h.source.token();
  h.advance(8 * HOUR - 60_000);
  assert.equal(await h.source.token(), "t2");
});

test("token_expires_mid_push: a 401 refreshes once and retries with the new token", async () => {
  const h = harness([
    { token: "t1", expiresAt: 8 * HOUR },
    { token: "t2", expiresAt: 16 * HOUR },
  ]);
  const seen: string[] = [];
  const response = await h.source.withToken(async (token) => {
    seen.push(token);
    return { status: token === "t1" ? 401 : 201 };
  });
  assert.equal(response.status, 201);
  assert.deepEqual(seen, ["t1", "t2"]);
});

test("a second 401 is handed back, not retried forever", async () => {
  const h = harness([{ token: "t1", expiresAt: 8 * HOUR }]);
  let calls = 0;
  const response = await h.source.withToken(async () => {
    calls++;
    return { status: 401 };
  });
  assert.equal(response.status, 401);
  assert.equal(calls, 2);
});

test("refresh_revoked: the reconnect prompt shows once, and every ask fails", async () => {
  const h = harness([new GithubRevokedError()]);
  await assert.rejects(() => h.source.token(), GithubRevokedError);
  await assert.rejects(() => h.source.token(), GithubRevokedError);
  assert.equal(h.reconnects(), 1);
});

test("a refresh that fails for another reason does not ask to reconnect", async () => {
  const h = harness([new Error("offline"), { token: "t1", expiresAt: 8 * HOUR }]);
  await assert.rejects(() => h.source.token(), /offline/);
  assert.equal(await h.source.token(), "t1");
  assert.equal(h.reconnects(), 0);
});

test("token_not_persisted: nothing reaches browser storage", async () => {
  const writes: string[] = [];
  const spy = { setItem: (key: string) => writes.push(key), getItem: () => null, removeItem: () => undefined };
  const saved = { local: globalThis.localStorage, session: globalThis.sessionStorage };
  Object.defineProperty(globalThis, "localStorage", { value: spy, configurable: true });
  Object.defineProperty(globalThis, "sessionStorage", { value: spy, configurable: true });
  try {
    const h = harness([
      { token: "t1", expiresAt: 8 * HOUR },
      { token: "t2", expiresAt: 16 * HOUR },
    ]);
    await h.source.withToken(async (token) => ({ status: token === "t1" ? 401 : 200 }));
    h.source.forget();
    assert.deepEqual(writes, []);
  } finally {
    Object.defineProperty(globalThis, "localStorage", { value: saved.local, configurable: true });
    Object.defineProperty(globalThis, "sessionStorage", { value: saved.session, configurable: true });
  }
});

test("law: a token handed out never runs out within the next minute", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(fc.integer({ min: 0, max: 10 * HOUR }), { minLength: 1, maxLength: 30 }),
      fc.integer({ min: 2 * 60_000, max: 8 * HOUR }),
      async (steps, lifetime) => {
        let clock = 0;
        let n = 0;
        const grants = new Map<string, number>();
        const source = createGithubToken({
          refresh: async () => {
            const token = `t${++n}`;
            grants.set(token, clock + lifetime);
            return { token, expiresAt: clock + lifetime };
          },
          now: () => clock,
          onReconnect: () => undefined,
        });
        for (const step of steps) {
          clock += step;
          const token = await source.token();
          assert.ok(grants.get(token)! > clock + 60_000);
        }
      },
    ),
  );
});

/**
 * Working on this computer, the shell applies its device user to every query:
 * the local user, or the account the device was adopted by. A repository that
 * writes `user_id` from the session must send that same id, or row-level
 * security refuses the row ("new row violates row-level security policy").
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LOCAL_USER_ID } from "@weaveforge/core";

import { deviceUserId, LocalSessionProvider } from "../local-identity";
import type { LocalQuery } from "../pglite-client";

const ACCOUNT = "340cf044-e239-4ba9-ab7f-45386d85bac9";

describe("local session identity", () => {
  it("reports the user the database applies, not a fixed id", async () => {
    const seen: string[] = [];
    const query: LocalQuery = async (sql) => { seen.push(sql); return [{ id: ACCOUNT }]; };
    const session = new LocalSessionProvider(() => deviceUserId(query));
    assert.equal(await session.requireUserId(), ACCOUNT);
    assert.equal(await session.getCurrentUserId(), ACCOUNT);
    assert.match(seen[0] ?? "", /auth\.uid\(\)/);
  });

  it("asks the database once", async () => {
    let calls = 0;
    const session = new LocalSessionProvider(() => deviceUserId(async () => { calls += 1; return [{ id: ACCOUNT }]; }));
    await session.requireUserId();
    await session.requireUserId();
    assert.equal(calls, 1);
  });

  it("asks again after a failed lookup", async () => {
    let calls = 0;
    const session = new LocalSessionProvider(() => deviceUserId(async () => {
      calls += 1;
      if (calls === 1) throw new Error("shell not ready");
      return [{ id: ACCOUNT }];
    }));
    await assert.rejects(session.requireUserId(), /shell not ready/);
    assert.equal(await session.requireUserId(), ACCOUNT);
  });

  it("falls back to the local user when the database has no identity", async () => {
    assert.equal(await deviceUserId(async () => [{ id: null }]), LOCAL_USER_ID);
  });

  it("still takes a fixed id (local-first account)", async () => {
    assert.equal(await new LocalSessionProvider(ACCOUNT).requireUserId(), ACCOUNT);
    assert.equal(await new LocalSessionProvider().requireUserId(), LOCAL_USER_ID);
  });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { accountGuard } from "../application/account-guard";

describe("accountGuard", () => {
  it("allows local tier traffic with no session", () => {
    assert.deepEqual(accountGuard({ tier: "local", account: null, sessionUserId: null }), {
      allowed: true,
    });
  });

  it("allows sharing when the session belongs to the tier account", () => {
    assert.deepEqual(accountGuard({ tier: "sharing", account: "u1", sessionUserId: "u1" }), {
      allowed: true,
    });
  });

  it("pauses sharing when the session is signed out, keeping the tier", () => {
    assert.deepEqual(accountGuard({ tier: "sharing", account: "u1", sessionUserId: null }), {
      allowed: false,
      reason: "signed-out",
    });
  });

  it("pauses sharing when a different account is signed in", () => {
    assert.deepEqual(accountGuard({ tier: "sharing", account: "u1", sessionUserId: "u2" }), {
      allowed: false,
      reason: "account-mismatch",
    });
  });

  it("pauses sharing when the tier has no account recorded", () => {
    assert.deepEqual(accountGuard({ tier: "sharing", account: null, sessionUserId: "u1" }), {
      allowed: false,
      reason: "account-mismatch",
    });
  });

  it("pauses local-web when signed out", () => {
    assert.deepEqual(accountGuard({ tier: "local-web", account: "u1", sessionUserId: null }), {
      allowed: false,
      reason: "signed-out",
    });
  });

  it("pauses local-web when a different account is signed in", () => {
    assert.deepEqual(accountGuard({ tier: "local-web", account: "u1", sessionUserId: "u2" }), {
      allowed: false,
      reason: "account-mismatch",
    });
  });
});

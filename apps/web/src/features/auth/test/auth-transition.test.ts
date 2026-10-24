import assert from "node:assert/strict";
import test from "node:test";

import type { AuthUser } from "../domain/auth";
import { nextAuthStep, type AuthTransitionInput } from "../domain/auth-transition";

/**
 * What the auth provider does when the session changes (32-16). The decision
 * is pure, so each branch of the old 60-line onChange is pinned here.
 */

const ada: AuthUser = { id: "ada", email: "ada@x.org", providers: [] };
const bob: AuthUser = { id: "bob", email: "bob@x.org", providers: [] };

function input(over: Partial<AuthTransitionInput>): AuthTransitionInput {
  return {
    user: null,
    previous: null,
    signingOut: false,
    wasExpired: false,
    desktop: false,
    localAccount: () => null,
    ...over,
  };
}

test("no session and no local copy signs out", () => {
  assert.deepEqual(nextAuthStep(input({})), { kind: "signedOut" });
});

test("no session on a cold start with a local copy opens that account offline", () => {
  const step = nextAuthStep(input({ localAccount: () => ({ id: "ada", email: "ada@x.org" }) }));
  assert.deepEqual(step, { kind: "offline", user: { id: "ada", email: "ada@x.org", providers: [] } });
});

test("a local copy with no email opens offline with email undefined", () => {
  const step = nextAuthStep(input({ localAccount: () => ({ id: "ada", email: null }) }));
  assert.deepEqual(step, { kind: "offline", user: { id: "ada", email: undefined, providers: [] } });
});

test("a deliberate sign-out ignores the local copy", () => {
  let asked = false;
  const step = nextAuthStep(
    input({ signingOut: true, desktop: true, previous: ada, localAccount: () => ((asked = true), { id: "ada", email: null }) }),
  );
  assert.deepEqual(step, { kind: "signedOut" });
  assert.equal(asked, false);
});

test("a lapsed session on the desktop keeps the user and asks to sign in again", () => {
  assert.deepEqual(nextAuthStep(input({ previous: ada, desktop: true })), { kind: "expired" });
});

test("a lapsed session in the browser signs out", () => {
  assert.deepEqual(nextAuthStep(input({ previous: ada, desktop: false })), { kind: "signedOut" });
});

test("signing in while another account's copy is on disk starts over", () => {
  const step = nextAuthStep(input({ user: bob, localAccount: () => ({ id: "ada", email: null }) }));
  assert.deepEqual(step, { kind: "otherAccountOnDisk" });
});

test("first sign-in keeps caches", () => {
  assert.deepEqual(nextAuthStep(input({ user: ada })), {
    kind: "signedIn",
    user: ada,
    clearCaches: false,
    refetch: false,
  });
});

test("signing in as someone else clears the last user's caches", () => {
  const step = nextAuthStep(input({ user: bob, previous: ada, wasExpired: true }));
  assert.deepEqual(step, { kind: "signedIn", user: bob, clearCaches: true, refetch: false });
});

test("coming back from a lapsed session as the same person refetches", () => {
  const step = nextAuthStep(input({ user: ada, previous: ada, wasExpired: true }));
  assert.deepEqual(step, { kind: "signedIn", user: ada, clearCaches: false, refetch: true });
});

test("a token refresh for the same user changes nothing else", () => {
  const step = nextAuthStep(input({ user: ada, previous: ada, localAccount: () => ({ id: "ada", email: null }) }));
  assert.deepEqual(step, { kind: "signedIn", user: ada, clearCaches: false, refetch: false });
});

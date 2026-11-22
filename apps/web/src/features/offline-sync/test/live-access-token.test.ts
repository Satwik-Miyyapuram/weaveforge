import assert from "node:assert/strict";
import test from "node:test";

import { liveAccessToken } from "@/features/offline-sync/ui/enable-sync";

/**
 * The sync transport's token supplier.
 *
 * The bug this exists for: `enableSync` closed over `session.access_token`, read
 * once when the reader pressed the button. A Supabase access token lasts about an
 * hour, so every request after that went out with a retired credential — and the
 * engine's `reauth` outcome, whose whole job is telling "the credential, not the
 * network" apart, was unreachable because the transport never asked for a fresh
 * token.
 *
 * The assertion is about *when* it reads, which is the part that was wrong.
 */

/** A client whose session changes on every call, the way a refresh would. */
function rotatingClient(tokens: (string | null)[]) {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    auth: {
      getSession: async () => {
        const token = tokens[Math.min(calls, tokens.length - 1)] ?? null;
        calls += 1;
        return { data: { session: token === null ? null : { access_token: token } } };
      },
    },
  };
}

test("a token is read per request, not once", async () => {
  const client = rotatingClient(["first", "second"]);
  const token = liveAccessToken(client);

  assert.equal(await token(), "first");
  assert.equal(await token(), "second", "a second request must see the refreshed token");
  assert.equal(client.calls, 2, "and it must have asked twice");
});

test("no session is null, not a stale token", async () => {
  // Signing out mid-cycle must not keep sending the token the reader just gave up.
  const client = rotatingClient([null]);
  assert.equal(await liveAccessToken(client)(), null);
});

test("a session that appears later is picked up", async () => {
  const client = rotatingClient([null, "signed-in"]);
  const token = liveAccessToken(client);

  assert.equal(await token(), null);
  assert.equal(await token(), "signed-in");
});

/** A session whose owner can change between calls, the way a sign-out and sign-in do. */
function accountClient(initial: { token: string; userId: string } | null) {
  let current = initial;
  return {
    set(next: { token: string; userId: string } | null) {
      current = next;
    },
    auth: {
      getSession: async () => ({
        data: {
          session: current === null ? null : { access_token: current.token, user: { id: current.userId } },
        },
      }),
    },
  };
}

test("a cycle for one account never gets another account's token", async () => {
  // A cycle started for A that is still running when B signs in must not push as B.
  let running = true;
  const client = accountClient({ token: "a-token", userId: "A" });
  const token = liveAccessToken(client, (userId) => running && userId === "A");

  assert.equal(await token(), "a-token");
  client.set({ token: "b-token", userId: "B" });
  assert.equal(await token(), null, "after the switch the stale cycle gets no token, and never B's");
  running = false;
});

test("a halted loop gets no token, even for the account it was started for", async () => {
  let running = false;
  const client = accountClient({ token: "a-token", userId: "A" });
  const token = liveAccessToken(client, (userId) => running && userId === "A");

  assert.equal(await token(), null);
});

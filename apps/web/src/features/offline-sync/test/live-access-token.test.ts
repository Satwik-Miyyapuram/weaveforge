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

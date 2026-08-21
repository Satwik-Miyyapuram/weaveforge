import { test } from "node:test";
import assert from "node:assert/strict";
import { singleFlight } from "@/lib/cache/single-flight";

const tick = () => new Promise((r) => setTimeout(r, 0));

test("singleFlight: concurrent callers share one run", async () => {
  let runs = 0;
  const work = async () => {
    runs += 1;
    await tick();
    return runs;
  };
  const [a, b] = await Promise.all([singleFlight("k1", work), singleFlight("k1", work)]);
  assert.equal(runs, 1);
  assert.equal(a, b);
});

test("singleFlight: a later caller runs again once the first settled", async () => {
  let runs = 0;
  const work = async () => ++runs;
  await singleFlight("k2", work);
  await singleFlight("k2", work);
  assert.equal(runs, 2, "it shares in-flight work, it does not cache results");
});

test("singleFlight: different keys do not share", async () => {
  let runs = 0;
  const work = async () => {
    runs += 1;
    await tick();
  };
  await Promise.all([singleFlight("a", work), singleFlight("b", work)]);
  assert.equal(runs, 2);
});

test("singleFlight: a failure is not cached", async () => {
  let attempts = 0;
  const work = async () => {
    attempts += 1;
    throw new Error("boom");
  };
  await assert.rejects(() => singleFlight("k3", work));
  await assert.rejects(() => singleFlight("k3", work));
  assert.equal(attempts, 2, "a rejected run must not poison the key");
});

/**
 * The sharp edge that hung the app on first login.
 *
 * Only the *first* caller's factory runs, so any side effect a later caller
 * passes into its own factory — a progress callback, a "the gate can open now"
 * signal — is silently dropped. `StartupProvider` passed `onDecision` that way.
 * Under StrictMode the effect mounts twice: the first caller's factory ran and
 * fired `onDecision`, but that first caller had already been torn down and
 * ignored it, while the second caller joined the shared promise and never got
 * a callback at all. The disclaimer gate never became ready and the shell sat
 * on "Preparing your workspace…" for ever.
 *
 * The fix is that callers must be able to recover the same information from the
 * resolved value — which is what the two tests below pin down.
 */
test("singleFlight: a second caller's factory never runs, so its callbacks never fire", async () => {
  const fired: string[] = [];
  const factory = (who: string) => async () => {
    fired.push(who);
    await tick();
    return { decided: true };
  };

  const [first, second] = await Promise.all([
    singleFlight("k4", factory("first")),
    singleFlight("k4", factory("second")),
  ]);

  assert.deepEqual(fired, ["first"], "the second factory must not have run");
  assert.equal(second, first, "but both callers still get the answer");
});

test("singleFlight: every caller can recover the outcome from the resolved value", async () => {
  // This is the property the startup gate now depends on instead of a callback.
  // If a shared bundle ever stops carrying its decision in the resolved value,
  // the second caller has no way to learn it and the hang comes back.
  const work = async () => {
    await tick();
    return { needsPrivacyAccept: false, settings: { ok: true } };
  };

  const results = await Promise.all([
    singleFlight("k5", work),
    singleFlight("k5", work),
    singleFlight("k5", work),
  ]);

  for (const result of results) {
    assert.equal(
      typeof result.needsPrivacyAccept,
      "boolean",
      "the decision must be readable from the resolved value by every caller",
    );
  }
});

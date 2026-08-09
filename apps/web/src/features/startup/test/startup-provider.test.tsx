/**
 * The first-login hang, at the level it actually happened.
 *
 * `loadStartupBundle` is single-flighted, so a second caller joins the
 * in-flight promise and its `onDecision` is never invoked — only the first
 * caller's is, and by then that caller has been torn down and ignores it. On a
 * real first login StrictMode's remount was the second caller, and the
 * disclaimer gate never became ready: the shell sat on "Preparing your
 * workspace…" for ever on any browser with no cached snapshot.
 *
 * The join is reproduced here by mounting, unmounting and mounting again while
 * the load is held open, rather than by wrapping in `StrictMode` — react-test-
 * renderer does not double-invoke effects the way react-dom does in
 * development, so the StrictMode version of these tests passed against the
 * unfixed code and proved nothing.
 *
 * `single-flight.test.ts` pins the underlying trap. This pins the component
 * that fell into it, which is the part that can regress by someone deleting
 * three lines that look redundant.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { StrictMode, type ReactNode } from "react";

import { renderHook } from "@/lib/test/react-harness";
import {
  StartupProvider,
  useStartup,
  type StartupBundleLoader,
  type StartupSnapshot,
} from "../startup-provider";

const ACCEPTED_SETTINGS = {
  disclaimerAcceptedAt: new Date().toISOString(),
  disclaimerVersion: Number.MAX_SAFE_INTEGER,
} as unknown as StartupSnapshot["settings"];

function snapshot(needsPrivacyAccept: boolean): StartupSnapshot {
  return {
    settings: needsPrivacyAccept ? null : ACCEPTED_SETTINGS,
    profile: null,
    team: [],
    labMembers: [],
    memberships: [],
    needsPrivacyAccept,
  };
}

/**
 * A loader shaped like the real one: it reports the decision through
 * `onDecision` before resolving, which is exactly the callback the second
 * caller never receives.
 */
function fakeLoader(needsPrivacyAccept: boolean) {
  let calls = 0;
  const load: StartupBundleLoader = async (_userId, opts) => {
    calls += 1;
    await Promise.resolve();
    opts?.onDecision?.(needsPrivacyAccept, null);
    return snapshot(needsPrivacyAccept);
  };
  return { load, get calls() { return calls; } };
}

/** Unique per test: `singleFlight` keys on the user id. */
let nextUser = 0;
const userId = () => `user-${++nextUser}`;

/**
 * Wraps the probe in a provider for the given user. `strict` additionally wraps
 * in `StrictMode` — kept for the tests that only need the provider to behave
 * under it, not as a way of forcing a double mount, which react-test-renderer
 * does not do.
 */
function withProvider(user: string, load: StartupBundleLoader, strict: boolean) {
  const wrap = (children: ReactNode) => {
    const provider = (
      <StartupProvider userId={user} loadBundle={load}>
        {children}
      </StartupProvider>
    );
    return strict ? <StrictMode>{provider}</StrictMode> : provider;
  };
  // Named so the react plugin does not read an anonymous element-returning
  // arrow as a component definition missing a display name.
  wrap.displayName = "StartupTestWrapper";
  return wrap;
}

test("startup: a mount that joins an in-flight bundle still opens the gate", async () => {
  // The bug, reproduced deterministically rather than by hoping StrictMode
  // double-invokes: mount, tear down, and mount again *while the first load is
  // still in flight*. The second mount joins the shared promise, so its
  // `onDecision` is never called — only the first caller's is, and that caller
  // is gone. Exactly what StrictMode's remount did on a real first login.
  //
  // Written this way on purpose: the StrictMode version of this test passed
  // against the unfixed code, because react-test-renderer does not double-
  // invoke effects the way react-dom does in development.
  const user = userId();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  let decisionsDelivered = 0;
  const load: StartupBundleLoader = async (_userId, opts) => {
    await gate;                       // held open across both mounts
    opts?.onDecision?.(false, null);
    decisionsDelivered += 1;
    return snapshot(false);
  };

  const first = await renderHook(() => useStartup(), undefined, {
    wrapper: withProvider(user, load, false),
  });
  await first.unmount();              // its `active` flag is now false

  const second = await renderHook(() => useStartup(), undefined, {
    wrapper: withProvider(user, load, false),
  });

  release();
  await second.flush();
  await second.flush();

  assert.equal(
    decisionsDelivered,
    1,
    "the second mount must have joined the first load, not started its own",
  );
  assert.equal(
    second.current.gateReady,
    true,
    "the shell sits on 'Preparing your workspace…' for ever while this is false",
  );
  assert.equal(second.current.needsPrivacyAccept, false);
  await second.unmount();
});

test("startup: the work is still shared, not run twice", async () => {
  // The fix must not be "stop single-flighting" — that would trade a hang for
  // a duplicated startup round trip on every load. Both providers have to be
  // mounted while the load is *in flight*, because sharing is what
  // `singleFlight` does with concurrent work, not a cache of finished work.
  const user = userId();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  const load: StartupBundleLoader = async (_userId, opts) => {
    calls += 1;
    await gate;
    opts?.onDecision?.(false, null);
    return snapshot(false);
  };

  const a = await renderHook(() => useStartup(), undefined, {
    wrapper: withProvider(user, load, false),
  });
  const b = await renderHook(() => useStartup(), undefined, {
    wrapper: withProvider(user, load, false),
  });

  release();
  await a.flush();
  await b.flush();

  assert.equal(calls, 1, `startup ran ${calls} times`);
  assert.equal(a.current.gateReady, true);
  assert.equal(b.current.gateReady, true, "the joining provider must also be ready");
  await a.unmount();
  await b.unmount();
});

test("startup: a single mount still resolves the gate", async () => {
  const loader = fakeLoader(false);
  const user = userId();

  const harness = await renderHook(() => useStartup(), undefined, {
    wrapper: withProvider(user, loader.load, false),
  });
  await harness.flush();

  assert.equal(harness.current.gateReady, true);
  assert.equal(loader.calls, 1);
  await harness.unmount();
});

test("startup: a user who must accept the disclaimer is gated, not hung", async () => {
  // Fail-closed still has to reach a *decision*: ready, and needing acceptance.
  // Reporting "not ready" would be indistinguishable from the hang.
  const loader = fakeLoader(true);
  const user = userId();

  const harness = await renderHook(() => useStartup(), undefined, {
    wrapper: withProvider(user, loader.load, true),
  });
  await harness.flush();

  assert.equal(harness.current.gateReady, true);
  assert.equal(harness.current.needsPrivacyAccept, true);
  await harness.unmount();
});

test("startup: the loading flag clears once the bundle settles", async () => {
  const loader = fakeLoader(false);
  const user = userId();

  const harness = await renderHook(() => useStartup(), undefined, {
    wrapper: withProvider(user, loader.load, true),
  });
  await harness.flush();

  assert.equal(harness.current.loading, false);
  assert.ok(harness.current.snapshot, "the snapshot must reach the context");
  await harness.unmount();
});

test("startup: a loader that never reports a decision still opens the gate", async () => {
  // The backstop's whole point: the gate is resolved from the settled bundle,
  // so it does not depend on the callback firing at all.
  const user = userId();
  const silent: StartupBundleLoader = async () => {
    await Promise.resolve();
    return snapshot(false);
  };

  const harness = await renderHook(() => useStartup(), undefined, {
    wrapper: withProvider(user, silent, true),
  });
  await harness.flush();

  assert.equal(harness.current.gateReady, true);
  assert.equal(harness.current.needsPrivacyAccept, false);
  await harness.unmount();
});

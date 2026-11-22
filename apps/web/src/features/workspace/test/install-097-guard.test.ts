import assert from "node:assert/strict";
import { test } from "node:test";
import { INSTALL_097_NOTICE, install097Check } from "../application/install-097-guard";

/** A bridge method that records each call and answers with `impl`. */
function spyOf<A extends unknown[], R>(impl: (...args: A) => Promise<R>) {
  const calls: A[] = [];
  const fn = async (...args: A) => {
    calls.push(args);
    return impl(...args);
  };
  return { fn, calls };
}

const legacyTrue = async () => true;

test("no desktop bridge (browser, Android): open", async () => {
  assert.deepEqual(await install097Check(null, null), { kind: "open" });
});

test("legacyDbPresent absent on a desktop shell: unknown, open (fail open)", async () => {
  assert.deepEqual(await install097Check({}, "/ws"), { kind: "open" });
});

test("legacyDbPresent throws: unknown, open (fail open), report never asked", async () => {
  const verify = spyOf(async () => true);
  const bridge = {
    legacyDbPresent: async () => {
      throw new Error("bridge down");
    },
    migrationReportVerified: verify.fn,
  };
  assert.deepEqual(await install097Check(bridge, "/ws"), { kind: "open" });
  assert.equal(verify.calls.length, 0);
});

test("legacyDbPresent answers a non-boolean: unknown, open (fail open)", async () => {
  const bridge = { legacyDbPresent: async () => null as unknown as boolean };
  assert.deepEqual(await install097Check(bridge, "/ws"), { kind: "open" });
});

test("legacy false: open, report never asked", async () => {
  const verify = spyOf(async () => false);
  const bridge = { legacyDbPresent: async () => false, migrationReportVerified: verify.fn };
  assert.deepEqual(await install097Check(bridge, "/ws"), { kind: "open" });
  assert.equal(verify.calls.length, 0);
});

test("legacy false and report method absent (fresh install): open, not unknown", async () => {
  assert.deepEqual(await install097Check({ legacyDbPresent: async () => false }, null), { kind: "open" });
  assert.deepEqual(await install097Check({ legacyDbPresent: async () => false }, "/ws"), { kind: "open" });
});

test("legacy true and no folder known: unverified (picker), report never asked", async () => {
  const verify = spyOf(async () => true);
  const bridge = { legacyDbPresent: legacyTrue, migrationReportVerified: verify.fn };
  assert.deepEqual(await install097Check(bridge, null), { kind: "unverified" });
  assert.equal(verify.calls.length, 0);
});

test("legacy true and report method absent: unknown, open (fail open)", async () => {
  assert.deepEqual(await install097Check({ legacyDbPresent: legacyTrue }, "/ws"), { kind: "open" });
});

test("legacy true and report verified: open, checked against the given folder", async () => {
  const verify = spyOf(async (_folder: string) => true);
  const bridge = { legacyDbPresent: legacyTrue, migrationReportVerified: verify.fn };
  assert.deepEqual(await install097Check(bridge, "/ws/export"), { kind: "open" });
  assert.deepEqual(verify.calls, [["/ws/export"]]);
});

test("legacy true and report not verified: unverified (picker), checked against the folder", async () => {
  const verify = spyOf(async (_folder: string) => false);
  const bridge = { legacyDbPresent: legacyTrue, migrationReportVerified: verify.fn };
  assert.deepEqual(await install097Check(bridge, "/ws/moved"), { kind: "unverified" });
  assert.deepEqual(verify.calls, [["/ws/moved"]]);
});

test("legacy true, install gate answers false (0.9.7 secrets marker absent): asked once, unverified, never open", async () => {
  const verify = spyOf(async (_folder: string) => false);
  const bridge = { legacyDbPresent: legacyTrue, migrationReportVerified: verify.fn };
  assert.deepEqual(await install097Check(bridge, "/ws/moved"), { kind: "unverified" });
  assert.equal(verify.calls.length, 1, "the gate answer is the only input; a false answer must not be bypassed");
});

test("legacy true, report verified and secrets moved (marker present, gate true): open", async () => {
  const bridge = { legacyDbPresent: legacyTrue, migrationReportVerified: async (_folder: string) => true };
  assert.deepEqual(await install097Check(bridge, "/ws/moved"), { kind: "open" });
});

test("the gate notice body is the exact 0.9.7 move instruction", () => {
  assert.equal(
    INSTALL_097_NOTICE.body,
    "Install or open WeaveForge 0.9.7 so its move finishes, then come back.",
  );
});

test("legacy true and report throws: unknown with its code, open (fail open)", async () => {
  const bridge = {
    legacyDbPresent: legacyTrue,
    migrationReportVerified: async (_folder: string): Promise<boolean> => {
      throw new Error("bridge down");
    },
  };
  assert.deepEqual(await install097Check(bridge, "/ws"), { kind: "open" });
});

test("legacy true and report answers a non-boolean: unknown, open (fail open)", async () => {
  const bridge = {
    legacyDbPresent: legacyTrue,
    migrationReportVerified: async (_folder: string) => undefined as unknown as boolean,
  };
  assert.deepEqual(await install097Check(bridge, "/ws"), { kind: "open" });
});

/** A fake old-user port: the web reader answers these two questions. */
function oldUserPort(legacyRows: () => Promise<boolean>, ownRun: () => Promise<boolean>) {
  const calls = { ownRun: 0 };
  return {
    port: {
      hasLegacyRows: legacyRows,
      ownRunVerified: async () => {
        calls.ownRun += 1;
        return ownRun();
      },
    },
    calls,
  };
}

test("web new account (no legacy rows): open, export never checked", async () => {
  const { port, calls } = oldUserPort(async () => false, async () => false);
  assert.deepEqual(await install097Check(null, null, port), { kind: "open" });
  assert.equal(calls.ownRun, 0);
});

test("web old user with legacy rows and no verified export: unverified with the web export action", async () => {
  const { port } = oldUserPort(async () => true, async () => false);
  assert.deepEqual(await install097Check(null, null, port), { kind: "unverified", action: "web-export" });
});

test("web old user with legacy rows and a verified export: open", async () => {
  const { port } = oldUserPort(async () => true, async () => true);
  assert.deepEqual(await install097Check(null, null, port), { kind: "open" });
});

test("web old-user port throws: unknown, open (fail open) (guard shows)", async () => {
  const { port } = oldUserPort(
    async () => {
      throw new Error("reader down");
    },
    async () => true,
  );
  assert.deepEqual(await install097Check(null, null, port), { kind: "open" });
});

test("desktop, no local DB, signed-in old user with server rows and no export: unverified web-export, not open", async () => {
  const { port } = oldUserPort(async () => true, async () => false);
  const bridge = { legacyDbPresent: async () => false };
  assert.deepEqual(await install097Check(bridge, "/ws", port), { kind: "unverified", action: "web-export" });
});

test("desktop, no local DB, signed-in old user with a verified export: open", async () => {
  const { port } = oldUserPort(async () => true, async () => true);
  assert.deepEqual(await install097Check({ legacyDbPresent: async () => false }, "/ws", port), { kind: "open" });
});

test("desktop, no local DB, signed-in new account (no rows): open, export never checked", async () => {
  const { port, calls } = oldUserPort(async () => false, async () => false);
  assert.deepEqual(await install097Check({ legacyDbPresent: async () => false }, "/ws", port), { kind: "open" });
  assert.equal(calls.ownRun, 0);
});

test("desktop, no local DB, old-user port throws: unknown, open (fail open)", async () => {
  const { port } = oldUserPort(
    async () => {
      throw new Error("reader down");
    },
    async () => true,
  );
  assert.deepEqual(await install097Check({ legacyDbPresent: async () => false }, "/ws", port), { kind: "open" });
});

test("desktop, no local DB, no signed-in account (no port): open", async () => {
  assert.deepEqual(await install097Check({ legacyDbPresent: async () => false }, "/ws"), { kind: "open" });
});

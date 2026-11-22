import { test } from "node:test";
import assert from "node:assert/strict";
import { desktopShim, type DesktopCommands } from "../desktop";

type Events = Parameters<typeof desktopShim>[1];

/** Shell answer shaped like the generated commands' `Result`. */
const ok = <T>(data: T) => ({ status: "ok" as const, data });

function shimWith(installGateRequired: () => Promise<unknown>) {
  const cmds = { installGateRequired } as unknown as DesktopCommands;
  return desktopShim(cmds, {} as Events);
}

// The gate's decision (askInstallGate, including fail-closed on a missing member) is tested
// on the real helper in apps/web/src/features/install-gate/test/install-gate.test.tsx.

test("the shim exposes installGateRequired and returns the shell's answer", async () => {
  const shim = shimWith(async () => ok(true));
  assert.equal(typeof shim.installGateRequired, "function");
  assert.equal(await shim.installGateRequired?.(), true);
});

test("the shim passes a false answer through unchanged", async () => {
  const shim = shimWith(async () => ok(false));
  assert.equal(await shim.installGateRequired?.(), false);
});

test("a failed shell check rejects through the shim", async () => {
  const shim = shimWith(async () => ({
    status: "error",
    error: { message: "device id unreadable" },
  }));
  await assert.rejects(() => shim.installGateRequired?.() ?? Promise.resolve(false));
});
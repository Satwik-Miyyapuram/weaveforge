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

/**
 * Mirrors `askInstallGate` in apps/web/src/features/install-gate/ui/install-gate.tsx, which
 * cannot be imported here (JSX and the `@/` alias). Keep the two in step.
 */
async function askInstallGate(bridge: { installGateRequired?: () => Promise<boolean> } | null) {
  if (!bridge?.installGateRequired) return false;
  try {
    return await bridge.installGateRequired();
  } catch {
    return true;
  }
}

test("the shim exposes installGateRequired and returns the shell's answer", async () => {
  const shim = shimWith(async () => ok(true));
  assert.equal(typeof shim.installGateRequired, "function");
  assert.equal(await shim.installGateRequired?.(), true);
});

test("the gate reads a false answer from the shell as no gate", async () => {
  const shim = shimWith(async () => ok(false));
  assert.equal(await askInstallGate(shim), false);
});

test("the gate shows when the shell says an old-data upgrade needs 0.9.7 first", async () => {
  const shim = shimWith(async () => ok(true));
  assert.equal(await askInstallGate(shim), true);
});

test("a failed shell check rejects through the shim, so the gate shows", async () => {
  const shim = shimWith(async () => ({
    status: "error",
    error: { message: "device id unreadable" },
  }));
  assert.equal(await askInstallGate(shim), true);
});

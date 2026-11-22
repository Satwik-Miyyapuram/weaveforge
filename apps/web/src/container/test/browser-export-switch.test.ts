import assert from "node:assert/strict";
import { test } from "node:test";
import { decideBrowserSwitch, type SwitchDeps } from "../browser-export-switch";

const WIRING = { wiring: true } as unknown as Awaited<ReturnType<SwitchDeps["openWiring"]>>;

function harness(over: Partial<SwitchDeps> = {}) {
  const gateCalls: unknown[] = [];
  let opened = 0;
  const deps: SwitchDeps = {
    session: async () => ({ userId: "u1", accessToken: "t0k" }),
    dataUrl: "https://data.example",
    anonKey: "anon",
    kinds: ["logEntries"],
    codec: {} as SwitchDeps["codec"],
    openSink: async () => ({}) as SwitchDeps["openSink"] extends () => Promise<infer S> ? S : never,
    now: () => "2026-11-22T00:00:00.000Z",
    gate: async (opts) => {
      gateCalls.push(opts);
      return { switch: true };
    },
    openWiring: async () => {
      opened += 1;
      return WIRING;
    },
    ...over,
  };
  return { deps, gateCalls, opened: () => opened };
}

test("(a) a fresh verified run switches to the OPFS wiring", async () => {
  const h = harness();
  const out = await decideBrowserSwitch(h.deps);
  assert.equal(out.switch, true);
  if (out.switch) assert.equal(out.wiring, WIRING);
  assert.equal(h.gateCalls.length, 1);
  assert.equal(h.opened(), 1);
});

test("(a) every startup re-runs the export: a second decision runs the gate again", async () => {
  const h = harness();
  await decideBrowserSwitch(h.deps);
  await decideBrowserSwitch(h.deps);
  assert.equal(h.gateCalls.length, 2);
});

test("(b) a run that does not verify never switches and opens no OPFS wiring", async () => {
  const h = harness({
    gate: async () => ({ switch: false }),
  });
  const out = await decideBrowserSwitch(h.deps);
  assert.deepEqual(out, { switch: false, reason: "not-verified" });
  assert.equal(h.opened(), 0);
});

test("no session at startup: the gate never runs, the result asks for Retry", async () => {
  const h = harness({ session: async () => null });
  const out = await decideBrowserSwitch(h.deps);
  assert.deepEqual(out, { switch: false, reason: "no-session" });
  assert.equal(h.gateCalls.length, 0);
  assert.equal(h.opened(), 0);
});

test("a gate that throws never switches", async () => {
  const h = harness({
    gate: async () => {
      throw new Error("network down");
    },
  });
  const out = await decideBrowserSwitch(h.deps);
  assert.deepEqual(out, { switch: false, reason: "error" });
  assert.equal(h.opened(), 0);
});
import assert from "node:assert/strict";
import { test } from "node:test";
import { decideBrowserSwitch, type SwitchDeps } from "../browser-export-switch";

const WIRING = { wiring: true } as unknown as Awaited<ReturnType<SwitchDeps["openWiring"]>>;

function harness(over: Partial<SwitchDeps> = {}) {
  const gateCalls: unknown[] = [];
  let opened = 0;
  const deps: SwitchDeps = {
    desktop: false,
    session: async () => ({ userId: "u1", accessToken: "t0k" }),
    dataUrl: "https://data.example",
    anonKey: "anon",
    kinds: ["logEntries"],
    codec: {} as SwitchDeps["codec"],
    openSink: async () => ({}) as SwitchDeps["openSink"] extends () => Promise<infer S> ? S : never,
    now: () => "2026-11-22T00:00:00.000Z",
    // The switch writes the server mark after wiring opens; stub it so no test reaches the network.
    fetch: async () => new Response(null, { status: 204 }),
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

test("(P1-3) on desktop the browser switch never runs: no session read, no gate, no mark", async () => {
  let sessionCalls = 0;
  const h = harness({
    desktop: true,
    session: async () => {
      sessionCalls += 1;
      return { userId: "u1", accessToken: "t0k" };
    },
  } as Partial<SwitchDeps>);
  const out = await decideBrowserSwitch(h.deps);
  assert.deepEqual(out, { switch: false, reason: "desktop" });
  assert.equal(sessionCalls, 0);
  assert.equal(h.gateCalls.length, 0);
  assert.equal(h.opened(), 0);
});

function recordingFetch(order: string[]) {
  const fetch = async (input: RequestInfo | URL) => {
    if (String(input).includes("mark_exported_097")) order.push("mark");
    return new Response("{}", { status: 200 });
  };
  return fetch as unknown as typeof globalThis.fetch;
}

test("(P2-5) openWiring throws: markExported097 is never called", async () => {
  const order: string[] = [];
  const h = harness({
    fetch: recordingFetch(order),
    openWiring: async () => {
      throw new Error("opfs locked");
    },
  });
  const out = await decideBrowserSwitch(h.deps);
  assert.deepEqual(out, { switch: false, reason: "error" });
  assert.deepEqual(order, []);
});

test("(P2-5) a successful switch marks the export once, after the wiring opens", async () => {
  const order: string[] = [];
  const h = harness({
    fetch: recordingFetch(order),
    openWiring: async () => {
      order.push("wiring");
      return WIRING;
    },
  });
  const out = await decideBrowserSwitch(h.deps);
  assert.equal(out.switch, true);
  assert.deepEqual(order, ["wiring", "mark"]);
});

test("(P2-5) the gate runs with skipMark so the export itself never marks", async () => {
  const h = harness();
  await decideBrowserSwitch(h.deps);
  assert.equal((h.gateCalls[0] as { skipMark?: boolean }).skipMark, true);
});

test("(P1-2) the browser source reports pendingOutbox 0: no browser outbox exists to count", async () => {
  const h = harness();
  await decideBrowserSwitch(h.deps);
  const { source } = h.gateCalls[0] as { source: { pendingOutbox: () => Promise<number> } };
  assert.equal(await source.pendingOutbox(), 0);
});

test("(P1-2) no in-flight tracker: wiring opens only after the gate's final read-back resolves", async () => {
  const order: string[] = [];
  const h = harness({
    gate: async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      order.push("gate-done");
      return { switch: true };
    },
    openWiring: async () => {
      order.push("wiring");
      return WIRING;
    },
  });
  await decideBrowserSwitch(h.deps);
  assert.deepEqual(order, ["gate-done", "wiring"]);
});
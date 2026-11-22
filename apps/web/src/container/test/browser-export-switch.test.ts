import assert from "node:assert/strict";
import { test } from "node:test";
import { decideBrowserSwitch, type SwitchDeps } from "../browser-export-switch";
import { MemorySink } from "../../features/migration-097/infrastructure/memory-sink";
import { ownReportPath } from "../../features/migration-097/domain/report";
import { SWITCH_MARKER_PATH, readSwitchMarker } from "../../features/migration-097/domain/switch-marker";

/** This browser's own report state (report-<install id>.json), or null when it has none. */
async function ownState(sink: MemorySink): Promise<string | null> {
  const path = ownReportPath(INSTALL_ID);
  if (!(await sink.list()).includes(path)) return null;
  return (JSON.parse(await sink.readText(path)) as { state: string }).state;
}

const WIRING = { wiring: true, close: async () => {} } as unknown as Awaited<ReturnType<SwitchDeps["openWiring"]>>;

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
    openSink: async () => new MemorySink(),
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
    installId: async () => INSTALL_ID,
    ...over,
  };
  return { deps, gateCalls, opened: () => opened };
}

/** This browser's install id. The DEVICE_REPORT fixture below is this browser's own run. */
const INSTALL_ID = "dev-9";

test("(P2) the switch gate gets this browser's install id as runDeviceId, and the marker carries it", async () => {
  const sink = new MemorySink();
  const h = harness({ openSink: async () => sink });
  const out = await decideBrowserSwitch(h.deps);
  assert.equal(out.switch, true);
  assert.equal((h.gateCalls[0] as { runDeviceId?: string }).runDeviceId, INSTALL_ID);
  assert.equal((await readSwitchMarker(sink))?.deviceId, INSTALL_ID);
});

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

test("the source the gate receives downloads blobs through the injected signedUrl", async () => {
  const fetched: string[] = [];
  let got: Uint8Array | undefined;
  const h = harness({
    signedUrl: async (bucket, path) => `https://dl.example/${bucket}/${path}`,
    fetch: async (input) => {
      fetched.push(String(input));
      return new Response(new Uint8Array([7]), { status: 200 });
    },
    gate: async (opts) => {
      got = await opts.source.fetchBlob({ bucket: "b", path: "p", sizeBytes: 1 });
      return { switch: true };
    },
  });
  const out = await decideBrowserSwitch(h.deps);
  assert.equal(out.switch, true);
  assert.ok(fetched.includes("https://dl.example/b/p"), `blob url not fetched: ${fetched.join(", ")}`);
  assert.deepEqual([...(got ?? [])], [7]);
});

test("(P1) a HEAD 400 does not block the switch: the browser sends no content_enc HEAD at all", async () => {
  const methods: string[] = [];
  const h = harness({
    fetch: async (_input, init) => {
      methods.push(init?.method ?? "GET");
      return init?.method === "HEAD" ? new Response(null, { status: 400 }) : new Response(null, { status: 204 });
    },
    gate: async (opts) => {
      await opts.source.undecryptable("logEntries");
      await opts.source.undecryptable("notes");
      return { switch: true };
    },
  });
  const out = await decideBrowserSwitch(h.deps);
  assert.equal(out.switch, true);
  assert.equal(methods.includes("HEAD"), false);
});

test("(P2-2) a mark that fails after wiring opens keeps the switch off, and a retry opens the wiring again", async () => {
  let opened = 0;
  let marks = 0;
  const h = harness({
    fetch: async (input) => {
      if (!String(input).includes("/rpc/mark_exported_097")) return new Response(null, { status: 204 });
      marks += 1;
      return marks === 1 ? new Response("boom", { status: 500 }) : new Response(null, { status: 204 });
    },
    gate: async () => ({ switch: true }),
    openWiring: async () => {
      opened += 1;
      return WIRING;
    },
  });
  const first = await decideBrowserSwitch(h.deps);
  assert.deepEqual(first, { switch: false, reason: "error" });
  const retry = await decideBrowserSwitch(h.deps);
  assert.equal(retry.switch, true);
  assert.equal(opened, 2);
});

// What the gate leaves on disk when it verified but skipped the marks: incomplete, markers pending.
test("(P2-2) a failed mark closes the opened wiring exactly once", async () => {
  let closed = 0;
  const wiring = Object.assign(
    () => {
      throw new Error("not called in this test");
    },
    {
      close: async () => {
        closed += 1;
      },
    },
  );
  const h = harness({
    fetch: async () => new Response(null, { status: 500 }),
    openWiring: async () => wiring as unknown as Awaited<ReturnType<SwitchDeps["openWiring"]>>,
  });
  const out = await decideBrowserSwitch(h.deps);
  assert.deepEqual(out, { switch: false, reason: "error" });
  assert.equal(closed, 1);
});

const PENDING_REPORT = JSON.stringify({
  version: 1,
  state: "incomplete",
  target: "opfs",
  runs: [
    {
      startedAt: "2026-11-22T00:00:00.000Z",
      finishedAt: "2026-11-22T00:00:00.000Z",
      deviceId: "dev-9",
      sources: ["server"],
      kinds: {},
      blobs: { db: 0, verified: 0 },
      missing: [{ kind: "marker", id: "*", reason: "markers pending" }],
    },
  ],
});

test("(P2-3) the switch writes report.json verified only after its server mark succeeds", async () => {
  const sink = new MemorySink();
  const h = harness({
    openSink: async () => sink,
    gate: async (opts) => {
      await opts.sink.write(ownReportPath(INSTALL_ID), PENDING_REPORT);
      return { switch: true };
    },
  });
  const out = await decideBrowserSwitch(h.deps);
  assert.equal(out.switch, true);
  assert.equal((await ownState(sink)), "verified");
});

test("(P2-3) a failed server mark leaves report.json incomplete with markers pending", async () => {
  const sink = new MemorySink();
  const h = harness({
    openSink: async () => sink,
    fetch: async () => new Response("boom", { status: 500 }),
    gate: async (opts) => {
      await opts.sink.write(ownReportPath(INSTALL_ID), PENDING_REPORT);
      return { switch: true };
    },
  });
  const out = await decideBrowserSwitch(h.deps);
  assert.deepEqual(out, { switch: false, reason: "error" });
  assert.equal((await ownState(sink)), "incomplete");
});

const DEVICE_REPORT = JSON.stringify({
  version: 1,
  state: "incomplete",
  target: "opfs",
  runs: [
    {
      startedAt: "2026-11-22T00:00:00.000Z",
      finishedAt: "2026-11-22T00:00:00.000Z",
      deviceId: "dev-9",
      sources: ["server"],
      kinds: {},
      blobs: { db: 0, verified: 0 },
      missing: [{ kind: "marker", id: "*", reason: "markers pending" }],
    },
  ],
});

test("(item1) a successful switch writes the switched marker with the run's deviceId", async () => {
  const sink = new MemorySink();
  const h = harness({
    openSink: async () => sink,
    gate: async (opts) => {
      await opts.sink.write(ownReportPath(INSTALL_ID), DEVICE_REPORT);
      return { switch: true };
    },
  });
  const out = await decideBrowserSwitch(h.deps);
  assert.equal(out.switch, true);
  const marker = await readSwitchMarker(sink);
  assert.equal(marker?.deviceId, "dev-9");
  assert.ok(marker && !Number.isNaN(Date.parse(marker.switchedAt)));
});

test("(item1) a failed server mark writes no switched marker", async () => {
  const sink = new MemorySink();
  const h = harness({
    openSink: async () => sink,
    fetch: async () => new Response("boom", { status: 500 }),
    gate: async (opts) => {
      await opts.sink.write(ownReportPath(INSTALL_ID), DEVICE_REPORT);
      return { switch: true };
    },
  });
  await decideBrowserSwitch(h.deps);
  assert.equal(await readSwitchMarker(sink), null);
});

/** A sink whose report rename fails, so recordServerMarked throws after the server mark succeeds. */
class RenameFailsSink extends MemorySink {
  override async rename(): Promise<void> {
    throw new Error("rename failed");
  }
}

test("(P3) recordServerMarked throwing after the server mark closes the wiring and stays off", async () => {
  let closed = 0;
  const sink = new RenameFailsSink();
  const h = harness({
    openSink: async () => sink,
    openWiring: async () =>
      ({ wiring: true, close: async () => { closed += 1; } }) as unknown as Awaited<ReturnType<SwitchDeps["openWiring"]>>,
    gate: async (opts) => {
      await opts.sink.write(ownReportPath(INSTALL_ID), DEVICE_REPORT);
      return { switch: true };
    },
  });
  const out = await decideBrowserSwitch(h.deps);
  assert.deepEqual(out, { switch: false, reason: "error" });
  assert.equal(closed, 1, "wiring opened before the throw is closed");
  assert.equal(await readSwitchMarker(sink), null);
});

const TWO_DEVICE_REPORT = JSON.stringify({
  version: 1,
  state: "incomplete",
  target: "opfs",
  deviceId: "dev-me",
  runs: [
    {
      startedAt: "2026-11-21T00:00:00.000Z",
      finishedAt: "2026-11-21T00:00:00.000Z",
      deviceId: "dev-other",
      sources: ["server"],
      kinds: {},
      blobs: { db: 0, verified: 0 },
      missing: [],
    },
    {
      startedAt: "2026-11-22T00:00:00.000Z",
      finishedAt: "2026-11-22T00:00:00.000Z",
      deviceId: "dev-me",
      sources: ["server"],
      kinds: {},
      blobs: { db: 0, verified: 0 },
      missing: [{ kind: "marker", id: "*", reason: "markers pending" }],
    },
  ],
});

test("(P3) the marker takes this device's install id, not another device's run in the report", async () => {
  const sink = new MemorySink();
  const h = harness({
    openSink: async () => sink,
    installId: async () => "dev-me",
    gate: async (opts) => {
      await opts.sink.write(ownReportPath("dev-me"), TWO_DEVICE_REPORT);
      return { switch: true };
    },
  });
  await decideBrowserSwitch(h.deps);
  assert.equal((await readSwitchMarker(sink))?.deviceId, "dev-me");
});

/** A sink whose switched-marker write fails, after every other write succeeds. */
class MarkerWriteFailsSink extends MemorySink {
  override async write(path: string, text: string): Promise<void> {
    if (path === SWITCH_MARKER_PATH) throw new Error("disk full");
    return super.write(path, text);
  }
}

test("(P1-6) markExported097 ran but the marker write failed: pending is set, the run is an error", async () => {
  const events: string[] = [];
  const h = harness({
    openSink: async () => new MarkerWriteFailsSink(),
    pending: {
      set: () => void events.push("set"),
      clear: () => void events.push("clear"),
    },
  });
  const out = await decideBrowserSwitch(h.deps);
  assert.deepEqual(out, { switch: false, reason: "error" });
  assert.deepEqual(events, ["set"]);
});

test("(P1-6) a successful switch sets pending and clears it once the marker is written", async () => {
  const events: string[] = [];
  const h = harness({
    pending: {
      set: () => void events.push("set"),
      clear: () => void events.push("clear"),
    },
  });
  const out = await decideBrowserSwitch(h.deps);
  assert.equal(out.switch, true);
  assert.deepEqual(events, ["set", "clear"]);
});

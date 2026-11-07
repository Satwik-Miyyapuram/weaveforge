import assert from "node:assert/strict";
import test from "node:test";
import { createIoBridge, type LiveTransport } from "../io-bridge";

const JOIN = { project: { name: "Thesis" }, permissionsLevel: "owner", protocolVersion: 2, publicId: "p1" };

/** A transport whose event queue the test fills, recording every call. */
function fakeTransport(overrides: Partial<LiveTransport> = {}) {
  const calls: unknown[][] = [];
  const queue: { name: string; args: unknown[] }[][] = [];
  let wake: (() => void) | null = null;
  const transport: LiveTransport = {
    async open() {
      calls.push(["open"]);
      return { ok: true, liveId: "L1", join: [JOIN] };
    },
    async emit(liveId, name, args) {
      calls.push(["emit", liveId, name, args]);
      return { ok: true, reply: [null, "answer"] };
    },
    async events(liveId) {
      calls.push(["events", liveId]);
      while (queue.length === 0) await new Promise<void>((r) => (wake = r));
      const events = queue.shift()!;
      return { ok: true, events, closed: events.some((e) => e.name === "disconnect") };
    },
    async close(liveId) {
      calls.push(["close", liveId]);
    },
    ...overrides,
  };
  const push = (events: { name: string; args: unknown[] }[]) => {
    queue.push(events);
    wake?.();
  };
  return { transport, calls, push };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

function connect(transport: LiveTransport) {
  const io = createIoBridge(() => transport);
  return { io, socket: io.connect("https://x", { "auto connect": false }) };
}

test("looks like socket.io 0.9 to Overleaf's shim", () => {
  const { io } = connect(fakeTransport().transport);
  assert.equal(io.version.slice(0, 1), "0");
  assert.equal(typeof io.Transport.websocket, "function");
  assert.equal(typeof io.Transport["xhr-polling"], "function");
});

test("connecting opens the project, then fires connect and joinProjectResponse", async () => {
  const { transport } = fakeTransport();
  const { socket } = connect(transport);
  const seen: unknown[][] = [];
  socket.on("connect", () => seen.push(["connect"]));
  socket.on("joinProjectResponse", (body) => seen.push(["join", body]));
  assert.equal(socket.socket.connected, false);
  socket.socket.connect();
  assert.equal(socket.socket.connecting, true);
  await tick();
  assert.deepEqual(seen, [["connect"], ["join", JOIN]]);
  assert.equal(socket.socket.connected, true);
  assert.equal(socket.socket.connecting, false);
  assert.equal(socket.socket.sessionid, "L1");
});

test("the shim may redefine transport on the inner socket", () => {
  const { socket } = connect(fakeTransport().transport);
  let stored: unknown;
  Object.defineProperty(socket.socket, "transport", {
    get: () => stored,
    set: (v) => (stored = v),
  });
  socket.socket.transports = ["xhr-polling"];
  assert.equal(socket.socket.transport, undefined);
});

test("a failed open reports connect_failed with the reason", async () => {
  const { transport } = fakeTransport({ open: async () => ({ ok: false, message: "Sign in again." }) });
  const { socket } = connect(transport);
  const errors: unknown[] = [];
  socket.on("connect_failed", (e) => errors.push(e));
  socket.socket.connect();
  await tick();
  assert.equal(socket.socket.connected, false);
  assert.equal(socket.socket.connecting, false);
  assert.deepEqual(errors, [new Error("Sign in again.")]);
});

test("server events reach listeners with their args, in order", async () => {
  const { transport, push } = fakeTransport();
  const { socket } = connect(transport);
  const seen: unknown[][] = [];
  socket.on("otUpdateApplied", (...args) => seen.push(args));
  socket.socket.connect();
  await tick();
  push([
    { name: "otUpdateApplied", args: [{ v: 1 }] },
    { name: "otUpdateApplied", args: [{ v: 2 }, "x"] },
  ]);
  await tick();
  await tick();
  assert.deepEqual(seen, [[{ v: 1 }], [{ v: 2 }, "x"]]);
});

test("removeListener stops delivery", async () => {
  const { transport, push } = fakeTransport();
  const { socket } = connect(transport);
  const seen: unknown[] = [];
  const handler = (v: unknown) => seen.push(v);
  socket.on("removeEntity", handler);
  socket.removeListener("removeEntity", handler);
  socket.socket.connect();
  await tick();
  push([{ name: "removeEntity", args: ["id"] }]);
  await tick();
  await tick();
  assert.deepEqual(seen, []);
});

test("emits relay to the live link and the reply reaches the callback", async () => {
  const { transport, calls } = fakeTransport();
  const { socket } = connect(transport);
  socket.socket.connect();
  await tick();
  const reply = await new Promise<unknown[]>((resolve) =>
    socket.emit("applyOtUpdate", "d1", { op: [] }, (...args: unknown[]) => resolve(args)),
  );
  assert.deepEqual(reply, [null, "answer"]);
  assert.deepEqual(calls.find((c) => c[0] === "emit"), ["emit", "L1", "applyOtUpdate", ["d1", { op: [] }]]);
});

test("joinDoc does not claim history OT, which this build does not ship", async () => {
  const { transport, calls } = fakeTransport();
  const { socket } = connect(transport);
  socket.socket.connect();
  await tick();
  await new Promise((resolve) =>
    socket.emit("joinDoc", "d1", { encodeRanges: true, supportsHistoryOT: true }, resolve),
  );
  assert.deepEqual(calls.find((c) => c[0] === "emit"), ["emit", "L1", "joinDoc", ["d1", { encodeRanges: true }]]);
});

test("a refused emit gives the callback an error", async () => {
  const { transport } = fakeTransport({
    emit: async () => ({ ok: false, closed: false, message: "Overleaf did not answer in time." }),
  });
  const { socket } = connect(transport);
  socket.socket.connect();
  await tick();
  const [err] = await new Promise<unknown[]>((resolve) =>
    socket.emit("leaveDoc", "d1", (...args: unknown[]) => resolve(args)),
  );
  assert.deepEqual(err, { message: "Overleaf did not answer in time." });
});

test("pings and debug lookups are answered here, not sent", async () => {
  const { transport, calls } = fakeTransport();
  const { socket } = connect(transport);
  socket.socket.connect();
  await tick();
  socket.emit("clientPong", 1, 2);
  const host = await new Promise((resolve) => socket.emit("debug.getHostname", resolve));
  assert.equal(host, "weaveforge");
  assert.equal(calls.filter((c) => c[0] === "emit").length, 0);
});

test("a closed live link fires disconnect once and stops polling", async () => {
  const { transport, push, calls } = fakeTransport();
  const { socket } = connect(transport);
  let disconnects = 0;
  socket.on("disconnect", () => disconnects++);
  socket.socket.connect();
  await tick();
  push([{ name: "disconnect", args: [] }]);
  await tick();
  await tick();
  assert.equal(disconnects, 1);
  assert.equal(socket.socket.connected, false);
  const polls = calls.filter((c) => c[0] === "events").length;
  await tick();
  assert.equal(calls.filter((c) => c[0] === "events").length, polls);
});

test("disconnect closes the live link and fires disconnect", async () => {
  const { transport, calls } = fakeTransport();
  const { socket } = connect(transport);
  let disconnects = 0;
  socket.on("disconnect", () => disconnects++);
  socket.socket.connect();
  await tick();
  socket.disconnect();
  await tick();
  assert.equal(disconnects, 1);
  assert.equal(socket.socket.connected, false);
  assert.deepEqual(calls.find((c) => c[0] === "close"), ["close", "L1"]);
});

test("reconnecting after a disconnect opens a fresh live link", async () => {
  const { transport, calls } = fakeTransport();
  const { socket } = connect(transport);
  socket.socket.connect();
  await tick();
  socket.socket.disconnect();
  await tick();
  socket.socket.connect();
  await tick();
  assert.equal(calls.filter((c) => c[0] === "open").length, 2);
  assert.equal(socket.socket.connected, true);
});

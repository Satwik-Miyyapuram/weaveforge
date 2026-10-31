import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import {
  createPeer,
  decodeValue,
  encodeValue,
  handleLine,
  MAX_LINE,
  parseRequest,
  serve,
  type Handlers,
  type Peer,
} from "../src/wire";

test("parseRequest accepts a valid line", () => {
  assert.deepEqual(parseRequest('{"id":1,"method":"query","params":{"a":1}}'), {
    id: 1,
    method: "query",
    params: { a: 1 },
  });
});

test("parseRequest omits params when not sent", () => {
  const req = parseRequest('{"id":1,"method":"query"}');
  assert.equal(typeof req, "object");
  assert.equal("params" in (req as object), false);
});

test("parseRequest reports non-JSON", () => {
  assert.equal(parseRequest("nope"), "bad request: not JSON");
});

test("parseRequest reports wrong shape", () => {
  const shapeError = "bad request: needs an integer id and a method";
  for (const line of [
    "[]",
    "null",
    '{"id":-1,"method":"a"}',
    '{"id":1.5,"method":"a"}',
    '{"id":1,"method":""}',
    '{"method":"a"}',
  ]) {
    assert.equal(parseRequest(line), shapeError, line);
  }
});

test("handleLine ignores blank lines", async () => {
  const handlers: Handlers = {};
  assert.equal(await handleLine("", handlers), null);
  assert.equal(await handleLine("   ", handlers), null);
});

test("handleLine reports bad JSON with null id", async () => {
  assert.deepEqual(await handleLine("nope", {}), {
    id: null,
    ok: false,
    error: "bad request: not JSON",
  });
});

test("handleLine rejects __proto__ and toString as unknown methods", async () => {
  assert.deepEqual(await handleLine('{"id":3,"method":"__proto__"}', {}), {
    id: 3,
    ok: false,
    error: "unknown method: __proto__",
  });
  assert.deepEqual(await handleLine('{"id":4,"method":"toString"}', {}), {
    id: 4,
    ok: false,
    error: "unknown method: toString",
  });
});

test("handleLine returns ok with the handler value", async () => {
  const handlers: Handlers = { echo: async (params) => params };
  assert.deepEqual(await handleLine('{"id":5,"method":"echo","params":{"x":2}}', handlers), {
    id: 5,
    ok: true,
    value: { x: 2 },
  });
});

test("handleLine turns a thrown error into a reply", async () => {
  const handlers: Handlers = {
    fail: async () => {
      throw new Error("boom");
    },
  };
  assert.deepEqual(await handleLine('{"id":6,"method":"fail"}', handlers), {
    id: 6,
    ok: false,
    error: "boom",
  });
});

function collector() {
  const chunks: string[] = [];
  return { chunks, output: { write(chunk: string) { chunks.push(chunk); return true; } } };
}

test("serve replies in completion order and resolves after all writes", async () => {
  const input = new PassThrough();
  const { chunks, output } = collector();
  const handlers: Handlers = {
    slow: async () => {
      await new Promise((r) => setTimeout(r, 50));
      return "slow";
    },
    fast: async () => "fast",
  };
  const done = serve(input, output, handlers);
  input.write('{"id":1,"method":"slow"}\n');
  input.write('{"id":2,"method":"fast"}\n');
  input.end();
  await done;
  assert.equal(chunks.length, 2);
  for (const chunk of chunks) {
    assert.ok(chunk.endsWith("\n"));
    JSON.parse(chunk);
  }
  assert.equal(JSON.parse(chunks[0]!).id, 2);
  assert.equal(JSON.parse(chunks[1]!).id, 1);
});

test("serve writes undefined values as null", async () => {
  const input = new PassThrough();
  const { chunks, output } = collector();
  const handlers: Handlers = { none: async () => undefined };
  const done = serve(input, output, handlers);
  input.end('{"id":7,"method":"none"}\n');
  await done;
  assert.equal(chunks.length, 1);
  assert.ok(chunks[0]!.includes('"value":null'));
});

test("serve accepts CRLF input", async () => {
  const input = new PassThrough();
  const { chunks, output } = collector();
  const handlers: Handlers = { m: async () => "ok" };
  const done = serve(input, output, handlers);
  input.end('{"id":1,"method":"m"}\r\n');
  await done;
  assert.equal(chunks.length, 1);
  assert.equal(JSON.parse(chunks[0]!).ok, true);
});

test("serve resolves with nothing written when input is empty", async () => {
  const input = new PassThrough();
  const { chunks, output } = collector();
  const done = serve(input, output, {});
  input.end();
  await done;
  assert.deepEqual(chunks, []);
});

test("encodeValue tags bigint and bytes", () => {
  assert.equal(
    JSON.stringify({ a: 12n, b: new Uint8Array([1, 2, 255]) }, encodeValue),
    '{"a":{"$bigint":"12"},"b":{"$bytes":"AQL/"}}',
  );
});

test("decodeValue round-trips bigint and bytes", () => {
  const json = JSON.stringify({ a: 12n, b: new Uint8Array([1, 2, 255]) }, encodeValue);
  assert.deepEqual(JSON.parse(json, decodeValue), { a: 12n, b: new Uint8Array([1, 2, 255]) });
});

test("decodeValue leaves look-alike objects alone", () => {
  for (const value of [{ $bigint: "1", x: 1 }, { $bigint: "1.5" }, { $bigint: 1 }, { $bytes: 3 }, ["$bytes"]]) {
    assert.deepEqual(JSON.parse(JSON.stringify(value), decodeValue), value);
  }
});

test("parseRequest decodes $bytes params", () => {
  assert.deepEqual(parseRequest('{"id":1,"method":"m","params":[{"$bytes":"AQI="}]}'), {
    id: 1,
    method: "m",
    params: [new Uint8Array([1, 2])],
  });
});

test("serve encodes bigint values in replies", async () => {
  const input = new PassThrough();
  const { chunks, output } = collector();
  const done = serve(input, output, { n: async () => ({ n: 5n }) });
  input.end('{"id":1,"method":"n"}\n');
  await done;
  assert.ok(chunks[0]!.includes('"value":{"n":{"$bigint":"5"}}'));
});

test("serve replies with an error when a value cannot be serialised", async () => {
  const input = new PassThrough();
  const { chunks, output } = collector();
  const cyclic: any = {};
  cyclic.o = cyclic;
  const done = serve(input, output, { c: async () => cyclic });
  input.end('{"id":1,"method":"c"}\n');
  await done;
  assert.equal(chunks.length, 1);
  const reply = JSON.parse(chunks[0]!);
  assert.equal(reply.id, 1);
  assert.equal(reply.ok, false);
  assert.ok(reply.error.startsWith("reply not serialisable: "));
});

test("handleLine rejects lines over MAX_LINE without parsing", async () => {
  assert.deepEqual(await handleLine("x".repeat(MAX_LINE + 1), {}), {
    id: null,
    ok: false,
    error: "bad request: line too long",
  });
});

/** Polls until `cond` holds, at most 100 turns. */
async function until(cond: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !cond(); i++) {
    await new Promise((r) => setImmediate(r));
  }
}

function lineSink() {
  const lines: string[] = [];
  return { lines, out: { write: (c: string) => { lines.push(c); return true; } } };
}

test("ask writes one ask line and resolves with the answer's value", async () => {
  const { lines, out } = lineSink();
  const peer: Peer = createPeer(out);
  const p = peer.ask("pref.read", { name: "local-api" });
  assert.deepEqual(lines, ['{"ask":1,"method":"pref.read","params":{"name":"local-api"}}\n']);
  assert.equal(peer.settleLine('{"answer":1,"ok":true,"value":{"on":true}}'), true);
  assert.deepEqual(await p, { on: true });
});

test("asks are numbered in order", async () => {
  const { lines, out } = lineSink();
  const peer = createPeer(out);
  const a = peer.ask("m", 1);
  const b = peer.ask("m", 2);
  assert.equal(JSON.parse(lines[0]!).ask, 1);
  assert.equal(JSON.parse(lines[1]!).ask, 2);
  assert.equal(peer.settleLine('{"answer":2,"ok":true,"value":"two"}'), true);
  assert.equal(peer.settleLine('{"answer":1,"ok":true,"value":"one"}'), true);
  assert.equal(await a, "one");
  assert.equal(await b, "two");
});

test("an answer value is decoded and ask params are encoded", async () => {
  const { lines, out } = lineSink();
  const peer = createPeer(out);
  const p = peer.ask("m", { n: 7n });
  assert.equal(lines[0], '{"ask":1,"method":"m","params":{"n":{"$bigint":"7"}}}\n');
  peer.settleLine('{"answer":1,"ok":true,"value":{"$bigint":"5"}}');
  assert.equal(await p, 5n);
});

test("an error answer rejects with the shell's message", async () => {
  const { out } = lineSink();
  const peer = createPeer(out);
  const p = peer.ask("x");
  assert.equal(peer.settleLine('{"answer":1,"ok":false,"error":"refused"}'), true);
  await assert.rejects(p, { message: "refused" });
});

test("an answer nobody waits for is ignored", () => {
  const { out } = lineSink();
  const peer = createPeer(out);
  assert.equal(peer.settleLine('{"answer":9,"ok":true}'), true);
});

test("malformed answer lines are not answers", async () => {
  const { out } = lineSink();
  const peer = createPeer(out);
  const p = peer.ask("x");
  for (const line of [
    "nope",
    "[]",
    '{"answer":0,"ok":true}',
    '{"answer":1.5,"ok":true}',
    '{"answer":"1","ok":true}',
    '{"answer":1}',
    '{"answer":1,"ok":false}',
  ]) {
    assert.equal(peer.settleLine(line), false, line);
  }
  assert.equal(peer.settleLine('{"answer":1,"ok":true,"value":"good"}'), true);
  assert.equal(await p, "good");
});

test("an ask times out and a late answer is ignored", async () => {
  const { out } = lineSink();
  const peer = createPeer(out, { timeoutMs: 20 });
  await assert.rejects(peer.ask("slow.method"), { message: "ask timed out: slow.method" });
  assert.equal(peer.settleLine('{"answer":1,"ok":true,"value":1}'), true);
});

test("too many asks are refused without writing", async () => {
  const { lines, out } = lineSink();
  const peer = createPeer(out, { maxInFlight: 1 });
  const first = peer.ask("a");
  await assert.rejects(peer.ask("b"), { message: "too many asks" });
  assert.equal(lines.length, 1);
  peer.settleLine('{"answer":1,"ok":true,"value":1}');
  await first;
  const third = peer.ask("c");
  assert.equal(lines.length, 2);
  peer.settleLine('{"answer":2,"ok":true,"value":3}');
  assert.equal(await third, 3);
});

test("closeAll fails waiting and later asks", async () => {
  const { lines, out } = lineSink();
  const peer = createPeer(out);
  const a = peer.ask("a");
  const b = peer.ask("b");
  peer.closeAll("shell closed");
  await assert.rejects(a, { message: "shell closed" });
  await assert.rejects(b, { message: "shell closed" });
  await assert.rejects(peer.ask("c"), { message: "shell closed" });
  assert.equal(lines.length, 2);
  peer.emit("late");
  assert.equal(lines.length, 2);
  assert.doesNotThrow(() => peer.closeAll("again"));
});

test("emit writes an event line", () => {
  const { lines, out } = lineSink();
  const peer = createPeer(out);
  peer.emit("semanticRank", { q: "a" });
  peer.emit("ping");
  assert.deepEqual(lines, ['{"event":"semanticRank","params":{"q":"a"}}\n', '{"event":"ping"}\n']);
});

test("serve routes answers to the peer and requests to handlers", async () => {
  const input = new PassThrough();
  const { chunks, output } = collector();
  const peer = createPeer(output);
  const handlers: Handlers = { needs: async () => peer.ask("pref.read") };
  const done = serve(input, output, handlers, peer);
  input.write('{"id":1,"method":"needs"}\n');
  await until(() => chunks.length >= 1);
  assert.equal(JSON.parse(chunks[0]!).ask, 1);
  input.write('{"answer":1,"ok":true,"value":42}\n');
  await until(() => chunks.length >= 2);
  assert.equal(chunks.length, 2);
  assert.deepEqual(JSON.parse(chunks[1]!), { id: 1, ok: true, value: 42 });
  assert.ok(chunks.every((c) => !c.includes('"ok":false')));
  input.end();
  await done;
});

test("serve fails waiting asks when the shell closes stdin", async () => {
  const input = new PassThrough();
  const { chunks, output } = collector();
  const peer = createPeer(output);
  const handlers: Handlers = {
    needs: async () => {
      try {
        return await peer.ask("x");
      } catch (e) {
        return (e as Error).message;
      }
    },
  };
  const done = serve(input, output, handlers, peer);
  input.write('{"id":1,"method":"needs"}\n');
  await until(() => chunks.length >= 1);
  input.end();
  await done;
  assert.equal(chunks.length, 2);
  assert.equal(JSON.parse(chunks[1]!).value, "shell closed");
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { decodeValue, encodeValue, handleLine, MAX_LINE, parseRequest, serve, type Handlers } from "../src/wire";

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

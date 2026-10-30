import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { handleLine, parseRequest, serve, type Handlers } from "../src/wire";

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

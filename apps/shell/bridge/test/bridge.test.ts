import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeWire, encodeParam, fromBase64, toBase64 } from "../bridge";

test("toBase64 and fromBase64 convert known bytes", () => {
  assert.equal(toBase64(new Uint8Array([0, 1, 2, 255])), "AAEC/w==");
  assert.deepEqual(fromBase64("AAEC/w=="), new Uint8Array([0, 1, 2, 255]));
});

test("toBase64 and fromBase64 handle empty input", () => {
  assert.equal(toBase64(new Uint8Array([])), "");
  assert.deepEqual(fromBase64(""), new Uint8Array([]));
});

test("base64 round-trips a large value and matches Buffer", () => {
  const bytes = new Uint8Array(100_000);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 7) % 256;
  const text = toBase64(bytes);
  assert.equal(text, Buffer.from(bytes).toString("base64"));
  assert.deepEqual(fromBase64(text), bytes);
});

test("encodeParam tags Uint8Array and passes other values through", () => {
  assert.deepEqual(encodeParam(new Uint8Array([1, 2])), { $bytes: "AQI=" });
  assert.equal(encodeParam("a"), "a");
  assert.equal(encodeParam(1), 1);
  assert.equal(encodeParam(true), true);
  assert.equal(encodeParam(null), null);
});

test("decodeWire replaces $bytes and $bigint tags in nested values", () => {
  assert.deepEqual(
    decodeWire([
      { id: 1, data: { $bytes: "AQI=" }, n: { $bigint: "-9007199254740993" } },
    ]),
    [{ id: 1, data: new Uint8Array([1, 2]), n: -9007199254740993n }],
  );
  assert.deepEqual(decodeWire({ a: [{ $bytes: "" }] }), {
    a: [new Uint8Array([])],
  });
});

test("decodeWire leaves values that are not tags unchanged", () => {
  for (const value of [
    { $bytes: 1 },
    { $bigint: "1.5" },
    { $bytes: "not base64!" },
    { $bytes: "AQI=", x: 1 },
    {},
    "s",
    null,
  ]) {
    assert.deepEqual(decodeWire(value), value);
  }
});

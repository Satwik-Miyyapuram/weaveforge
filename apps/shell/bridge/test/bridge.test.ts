import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decodeWire,
  encodeParam,
  fromBase64,
  localDbBridge,
  toBase64,
  type LocalDbCommands,
} from "../bridge";

type Reply =
  | { status: "ok"; data: unknown }
  | { status: "error"; error: { message: string } };

/** Fake generated commands that record each call and answer with the given replies. */
function fakeCommands(
  replies: Partial<Record<"dbQuery" | "dbState" | "dbReset", Reply>> = {},
) {
  const calls: { cmd: string; args: unknown[] }[] = [];
  const answer =
    (cmd: keyof typeof defaults) =>
    async (...args: unknown[]) => {
      calls.push({ cmd, args });
      return replies[cmd] ?? defaults[cmd];
    };
  const defaults = {
    dbQuery: { status: "ok", data: [] } as Reply,
    dbState: {
      status: "ok",
      data: { failure: null, dataDir: "/d", restoredFrom: null },
    } as Reply,
    dbReset: { status: "ok", data: null } as Reply,
  };
  const cmds = {
    dbQuery: answer("dbQuery"),
    dbState: answer("dbState"),
    dbReset: answer("dbReset"),
  };
  return { cmds: cmds as unknown as LocalDbCommands, calls };
}

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

test("queryLocalDb sends sql and encoded params, and decodes rows", async () => {
  const { cmds, calls } = fakeCommands({
    dbQuery: {
      status: "ok",
      data: [{ id: 1, data: { $bytes: "AQI=" }, n: { $bigint: "5" } }],
    },
  });
  const db = localDbBridge(cmds);
  const rows = await db.queryLocalDb("select 1", [
    new Uint8Array([1, 2]),
    "a",
    1,
    true,
    null,
  ]);
  assert.deepEqual(calls, [
    {
      cmd: "dbQuery",
      args: ["select 1", [{ $bytes: "AQI=" }, "a", 1, true, null]],
    },
  ]);
  assert.deepEqual(rows, [{ id: 1, data: new Uint8Array([1, 2]), n: 5n }]);
});

test("queryLocalDb sends an empty params list when none are given", async () => {
  const { cmds, calls } = fakeCommands();
  await localDbBridge(cmds).queryLocalDb("select 1");
  assert.deepEqual(calls, [{ cmd: "dbQuery", args: ["select 1", []] }]);
});

test("each method rejects with the command's error message", async () => {
  const error: Reply = { status: "error", error: { message: "boom" } };
  const db = localDbBridge(
    fakeCommands({ dbQuery: error, dbState: error, dbReset: error }).cmds,
  );
  // Thunks, so each promise exists only while its rejection is awaited.
  const calls = [
    () => db.queryLocalDb("select 1"),
    () => db.localDbState(),
    () => db.resetLocalDb(),
  ];
  for (const call of calls) {
    await assert.rejects(
      call,
      (e: unknown) => e instanceof Error && e.message === "boom",
    );
  }
});

test("localDbState returns the command's data as is", async () => {
  const db = localDbBridge(fakeCommands().cmds);
  assert.deepEqual(await db.localDbState(), {
    failure: null,
    dataDir: "/d",
    restoredFrom: null,
  });
});

test("resetLocalDb resolves to undefined", async () => {
  const { cmds, calls } = fakeCommands();
  assert.equal(await localDbBridge(cmds).resetLocalDb(), undefined);
  assert.deepEqual(calls, [{ cmd: "dbReset", args: [] }]);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { pickKeysToEvict } from "../application/pdf-cache-eviction.js";

test("pickKeysToEvict drops oldest until within cap", () => {
  assert.deepEqual(
    pickKeysToEvict(
      [
        { key: "a", updatedAt: 1 },
        { key: "b", updatedAt: 3 },
        { key: "c", updatedAt: 2 },
      ],
      2,
    ),
    ["a"],
  );
  assert.deepEqual(pickKeysToEvict([{ key: "a", updatedAt: 1 }], 2), []);
});

test("pickKeysToEvict rejects invalid capacity", () => {
  assert.throws(() => pickKeysToEvict([], 0));
});

/**
 * `assertNotUnder` is the move guard report sections and vault pages share
 * (xhelp-18): a node cannot be moved under itself or a descendant.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { assertNotUnder } from "../../src/shared/tree.js";

const cycle = () => new Error("inside itself");

function lookup(parents: Record<string, string | undefined>) {
  const asked: string[] = [];
  const parentOf = async (id: string) => {
    asked.push(id);
    if (!(id in parents)) throw new Error(`missing ${id}`);
    return parents[id];
  };
  return { parentOf, asked };
}

test("a move under an unrelated node passes", async () => {
  const { parentOf } = lookup({ a: undefined, b: "a", c: undefined });
  await assertNotUnder("c", "b", parentOf, cycle);
});

test("a move under itself is refused without a lookup", async () => {
  const { parentOf, asked } = lookup({ a: undefined });
  await assert.rejects(assertNotUnder("a", "a", parentOf, cycle), /inside itself/);
  assert.deepEqual(asked, []);
});

test("a move under a child or a deep descendant is refused", async () => {
  const parents: Record<string, string | undefined> = { root: undefined };
  for (let i = 1; i <= 50; i += 1) parents[`n${i}`] = i === 1 ? "root" : `n${i - 1}`;
  const { parentOf } = lookup(parents);
  await assert.rejects(assertNotUnder("root", "n1", parentOf, cycle), /inside itself/);
  await assert.rejects(assertNotUnder("root", "n50", parentOf, cycle), /inside itself/);
  await assert.rejects(assertNotUnder("n10", "n50", parentOf, cycle), /inside itself/);
  await assertNotUnder("n50", "n10", parentOf, cycle);
});

test("an existing loop above the target is not this move's doing", async () => {
  const { parentOf, asked } = lookup({ x: "y", y: "x", m: undefined });
  await assertNotUnder("m", "x", parentOf, cycle);
  assert.deepEqual(asked, ["x", "y"]);
});

test("a self-parented node above the target ends the walk", async () => {
  const { parentOf } = lookup({ s: "s", m: undefined });
  await assertNotUnder("m", "s", parentOf, cycle);
});

test("a missing ancestor surfaces the lookup's own error", async () => {
  const { parentOf } = lookup({ b: "gone" });
  await assert.rejects(assertNotUnder("m", "b", parentOf, cycle), /missing gone/);
});

test("a null parent ends the walk like undefined", async () => {
  await assertNotUnder("m", "a", async () => null, cycle);
});

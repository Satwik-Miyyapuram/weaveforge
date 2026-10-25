import assert from "node:assert/strict";
import { test } from "node:test";

import { notifyEach } from "../notify-each";

// xlog-07: a listener's failure stays its own, but it is no longer silent.
test("every listener hears, in order, with the arguments", (t) => {
  const warn = t.mock.method(console, "warn", () => undefined);
  const heard: string[] = [];
  notifyEach([(a: string, b: number) => heard.push(`1:${a}${b}`), (a: string, b: number) => heard.push(`2:${a}${b}`)], "area", "x", 1);
  assert.deepEqual(heard, ["1:x1", "2:x1"]);
  assert.equal(warn.mock.callCount(), 0);
});

test("a listener that throws is logged with its area, and the rest still hear", (t) => {
  const warn = t.mock.method(console, "warn", () => undefined);
  const boom = new Error("listener exploded");
  const heard: string[] = [];
  notifyEach(
    new Set([
      () => {
        throw boom;
      },
      (table: string) => heard.push(table),
      () => {
        throw "not even an error";
      },
    ]),
    "workspace-changes",
    "papers",
  );
  assert.deepEqual(heard, ["papers"]);
  assert.equal(warn.mock.callCount(), 2);
  assert.deepEqual(warn.mock.calls[0]!.arguments, ["[workspace-changes] a listener failed:", boom]);
  assert.deepEqual(warn.mock.calls[1]!.arguments, ["[workspace-changes] a listener failed:", "not even an error"]);
});

test("a listener removed while others are told does not change who hears this time", (t) => {
  t.mock.method(console, "warn", () => undefined);
  const listeners = new Set<() => void>();
  const heard: string[] = [];
  const second = () => heard.push("second");
  listeners.add(() => {
    heard.push("first");
    listeners.delete(second);
    listeners.add(() => heard.push("late"));
  });
  listeners.add(second);
  notifyEach(listeners, "area");
  assert.deepEqual(heard, ["first", "second"]);
});

test("no listeners, no noise", (t) => {
  const warn = t.mock.method(console, "warn", () => undefined);
  notifyEach([], "area");
  assert.equal(warn.mock.callCount(), 0);
});

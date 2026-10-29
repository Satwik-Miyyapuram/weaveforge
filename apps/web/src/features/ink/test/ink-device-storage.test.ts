import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import { messageOf } from "../ui/error-message";
import { readStored, writeStored } from "@/lib/safe-storage";
import { readPageGap, writePageGap } from "../ui/use-page-gap";
import {
  DEFAULT_TOOL_COLOURS,
  readToolColours,
  resetToolColoursCacheForTests,
} from "../ui/use-tool-colours";

const g = globalThis as { window?: unknown };
const hadWindow = "window" in g;
const realWindow = g.window;

afterEach(() => {
  if (hadWindow) g.window = realWindow;
  else delete g.window;
});

/** A window whose localStorage is a plain map. */
function memoryWindow(seed: Record<string, string> = {}): Map<string, string> {
  const map = new Map(Object.entries(seed));
  g.window = {
    localStorage: {
      getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
      setItem: (k: string, v: string) => void map.set(k, v),
    },
  };
  return map;
}

/** A window whose storage throws, as in a blocked or private profile. */
function blockedWindow() {
  const fail = () => {
    throw new Error("SecurityError");
  };
  g.window = { localStorage: { getItem: fail, setItem: fail } };
}

test("readStored gives the saved value, and null when nothing is saved", () => {
  memoryWindow({ a: "1" });
  assert.equal(readStored("a"), "1");
  assert.equal(readStored("b"), null);
});

test("readStored gives null when storage throws or there is no window", () => {
  blockedWindow();
  assert.equal(readStored("a"), null);
  delete g.window;
  assert.equal(readStored("a"), null);
});

test("writeStored saves, and swallows a blocked store", () => {
  const map = memoryWindow();
  writeStored("a", "2");
  assert.equal(map.get("a"), "2");
  blockedWindow();
  assert.doesNotThrow(() => writeStored("a", "3"));
  delete g.window;
  assert.doesNotThrow(() => writeStored("a", "3"));
});

test("page gap: a saved gap is read back under the same key", () => {
  const map = memoryWindow();
  writePageGap("small");
  assert.equal(map.get("wf.ink.pageGap"), "small");
  assert.equal(readPageGap(), "small");
});

test("page gap: unknown, missing or blocked falls back to none", () => {
  memoryWindow({ "wf.ink.pageGap": "huge" });
  assert.equal(readPageGap(), "none");
  memoryWindow();
  assert.equal(readPageGap(), "none");
  blockedWindow();
  assert.equal(readPageGap(), "none");
  assert.doesNotThrow(() => writePageGap("small"));
});

test("tool colours: the pen's quick list migrates from its old key, and blocked storage gives the defaults", () => {
  memoryWindow({ "weaveforge.ink.quick-colours": JSON.stringify(["pink", "yellow", "text", "danger", "purple"]) });
  resetToolColoursCacheForTests();
  assert.deepEqual(readToolColours().pen.quick, ["pink", "yellow", "text", "danger", "purple"]);
  blockedWindow();
  resetToolColoursCacheForTests();
  assert.deepEqual(readToolColours(), DEFAULT_TOOL_COLOURS);
});

test("messageOf reads an Error's message and stringifies anything else", () => {
  assert.equal(messageOf(new Error("disk full")), "disk full");
  assert.equal(messageOf("plain"), "plain");
  assert.equal(messageOf(42), "42");
  assert.equal(messageOf(undefined), "undefined");
});

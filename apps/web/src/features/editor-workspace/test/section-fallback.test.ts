import { afterEach, test } from "node:test";
import assert from "node:assert/strict";

import { sectionOr } from "../application/section-fallback";

interface Log {
  level: string;
  source: string;
  message: string;
  detail?: string;
}

const g = globalThis as { window?: unknown };
afterEach(() => {
  delete g.window;
});

function captureLogs(): Log[] {
  const logs: Log[] = [];
  g.window = { weaveforge: { fetchTitle: () => Promise.resolve({}), reportAppLog: (e: Log) => void logs.push(e) } };
  return logs;
}

test("a failed section load logs once and falls back, so the section hides (28-08)", async () => {
  const logs = captureLogs();
  const result = await sectionOr(Promise.reject(new Error("503 papers")), "papers", null);
  assert.equal(result, null);
  assert.equal(logs.length, 1);
  assert.equal(logs[0]!.level, "warn");
  assert.equal(logs[0]!.source, "workspace");
  assert.match(logs[0]!.message, /papers/);
  assert.match(logs[0]!.detail ?? "", /503 papers/);
});

test("a section that loads passes through and logs nothing (28-08)", async () => {
  const logs = captureLogs();
  assert.deepEqual(await sectionOr(Promise.resolve([1, 2]), "list items", []), [1, 2]);
  assert.equal(logs.length, 0);
});

test("the fallback is returned as given, an empty array included (28-08)", async () => {
  captureLogs();
  const empty: number[] = [];
  assert.equal(await sectionOr(Promise.reject("nope"), "list items", empty), empty);
});

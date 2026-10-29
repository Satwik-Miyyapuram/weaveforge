import assert from "node:assert/strict";
import test from "node:test";
import type { Paper } from "@weaveforge/core";

import { overleafPapers } from "../ui/overleaf-papers";

const g = globalThis as { window?: unknown };

function capture() {
  const logs: { level: string; source: string; message: string; detail?: string }[] = [];
  g.window = { weaveforge: { fetchTitle: () => Promise.resolve({}), reportAppLog: (e: (typeof logs)[number]) => void logs.push(e) } };
  return logs;
}

test("the papers come through when the read succeeds", async () => {
  const logs = capture();
  try {
    const papers = [{ id: "p1" }] as unknown as Paper[];
    const result = await overleafPapers(() => Promise.resolve(papers));
    assert.equal(result.papers, papers);
    assert.equal(result.papersError, null);
    assert.equal(logs.length, 0);
  } finally {
    delete g.window;
  }
});

test("a failed read leaves no papers, says so, and logs why", async () => {
  const logs = capture();
  try {
    const result = await overleafPapers(() => Promise.reject(new Error("offline")));
    assert.deepEqual(result.papers, []);
    assert.match(result.papersError ?? "", /papers could not load/i);
    assert.equal(logs.length, 1);
    assert.equal(logs[0]!.level, "warn");
    assert.equal(logs[0]!.source, "report");
    assert.equal(logs[0]!.detail, "offline");
  } finally {
    delete g.window;
  }
});

test("a non-Error rejection is still reported", async () => {
  const logs = capture();
  try {
    const result = await overleafPapers(() => Promise.reject("nope"));
    assert.ok(result.papersError);
    assert.equal(logs[0]!.detail, "nope");
  } finally {
    delete g.window;
  }
});

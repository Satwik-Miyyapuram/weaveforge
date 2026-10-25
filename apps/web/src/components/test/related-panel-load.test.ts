import { test } from "node:test";
import assert from "node:assert/strict";

import { withAppLogs } from "@/lib/error-report/test/capture-app-logs";
import { loadRelated, type RelatedSearch } from "../related-panel";

const hit = { id: "note:a", arm: "graph", arms: ["graph", "tags"], similarity: 0.5 };
const doc = { id: "note:a", title: "A", href: "/a", kind: "note" };

function search(overrides: Partial<RelatedSearch> = {}): RelatedSearch {
  return {
    ensure: async () => ({}) as never,
    relatedHybrid: async () => [hit] as never,
    hitById: (id: string) => (id === doc.id ? (doc as never) : null),
    ...overrides,
  };
}

test("loadRelated resolves hits to their documents and drops missing ones (13-04)", async () => {
  const items = await loadRelated(
    () => search({ relatedHybrid: async () => [hit, { ...hit, id: "note:gone", arms: [] }] as never }),
    "note:seed",
    6,
    () => false,
  );
  assert.deepEqual(items, [{ id: "note:a", title: "A", href: "/a", kind: "note", arms: ["graph", "tags"], similarity: 0.5 }]);
});

test("a failed related lookup is logged and shows nothing (13-04)", async () => {
  const logs = await withAppLogs(async (logs) => {
    const items = await loadRelated(() => search({ relatedHybrid: async () => { throw new Error("index broken"); } }), "note:seed", 6, () => false);
    assert.deepEqual(items, []);
    return logs;
  });
  const entry = logs.find((log) => log.source === "related-panel");
  assert.ok(entry, JSON.stringify(logs));
  assert.equal(entry.level, "warn");
  assert.match(entry.detail ?? "", /index broken/);
});

test("a cancelled lookup stops before searching and returns null (13-04)", async () => {
  let searched = false;
  const items = await loadRelated(() => search({ relatedHybrid: async () => { searched = true; return []; } }), "note:seed", 6, () => true);
  assert.equal(items, null);
  assert.equal(searched, false);
});

test("a container that is not ready yet is logged too, not thrown (13-04)", async () => {
  const logs = await withAppLogs(async (logs) => {
    const items = await loadRelated(() => { throw new Error("App container not ready."); }, "note:seed", 6, () => false);
    assert.deepEqual(items, []);
    return logs;
  });
  assert.match(logs.find((log) => log.source === "related-panel")?.detail ?? "", /not ready/);
});

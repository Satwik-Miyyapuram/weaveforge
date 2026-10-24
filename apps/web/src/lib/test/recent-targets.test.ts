import assert from "node:assert/strict";
import test from "node:test";
import { readRecentTargets, rememberRecentTarget } from "@/lib/recent-targets";

function installStorage() {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    },
  });
}

test("recent targets are project scoped and reopen at the front", () => {
    installStorage();
    const paper = { kind: "paper" as const, id: "p1", title: "Paper", href: "/papers?paper=p1" };
    rememberRecentTarget("project-a", paper);
    rememberRecentTarget("project-a", {
      kind: "note",
      id: "n1",
      title: "Note",
      href: "/notes?page=n1",
    });
    rememberRecentTarget("project-a", paper);

    assert.deepEqual(readRecentTargets("project-a").map((item) => item.id), ["p1", "n1"]);
    assert.deepEqual(readRecentTargets("project-b"), []);
});

test("recent targets keep only the latest fifteen", () => {
    installStorage();
    for (let index = 0; index < 20; index += 1) {
      rememberRecentTarget("project", {
        kind: "paper",
        id: String(index),
        title: String(index),
        href: `/papers?paper=${index}`,
      });
    }
    assert.equal(readRecentTargets("project").length, 15);
    assert.equal(readRecentTargets("project")[0]?.id, "19");
});

test("malformed stored entries are dropped, valid ones kept (11-07)", () => {
  installStorage();
  const good = { kind: "paper", id: "p1", title: "Paper", href: "/papers?paper=p1", visitedAt: "2026-01-01T00:00:00.000Z" };
  localStorage.setItem(
    "thesis.jump-recents.project-a",
    JSON.stringify([null, 3, "x", [], { kind: "paper" }, { id: "p2" }, { kind: 1, id: "p3" }, { kind: "paper", id: 4 }, good]),
  );
  assert.deepEqual(readRecentTargets("project-a"), [good]);
  // Remembering over a corrupt list must not throw or carry the junk along.
  const next = rememberRecentTarget("project-a", { kind: "note", id: "n1", title: "N", href: "/notes?page=n1" });
  assert.deepEqual(next.map((t) => t.id), ["n1", "p1"]);
});

test("a stored non-array value reads as empty (11-07)", () => {
  installStorage();
  localStorage.setItem("thesis.jump-recents.project-a", JSON.stringify({ kind: "paper", id: "p1" }));
  assert.deepEqual(readRecentTargets("project-a"), []);
});

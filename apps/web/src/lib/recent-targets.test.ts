import assert from "node:assert/strict";
import test from "node:test";
import { readRecentTargets, rememberRecentTarget } from "./recent-targets";

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

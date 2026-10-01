import assert from "node:assert/strict";
import test from "node:test";
import { activeNavItem } from "@/registry";

const items = [
  { key: "report-sections", path: "/report" },
  { key: "report-overleaf", path: "/report/overleaf" },
];

test("deepest prefix wins, so a child path does not light its parent", () => {
  assert.equal(activeNavItem(items, "/report/overleaf")?.key, "report-overleaf");
  assert.equal(activeNavItem(items, "/report/overleaf/x")?.key, "report-overleaf");
  assert.equal(activeNavItem(items, "/report")?.key, "report-sections");
  assert.equal(activeNavItem(items, "/report/abc")?.key, "report-sections");
});

test("a sibling sharing a string prefix is not a match", () => {
  assert.equal(activeNavItem(items, "/reports"), undefined);
  assert.equal(activeNavItem(items, null), undefined);
});

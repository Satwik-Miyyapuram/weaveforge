import { test } from "node:test";
import assert from "node:assert/strict";
import type { NavItem } from "@weaveforge/core";
import { readyCore } from "@/lib/rust-core";

const NAV: NavItem[] = [
  { key: "dashboard", label: "Dashboard", path: "/" },
  { key: "papers", label: "Papers", path: "/papers" },
  { key: "report", label: "Report", path: "/report" },
  { key: "experiments", label: "Experiments", path: "/experiments" },
];

test("titleForPath: names a list route after its nav item", () => {
  assert.equal(readyCore().titleForPath("/papers", NAV), "Papers · WeaveForge");
  assert.equal(readyCore().titleForPath("/papers/", NAV), "Papers · WeaveForge");
});

test("titleForPath: a detail route takes its list's name", () => {
  assert.equal(readyCore().titleForPath("/experiments/abc", NAV), "Experiments · WeaveForge");
});

test("titleForPath: the longest match wins", () => {
  assert.equal(readyCore().titleForPath("/report/overleaf", NAV), "Overleaf · WeaveForge");
  assert.equal(readyCore().titleForPath("/report", NAV), "Report · WeaveForge");
});

test("titleForPath: routes with no nav item are still named", () => {
  assert.equal(readyCore().titleForPath("/settings", NAV), "Settings · WeaveForge");
});

test("titleForPath: the home route is the dashboard; nothing else falls back", () => {
  assert.equal(readyCore().titleForPath("/", NAV), "Dashboard · WeaveForge");
  assert.equal(readyCore().titleForPath("/nowhere", NAV), "WeaveForge");
  assert.equal(readyCore().titleForPath("/nowhere", []), "WeaveForge");
});

test("titleForPath: a sibling that only shares a prefix does not match", () => {
  assert.equal(readyCore().titleForPath("/papersx", NAV.slice(1)), "WeaveForge");
});

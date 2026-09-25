import { test } from "node:test";
import assert from "node:assert/strict";
import type { NavItem } from "@weaveforge/core";
import { titleForPath } from "@/lib/route-title";

const NAV: NavItem[] = [
  { key: "dashboard", label: "Dashboard", path: "/" },
  { key: "papers", label: "Papers", path: "/papers" },
  { key: "report", label: "Report", path: "/report" },
  { key: "experiments", label: "Experiments", path: "/experiments" },
];

test("titleForPath: names a list route after its nav item", () => {
  assert.equal(titleForPath("/papers", NAV), "Papers · WeaveForge");
  assert.equal(titleForPath("/papers/", NAV), "Papers · WeaveForge");
});

test("titleForPath: a detail route takes its list's name", () => {
  assert.equal(titleForPath("/experiments/abc", NAV), "Experiments · WeaveForge");
});

test("titleForPath: the longest match wins", () => {
  assert.equal(titleForPath("/report/overleaf", NAV), "Overleaf · WeaveForge");
  assert.equal(titleForPath("/report", NAV), "Report · WeaveForge");
});

test("titleForPath: routes with no nav item are still named", () => {
  assert.equal(titleForPath("/settings", NAV), "Settings · WeaveForge");
});

test("titleForPath: the home route is the dashboard; nothing else falls back", () => {
  assert.equal(titleForPath("/", NAV), "Dashboard · WeaveForge");
  assert.equal(titleForPath("/nowhere", NAV), "WeaveForge");
  assert.equal(titleForPath("/nowhere", []), "WeaveForge");
});

test("titleForPath: a sibling that only shares a prefix does not match", () => {
  assert.equal(titleForPath("/papersx", NAV.slice(1)), "WeaveForge");
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { groupPaletteRows, matchingPages, paletteKeys, type PaletteRow } from "../palette-groups";

const row = (group: PaletteRow["group"], key: string): PaletteRow => ({ group, key });

test("rows group under headings in a fixed order, keeping their order inside a group", () => {
  const groups = groupPaletteRows([
    row("Notes", "n1"),
    row("Papers", "p1"),
    row("Actions", "a1"),
    row("Notes", "n2"),
    row("Pages", "g1"),
    row("Recent", "r1"),
  ]);
  assert.deepEqual(
    groups.map((g) => [g.label, g.rows.map((r) => r.key)]),
    [
      ["Recent", ["r1"]],
      ["Pages", ["g1"]],
      ["Papers", ["p1"]],
      ["Notes", ["n1", "n2"]],
      ["Actions", ["a1"]],
    ],
  );
});

test("no rows, no headings", () => {
  assert.deepEqual(groupPaletteRows([]), []);
});

test("pages match on their name, and only once something is typed", () => {
  const pages = [
    { label: "Papers", path: "/papers" },
    { label: "Settings", path: "/settings" },
    { label: "Plan", path: "/plan" },
  ];
  assert.deepEqual(matchingPages(pages, ""), []);
  assert.deepEqual(matchingPages(pages, "  "), []);
  assert.deepEqual(matchingPages(pages, "SET").map((p) => p.path), ["/settings"]);
  // A name that starts with the query comes before one that only contains it.
  assert.deepEqual(matchingPages(pages, "pa").map((p) => p.path), ["/papers"]);
  assert.deepEqual(
    matchingPages([{ label: "Report", path: "/report" }, { label: "Paper map", path: "/map" }, { label: "Workspace", path: "/workspace" }], "p").map((p) => p.path),
    ["/map", "/report", "/workspace"],
  );
});

test("the footer names the arrows and the platform's own modifier", () => {
  const win = paletteKeys(false).flatMap((k) => k.keys);
  const mac = paletteKeys(true).flatMap((k) => k.keys);
  assert.ok(win.includes("↑") && win.includes("↓"), "arrows are listed");
  assert.ok(win.includes("Enter") && win.includes("Esc"));
  assert.ok(win.includes("Ctrl+K"));
  assert.ok(!win.some((k) => k.includes("Cmd") || k.includes("⌘")), "no Mac key on Windows");
  assert.ok(mac.includes("⌘K"));
  assert.ok(!mac.some((k) => k.includes("Ctrl")), "no Ctrl on a Mac");
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { commandMatches, groupPaletteRows, matchingPages, paletteKeys, paletteModeFor, type PaletteRow } from "../palette-groups";

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

const chord = (key: string, over: Partial<Parameters<typeof paletteModeFor>[0]> = {}) => ({
  key, shiftKey: false, ctrlKey: true, metaKey: false, altKey: false, ...over,
});

test("Ctrl+K and Ctrl+Shift+F open search; Ctrl+Shift+P opens commands", () => {
  assert.equal(paletteModeFor(chord("k")), "search");
  assert.equal(paletteModeFor(chord("F", { shiftKey: true })), "search");
  assert.equal(paletteModeFor(chord("P", { shiftKey: true })), "commands");
  assert.equal(paletteModeFor(chord("k", { ctrlKey: false, metaKey: true })), "search");
  // Not the palette's: no modifier, Alt, Ctrl+P (quick open), Ctrl+F (find), Ctrl+Shift+K.
  assert.equal(paletteModeFor(chord("k", { ctrlKey: false })), null);
  assert.equal(paletteModeFor(chord("k", { altKey: true })), null);
  assert.equal(paletteModeFor(chord("p")), null);
  assert.equal(paletteModeFor(chord("f")), null);
  assert.equal(paletteModeFor(chord("K", { shiftKey: true })), null);
});

test("commands mode lists every command until something is typed, then filters", () => {
  const rows = [{ label: "Settings" }, { label: "New project" }, { label: "Switch to dark theme" }];
  assert.deepEqual(commandMatches(rows, "").map((r) => r.label), ["Settings", "New project", "Switch to dark theme"]);
  assert.equal(commandMatches(rows, "  ").length, 3);
  assert.deepEqual(commandMatches(rows, "pro").map((r) => r.label), ["New project"]);
  assert.deepEqual(commandMatches(rows, "zzz"), []);
});

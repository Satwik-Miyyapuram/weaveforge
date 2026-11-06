import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// Page commands the native menu sends to the page (apps/shell/src/menu.rs) and
// the page handles (menu-edit.ts, desktop-title-bar.tsx) must spell the same
// ids. Only the edit-*, choose-workspace and search family is checked here.
const COMMAND = /"(edit-[a-z-]+|choose-workspace|search)"/g;

function commandsIn(source: string): Set<string> {
  return new Set([...source.matchAll(COMMAND)].map((match) => String(match[1])));
}

const rust = readFileSync(new URL("../../../../../../apps/shell/src/menu.rs", import.meta.url), "utf8");
const editTs = readFileSync(new URL("../menu-edit.ts", import.meta.url), "utf8");
const titleBar = readFileSync(
  new URL("../../../components/desktop-title-bar.tsx", import.meta.url),
  "utf8",
);
const tsSource = `${editTs}\n${titleBar}`;

const rustIds = commandsIn(rust);
const tsIds = commandsIn(tsSource);

test("the shell sends a non-empty set of page command ids", () => {
  assert.ok(rustIds.size > 0, "no page command literals found in menu.rs");
});

test("every id the shell sends is handled in the page", () => {
  for (const id of rustIds) {
    assert.ok(tsIds.has(id), `menu.rs sends "${id}" but no TS handler spells it`);
  }
});

test("every id the page handles is sent by the shell", () => {
  for (const id of tsIds) {
    assert.ok(rustIds.has(id), `TS handles "${id}" but menu.rs never sends it`);
  }
});

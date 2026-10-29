/** Labels carry no stray glyphs (design-errors E03, E04). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

test("share buttons have no sort glyph; ShareButton draws its own icon (E03)", () => {
  for (const file of ["../ui/experiments-screen.tsx", "../../plan/ui/plan-screen.tsx"]) {
    assert.doesNotMatch(read(file), /⇅/, file);
  }
});

test("git chip links have no literal arrow; states.css adds it once (E04)", () => {
  assert.match(read("../../../app/styles/states.css"), /a\.wf-chip\[href\]::after \{ content: "\\2197"; \}/);
  for (const m of read("../ui/experiment-panels.tsx").matchAll(/<Chip [^>]*href=[^>]*>([\s\S]*?)<\/Chip>/g)) {
    assert.doesNotMatch(m[1] ?? "", /↗/, m[0]);
  }
});

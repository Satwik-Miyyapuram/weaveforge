// At phone width the floated status select left the title a sliver between it
// and the chevron, so "Introduction" broke mid-word. On narrow screens the
// controls take their own row above the title instead of floating beside it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("section card controls stop floating on narrow screens", () => {
  const css = readFileSync(new URL("../../../app/styles/sections.css", import.meta.url), "utf8");
  assert.match(
    css,
    /@media \(max-width: 600px\) \{\s*\.section-item \.entity-card-controls \{[^}]*float: none;[^}]*justify-content: flex-end;/,
  );
});

/** The logo is the emblem alone: no tile, no border, no background. Its colours come from theme variables. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";

import { WeaveForgeLogo } from "../weave-forge-logo";

test("the logo is the emblem alone: no rect, background, border or tile", () => {
  for (const html of [renderToStaticMarkup(<WeaveForgeLogo />), renderToStaticMarkup(<WeaveForgeLogo bare />)]) {
    assert.doesNotMatch(html, /<rect/);
    assert.doesNotMatch(html, /surface2|background|border|rx="115"/);
  }
});

test("the logo paints only with theme variables, never fixed hex colours", () => {
  const html = renderToStaticMarkup(<WeaveForgeLogo />);
  assert.doesNotMatch(html, /#[0-9a-fA-F]{3,6}\b/);
  assert.match(html, /stroke="var\(--logo-ink, var\(--accent\)\)"/);
  assert.match(html, /fill="var\(--text\)"/);
});

test("the bare logo crops its viewBox to the mark", () => {
  const html = renderToStaticMarkup(<WeaveForgeLogo bare />);
  assert.match(html, /viewBox="96 96 330 330"/);
});

test("the projects first-run state shows the bare logo, sized up", () => {
  const screen = readFileSync(
    fileURLToPath(new URL("../../features/projects/ui/projects-screen.tsx", import.meta.url)),
    "utf8",
  );
  assert.match(screen, /icon=\{<WeaveForgeLogo bare className="empty-logo" \/>\}/);
  const css = readFileSync(fileURLToPath(new URL("../../app/styles/entity-cards.css", import.meta.url)), "utf8");
  assert.match(css, /\.empty-mark \.empty-logo \{[^}]*width: 70%/);
});

test("the first-run tile is dropped around the logo in every theme", () => {
  const css = readFileSync(fileURLToPath(new URL("../../app/styles/entity-cards.css", import.meta.url)), "utf8");
  assert.match(css, /\.empty-mark:has\(> \.empty-logo\) \{[^}]*border: 0[^}]*background: none/);
  const brutal = readFileSync(fileURLToPath(new URL("../../app/styles/brutal.css", import.meta.url)), "utf8");
  assert.match(brutal, /:root:root \.empty-mark:has\(> \.empty-logo\)/);
});

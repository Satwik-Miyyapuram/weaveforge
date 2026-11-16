/** The bare logo drops its own tile and crops to the mark, so it can sit large inside another tile. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";

import { WeaveForgeLogo } from "../weave-forge-logo";

test("the logo keeps its tile by default", () => {
  const html = renderToStaticMarkup(<WeaveForgeLogo />);
  assert.match(html, /<rect /);
  assert.match(html, /viewBox="0 0 512 512"/);
});

test("the bare logo has no tile and a viewBox cropped to the mark", () => {
  const html = renderToStaticMarkup(<WeaveForgeLogo bare />);
  assert.doesNotMatch(html, /<rect /);
  assert.doesNotMatch(html, /viewBox="0 0 512 512"/);
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

/** A popover's trigger is the shared Button unless it is a swatch, chip or icon (D02). */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";

import { Popover } from "../popover";

const src = (rel: string) => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), "utf8");

test("the default trigger is a secondary Button, with any extra class", () => {
  const html = renderToStaticMarkup(<Popover label="Filter" triggerClassName="account-btn">x</Popover>);
  assert.match(html, /<button type="button" [^>]*class="btn-secondary account-btn popover-trigger"/);
});

test("a custom trigger carries only its own class", () => {
  const html = renderToStaticMarkup(<Popover label="Pen" look="custom" triggerClassName="colour-menu-trigger">x</Popover>);
  assert.match(html, /class="colour-menu-trigger popover-trigger"/);
  assert.doesNotMatch(html, /btn-secondary/);
});

test("no caller writes a button class on a popover trigger by hand", () => {
  for (const rel of ["app/header-actions.tsx", "components/card-menu.tsx", "components/colour-menu.tsx", "features/ink/ui/ink-bar.tsx", "features/projects/ui/project-switcher.tsx"]) {
    assert.doesNotMatch(src(rel), /triggerClassName="[^"]*\bbtn-/, rel);
  }
  assert.match(src("components/popover.tsx"), /const Trigger = look === "button" \? Button : RowButton;/);
});

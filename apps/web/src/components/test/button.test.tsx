/** One Button and IconButton; height from the control tokens (design D02, D-03). */
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";

import { Button, IconButton } from "../button";

const css = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const html = (node: React.ReactElement) => renderToStaticMarkup(node);

test("each variant maps to its one class; default is secondary", () => {
  assert.match(html(<Button>Go</Button>), /^<button type="button" class="btn-secondary">Go<\/button>$/);
  assert.match(html(<Button variant="primary">Go</Button>), /class="btn-primary"/);
  assert.match(html(<Button variant="ghost">Go</Button>), /class="btn-ghost"/);
  assert.match(html(<Button variant="danger">Go</Button>), /class="btn-primary btn-danger"/);
});

test("sm adds the dense size; extra classes follow", () => {
  assert.match(html(<Button size="sm" className="x">Go</Button>), /class="btn-secondary btn-sm x"/);
});

test("type defaults to button, so a Button never submits by accident", () => {
  assert.match(html(<Button>Go</Button>), /type="button"/);
  assert.match(html(<Button type="submit">Go</Button>), /type="submit"/);
});

test("href renders a link, keeping link semantics", () => {
  const out = html(<Button href="/papers">Papers</Button>);
  assert.match(out, /^<a href="\/papers" class="btn-secondary">Papers<\/a>$/);
});

test("IconButton names itself from label for screen readers and hover", () => {
  const out = html(<IconButton label="Close" onClick={() => {}}><svg /></IconButton>);
  assert.match(out, /aria-label="Close"/);
  assert.match(out, /title="Close"/);
  assert.match(out, /class="icon-btn"/);
});

test("IconButton requires a label at the type level", () => {
  // @ts-expect-error label is required
  void (<IconButton><svg /></IconButton>);
});

const forms = css("../../app/styles/forms.css");
const buttons = css("../../app/styles/buttons.css");

test("buttons take their height from the control tokens (DA-10)", () => {
  assert.match(buttons, /:is\(\.btn-primary, \.btn-secondary, \.btn-ghost\) \{[^}]*min-height: var\(--control-lg\);/);
  assert.match(buttons, /:is\(\.btn-primary, \.btn-secondary, \.btn-ghost\)\.btn-sm \{[^}]*min-height: var\(--control-sm\);/);
});

test("coarse pointers get a 44px target (DA-11, G5)", () => {
  assert.match(buttons, /@media \(pointer: coarse\) \{[^}]*:is\(\.btn-primary, \.btn-secondary, \.btn-ghost, \.icon-btn\) \{ min-height: var\(--touch-min\);/);
});

test("disabled reads the same on every variant: opacity 0.5 (DA-13)", () => {
  assert.match(buttons, /:is\(\.btn-primary, \.btn-secondary, \.btn-ghost, \.icon-btn\):disabled \{ opacity: 0\.5; cursor: default; \}/);
  for (const sheet of [forms, buttons]) assert.doesNotMatch(sheet, /\.btn-(primary|secondary|ghost):disabled \{ opacity: 0\.6/);
});

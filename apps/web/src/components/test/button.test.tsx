/** One Button and IconButton; height from the control tokens (design D02, D-03). */
import assert from "node:assert/strict";
import { test } from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";

import { Button, CloseButton, IconButton, MoreButton } from "../button";

const css = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const html = (node: React.ReactElement) => renderToStaticMarkup(node);

test("each variant maps to its one class; default is secondary", () => {
  assert.match(html(<Button>Go</Button>), /^<button type="button" class="wf-btn">Go<\/button>$/);
  assert.match(html(<Button variant="primary">Go</Button>), /class="wf-btn wf-primary"/);
  assert.match(html(<Button variant="ghost">Go</Button>), /class="wf-btn wf-ghost"/);
  assert.match(html(<Button variant="cancel">Cancel</Button>), /class="wf-btn wf-danger-ghost"/);
  assert.match(html(<Button variant="danger">Delete</Button>), /class="wf-btn wf-danger"/);
});

test("sm adds the dense size", () => {
  assert.match(html(<Button size="sm">Go</Button>), /class="wf-btn wf-sm"/);
  assert.match(html(<Button size="sm" variant="cancel">Go</Button>), /class="wf-btn wf-danger-ghost wf-sm"/);
});

test("a caller cannot add a class, so no screen invents its own button", () => {
  // @ts-expect-error className is not a Button prop
  void (<Button className="x">Go</Button>);
  // @ts-expect-error className is not an IconButton prop
  void (<IconButton label="x" className="x"><svg /></IconButton>);
  const smuggled = { className: "x" } as object;
  assert.match(html(<Button {...smuggled}>Go</Button>), /class="wf-btn"/);
  assert.match(html(<IconButton label="x" {...smuggled}><svg /></IconButton>), /class="wf-btn wf-icon"/);
});

test("type defaults to button, so a Button never submits by accident", () => {
  assert.match(html(<Button>Go</Button>), /type="button"/);
  assert.match(html(<Button type="submit">Go</Button>), /type="submit"/);
});

test("href renders a link, keeping link semantics", () => {
  const out = html(<Button href="/papers">Papers</Button>);
  assert.match(out, /^<a [^>]*>Papers<\/a>$/);
  assert.match(out, / href="\/papers"/);
  assert.match(out, / class="wf-btn"/);
});

test("IconButton names itself from label for screen readers and hover", () => {
  const out = html(<IconButton label="Close" onClick={() => {}}><svg /></IconButton>);
  assert.match(out, /aria-label="Close"/);
  assert.match(out, /title="Close"/);
  assert.match(out, /class="wf-btn wf-icon"/);
});

test("IconButton's danger tone is red-tinted; sm is the dense size", () => {
  assert.match(html(<IconButton label="x" tone="danger"><svg /></IconButton>), /class="wf-btn wf-icon wf-danger-ghost"/);
  assert.match(html(<IconButton label="x" size="sm"><svg /></IconButton>), /class="wf-btn wf-icon wf-sm"/);
  assert.match(html(<IconButton label="x" tone="danger" size="sm"><svg /></IconButton>), /class="wf-btn wf-icon wf-danger-ghost wf-sm"/);
});

test("IconButton requires a label at the type level", () => {
  // @ts-expect-error label is required
  void (<IconButton><svg /></IconButton>);
});

test("CloseButton is the one red × and is named Close by default", () => {
  const out = html(<CloseButton onClick={() => {}} />);
  assert.match(out, /class="wf-btn wf-icon wf-danger-ghost"/);
  assert.match(out, /aria-label="Close"/);
  assert.match(out, /<path d="M6 6l12 12M18 6 6 18"/);
  assert.match(html(<CloseButton label="Remove tag" size="sm" />), /aria-label="Remove tag"[^>]*class="wf-btn wf-icon wf-danger-ghost wf-sm"/);
});

test("MoreButton is the one three-dot button", () => {
  const out = html(<MoreButton />);
  assert.match(out, /class="wf-btn wf-icon"/);
  assert.match(out, /aria-label="More actions"/);
  assert.equal(out.match(/<circle /g)?.length, 3);
});

const forms = css("../../app/styles/forms.css");
const buttons = css("../../app/styles/buttons.css");

test("buttons take their height from the control tokens (DA-10)", () => {
  assert.match(buttons, /\.wf-btn \{[^}]*min-height: var\(--control-lg\);/);
  assert.match(buttons, /\.wf-btn\.wf-sm \{[^}]*min-height: var\(--control-sm\);/);
});

test("coarse pointers get a 44px target (DA-11, G5)", () => {
  assert.match(buttons, /@media \(pointer: coarse\) \{[^}]*\.wf-btn \{ min-height: var\(--touch-min\);/);
});

test("disabled reads the same on every kind: one rule, opacity .5 (DA-13)", () => {
  const states = css("../../app/styles/states.css");
  assert.match(states, /:root:root :is\(\.wf-btn, [^{]*\):is\(:disabled, \[aria-disabled="true"\]\) \{\s*opacity: \.5; cursor: not-allowed;/);
  // Form inputs (radios) are not buttons and keep their own dim.
  for (const sheet of [forms, buttons]) assert.doesNotMatch(sheet, /^(?!input)[^{}\n]*:disabled[^{]*\{[^}]*opacity/m);
});

/** Every .tsx under src, minus tests: the source that renders buttons. */
function sourceFiles(dir = fileURLToPath(new URL("../../", import.meta.url))): { rel: string; text: string }[] {
  const out: { rel: string; text: string }[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "test" && entry.name !== "node_modules") out.push(...sourceFiles(full));
    } else if (entry.name.endsWith(".tsx")) {
      out.push({ rel: full.replace(/\\/g, "/").split("/src/").pop()!, text: readFileSync(full, "utf8") });
    }
  }
  return out;
}

test("no button is labelled with a bare text glyph; icons are SVG (DA-82)", () => {
  const glyphOnly = /<(?:button|Button|IconButton)\b(?:[^<>=]|=(?:>|(?!>))|<(?:=|(?!=))|>=)*>\s*[-−+‹›✕×⋯⇅☰]\s*<\/(?:button|Button|IconButton)>/g;
  const hits = sourceFiles().flatMap(({ rel, text }) => [...text.matchAll(glyphOnly)].map(() => rel));
  assert.deepEqual(hits, []);
});

test("no label carries the ⇅ glyph (DA-80)", () => {
  const hits = sourceFiles().filter(({ text }) => text.includes("⇅")).map(({ rel }) => rel);
  assert.deepEqual(hits, []);
});

test("one rule draws the link arrow, so a chip never shows two (DA-81)", () => {
  const styles = fileURLToPath(new URL("../../app/styles/", import.meta.url));
  const arrowRules = readdirSync(styles)
    .filter((name) => name.endsWith(".css"))
    .flatMap((name) => (readFileSync(join(styles, name), "utf8").match(/content: "(↗|\\2197)"/g) ?? []).map(() => name));
  assert.deepEqual(arrowRules, ["states.css"]);
});

test("only a linked chip gets the arrow; an in-page jump chip is a button (DA-83)", () => {
  const states = css("../../app/styles/states.css");
  assert.match(states, /a\.wf-chip\[href\]::after \{ content: "\\2197"; \}/);
});

test("the link variant is a button that reads as inline text", () => {
  assert.match(html(<Button variant="link">Open</Button>), /^<button type="button" class="wf-link">Open<\/button>$/);
});

test("href goes through Anchor (next/link inside), so moving between pages stays client-side", () => {
  assert.match(css("../button.tsx"), /import \{ Anchor \} from "\.\/anchor";/);
  assert.match(css("../anchor.tsx"), /import Link from "next\/link";/);
  const out = html(<Button href="https://example.org" target="_blank" rel="noreferrer">Docs</Button>);
  for (const attr of [/ href="https:\/\/example.org"/, / target="_blank"/, / rel="noreferrer"/, / class="wf-btn"/]) assert.match(out, attr);
});

test("IconButton's tip adds to the hover text without changing its name", () => {
  const out = html(<IconButton label="Undo" tip="Undo (Ctrl+Z)"><svg /></IconButton>);
  assert.match(out, /aria-label="Undo"/);
  assert.match(out, /title="Undo \(Ctrl\+Z\)"/);
});

test("a link button wipes the browser's button box, so it reads as inline text", () => {
  const states = css("../../app/styles/states.css");
  const i = states.indexOf(":root:root .wf-link {");
  const rule = states.slice(i, states.indexOf("}", i));
  for (const p of [/background: none;/, /border: 0;/, /padding: 0;/, /font: inherit;/, /text-align: inherit;/]) assert.match(rule, p);
});

test("a select trigger draws one arrow: the catalogue's, never a second icon inside it", () => {
  assert.match(css("../../app/styles/states.css"), /:root:root \.wf-select::after \{/);
  for (const f of ["select", "multi-select", "date-picker", "popover"]) {
    const src = readFileSync(fileURLToPath(new URL(`../${f}.tsx`, import.meta.url)), "utf8");
    for (const m of src.matchAll(/<ComboboxButton[\s\S]*?<\/ComboboxButton>/g)) {
      assert.doesNotMatch(m[0], /Chevron|className="chev|<svg/, `${f}.tsx draws its own arrow`);
    }
  }
});

test("a link button is plain text at rest; the underline shows only on hover or focus", () => {
  const states = css("../../app/styles/states.css");
  const i = states.indexOf(":root:root .wf-link {");
  assert.match(states.slice(i, states.indexOf("}", i)), /text-decoration: none;/);
  assert.match(states, /:root:root \.wf-link:is\(:hover, :focus-visible, \[data-force~="hover"\]\) \{[^}]*text-decoration: underline;/);
});

test("a select trigger sizes to its content, so a card's status pill stays small", () => {
  assert.doesNotMatch(css("../../app/styles/states.css"), /\.wf-select \{ min-width: 160px; \}/);
});

test("the chosen row of a status menu is painted in its status colour", () => {
  assert.match(css("../../app/styles/states.css"), /:root:root \.wf-item\[aria-selected="true"\]\[data-status\] \{ background: var\(--status-chip\); color: var\(--status-ink\); \}/);
});

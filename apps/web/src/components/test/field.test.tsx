/** Field and SortHeader primitives (design D15, DA-73, DA-131). */
import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { Field } from "../field";
import { SortHeader } from "../sort-header";

const attr = (html: string, tag: string, name: string) =>
  html.match(new RegExp(`<${tag}[^>]*\\s${name}="([^"]*)"`))?.[1];

test("the label points at the control by id", () => {
  const out = renderToStaticMarkup(
    <Field label="Token name">
      <input />
    </Field>,
  );
  const id = attr(out, "input", "id");
  assert.ok(id, "the control got an id");
  assert.equal(attr(out, "label", "for"), id);
  assert.match(out, /<label[^>]*>Token name<\/label>/);
});

test("an id the caller gave the control is kept", () => {
  const out = renderToStaticMarkup(
    <Field label="Name">
      <input id="mine" />
    </Field>,
  );
  assert.equal(attr(out, "label", "for"), "mine");
  assert.equal(attr(out, "input", "id"), "mine");
});

test("the hint and the error describe the control, and an error marks it invalid", () => {
  const out = renderToStaticMarkup(
    <Field label="Name" hint="Shown in the list" error="Name is taken">
      <input />
    </Field>,
  );
  const hintId = attr(out, "p", "id");
  const ids = attr(out, "input", "aria-describedby")?.split(" ") ?? [];
  assert.equal(ids.length, 2);
  assert.equal(ids[0], hintId);
  assert.match(out, new RegExp(`<p[^>]*id="${ids[1]}"[^>]*role="alert"[^>]*>Name is taken</p>`));
  assert.equal(attr(out, "input", "aria-invalid"), "true");
});

test("no hint and no error: nothing describes the control and it is not invalid", () => {
  const out = renderToStaticMarkup(
    <Field label="Name">
      <input />
    </Field>,
  );
  assert.doesNotMatch(out, /aria-describedby|aria-invalid|role="alert"/);
});

test("a sort header says its direction to assistive tech and draws an icon, not a glyph", () => {
  const row = (el: React.ReactNode) => renderToStaticMarkup(<table><thead><tr>{el}</tr></thead></table>);
  const asc = row(<SortHeader label="Year" active dir="asc" onSort={() => {}} />);
  assert.match(asc, /<th[^>]*aria-sort="ascending"/);
  assert.match(asc, /<button type="button" class="wf-link">Year<svg[^>]*aria-hidden="true"/);
  assert.doesNotMatch(asc, /[▲▼↕]/);
  const desc = row(<SortHeader label="Year" active dir="desc" onSort={() => {}} />);
  assert.match(desc, /aria-sort="descending"/);
  const idle = row(<SortHeader label="Year" active={false} dir="desc" onSort={() => {}} />);
  assert.match(idle, /aria-sort="none"/);
  assert.doesNotMatch(idle, /sort-btn--on/);
});

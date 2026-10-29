/** A popover's trigger is one catalogue look, chosen by name; its open state is aria-expanded (D02). */
import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { Popover } from "../popover";

const html = (node: React.ReactElement) => renderToStaticMarkup(node);
/** The trigger's opening tag, so attribute order does not matter. */
const tag = (out: string) => out.match(/<button[^>]*>/)?.[0] ?? "";

test("the default trigger is a secondary button with a caret", () => {
  const out = html(<Popover label="Filter">x</Popover>);
  assert.match(tag(out), /class="wf-btn"/);
  assert.match(tag(out), /aria-expanded="false"/);
  assert.match(tag(out), /aria-haspopup="dialog"/);
  assert.match(out, /popover-caret/);
});

test("an icon trigger is a square icon button named by ariaLabel, with no caret", () => {
  const out = html(<Popover label={<svg />} trigger="icon" ariaLabel="Account">x</Popover>);
  for (const attr of ['class="wf-btn wf-icon"', 'aria-label="Account"', 'title="Account"']) assert.ok(tag(out).includes(attr), attr);
  assert.doesNotMatch(out, /popover-caret/);
});

test("a button trigger without a caret is the same secondary button, named and tipped by ariaLabel", () => {
  // The account button: the chip's own look beside it, so the pair rests and lifts alike.
  const out = html(<Popover label={<svg />} caret={false} ariaLabel="Account">x</Popover>);
  for (const attr of ['class="wf-btn"', 'aria-label="Account"', 'title="Account"']) assert.ok(tag(out).includes(attr), attr);
  assert.doesNotMatch(out, /popover-caret/);
});

test("a swatch trigger is painted with its colour", () => {
  const out = html(<Popover label={null} trigger="swatch" colour="#ff0000" ariaLabel="Pen colour">x</Popover>);
  for (const attr of ['class="wf-swatch"', 'style="background:#ff0000"', 'aria-label="Pen colour"']) assert.ok(tag(out).includes(attr), attr);
  // It opens a menu; it is not an on/off toggle.
  assert.doesNotMatch(tag(out), /aria-pressed/);
});

test("a select trigger is a select field, which draws its own arrow", () => {
  const out = html(<Popover label="Project" trigger="select">x</Popover>);
  assert.match(tag(out), /class="wf-select"/);
  assert.match(tag(out), /aria-haspopup="dialog"/);
  assert.doesNotMatch(out, /popover-caret/);
});

test("a caller cannot class the trigger", () => {
  // @ts-expect-error the trigger's look is chosen by `trigger`, not a class
  void (<Popover label="x" triggerClassName="account-btn">x</Popover>);
});

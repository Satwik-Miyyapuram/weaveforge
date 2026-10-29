/**
 * The button primitives besides Button and IconButton (design D02): each kind of
 * clickable control has one component that owns its type, role, ARIA state and
 * catalogue class, so no screen writes a raw <button> or a button class.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  Chip,
  ComboboxButton,
  FoldButton,
  MenuItemButton,
  MenuItemLink,
  NavLink,
  OptionButton,
  RadioButton,
  RowButton,
  Swatch,
  Switch,
  TabButton,
  ToggleButton,
  ToolButton,
} from "../controls";

const html = (node: React.ReactElement) => renderToStaticMarkup(node);
const noop = () => {};

test("every button primitive is type=button, so none submits a form by accident", () => {
  for (const node of [
    <RowButton key="r">Row</RowButton>,
    <ToolButton key="t" label="Pen"><svg /></ToolButton>,
    <MenuItemButton key="m">Item</MenuItemButton>,
    <TabButton key="tb" selected={false}>Tab</TabButton>,
    <Swatch key="sw" label="Red" selected={false} />,
    <ToggleButton key="tg" pressed={false}>Day</ToggleButton>,
    <FoldButton key="f" expanded={false}>Section</FoldButton>,
  ]) {
    assert.match(html(node), /^<button type="button"/);
  }
});

test("each primitive draws its one catalogue kind", () => {
  assert.match(html(<RowButton>Paper</RowButton>), /class="wf-row"/);
  assert.match(html(<ToolButton label="Pen"><svg /></ToolButton>), /class="wf-tool"/);
  assert.match(html(<MenuItemButton>Open</MenuItemButton>), /class="wf-item"/);
  assert.match(html(<MenuItemButton danger>Delete</MenuItemButton>), /class="wf-item wf-danger"/);
  assert.match(html(<TabButton selected>Notes</TabButton>), /class="wf-tab"/);
  assert.match(html(<Swatch label="Red" selected={false} />), /class="wf-swatch"/);
  assert.match(html(<OptionButton selected>Apple</OptionButton>), /class="wf-item"/);
  assert.match(html(<ComboboxButton expanded={false}>Pick</ComboboxButton>), /class="wf-select"/);
  assert.match(html(<FoldButton expanded>Section</FoldButton>), /class="wf-fold"/);
  assert.match(html(<NavLink href="/papers">Papers</NavLink>), /class="wf-nav"/);
  assert.match(html(<Switch checked label="On" onChange={noop} />), /class="wf-toggle"/);
});

test("a segment option carries no class; the .wf-seg parent draws it", () => {
  assert.equal(html(<ToggleButton pressed>Cards</ToggleButton>), '<button type="button" aria-pressed="true">Cards</button>');
  assert.equal(html(<RadioButton checked={false}>Cloud</RadioButton>), '<button type="button" role="radio" aria-checked="false">Cloud</button>');
});

test("no primitive takes a caller's class", () => {
  // @ts-expect-error className is not a primitive prop
  void (<RowButton className="x">Row</RowButton>);
  // @ts-expect-error className is not a primitive prop
  void (<ToolButton className="x" />);
  // @ts-expect-error className is not a primitive prop
  void (<Swatch label="Red" selected className="x" />);
  // @ts-expect-error className is not a primitive prop
  void (<NavLink href="/" className="x">Home</NavLink>);
  const smuggled = { className: "x" } as object;
  assert.match(html(<RowButton {...smuggled}>Row</RowButton>), /class="wf-row"/);
});

test("RowButton marks the current row", () => {
  assert.match(html(<RowButton current>Paper</RowButton>), /aria-current="true"/);
  assert.doesNotMatch(html(<RowButton>Paper</RowButton>), /aria-current/);
});

test("ToolButton: label names it, tip adds the shortcut to the hover text", () => {
  const out = html(<ToolButton label="Undo" tip="Undo (Ctrl+Z)"><svg /></ToolButton>);
  assert.match(out, /aria-label="Undo"/);
  assert.match(out, /title="Undo \(Ctrl\+Z\)"/);
  assert.match(html(<ToolButton label="Pen"><svg /></ToolButton>), /title="Pen"/);
});

test("ToolButton is a toggle only when pressed is given", () => {
  assert.match(html(<ToolButton label="Pen" pressed><svg /></ToolButton>), /aria-pressed="true"/);
  assert.match(html(<ToolButton label="Pen" pressed={false}><svg /></ToolButton>), /aria-pressed="false"/);
  assert.doesNotMatch(html(<ToolButton label="Undo"><svg /></ToolButton>), /aria-pressed/);
});

test("a text tool shows its words and needs no aria-label", () => {
  const out = html(<ToolButton tip="Copy the selected strokes">Copy</ToolButton>);
  assert.doesNotMatch(out, /aria-label/);
  assert.match(out, /title="Copy the selected strokes"/);
});

test("MenuItemButton takes the menu role for its kind and says whether it is checked", () => {
  assert.match(html(<MenuItemButton>Open</MenuItemButton>), /role="menuitem"/);
  assert.doesNotMatch(html(<MenuItemButton>Open</MenuItemButton>), /aria-checked/);
  assert.match(html(<MenuItemButton kind="radio" checked>Pen</MenuItemButton>), /role="menuitemradio"[^>]*aria-checked="true"/);
  assert.match(html(<MenuItemButton kind="checkbox" checked={false}>Grid</MenuItemButton>), /role="menuitemcheckbox"[^>]*aria-checked="false"/);
});

test("MenuItemLink is a menu entry that navigates, drawn as the same wf-item", () => {
  assert.equal(html(<MenuItemLink href="/settings">Settings</MenuItemLink>), '<a role="menuitem" class="wf-item" href="/settings">Settings</a>');
  assert.match(html(<MenuItemLink href="https://x.org" target="_blank" rel="noreferrer">Docs</MenuItemLink>), / target="_blank"/);
});

test("TabButton is a tab that says whether it is selected", () => {
  assert.match(html(<TabButton selected>Notes</TabButton>), /role="tab"[^>]*aria-selected="true"/);
  assert.match(html(<TabButton selected={false}>Notes</TabButton>), /aria-selected="false"/);
});

test("Switch is a checkbox with the switch role and a name, and reports the new state", () => {
  assert.equal(
    html(<Switch checked label="Enable access" onChange={noop} />),
    '<input type="checkbox" role="switch" aria-label="Enable access" class="wf-toggle" checked=""/>',
  );
  assert.doesNotMatch(html(<Switch checked={false} label="Enable access" onChange={noop} />), /checked=""/);
  assert.match(html(<Switch checked={false} disabled label="x" onChange={noop} />), /disabled=""/);
});

test("Swatch names its colour, says when it is chosen, and paints it", () => {
  const out = html(<Swatch label="Ink colour: red" selected colour="#e11" />);
  assert.match(out, /aria-label="Ink colour: red"/);
  assert.match(out, /title="Ink colour: red"/);
  assert.match(out, /aria-pressed="true"/);
  assert.match(out, /style="background:#e11"/);
});

test("labels are required where the control has no words of its own", () => {
  // @ts-expect-error a swatch has no text, so it needs a label
  void (<Swatch selected={false} />);
  // @ts-expect-error a switch has no text, so it needs a label
  void (<Switch checked onChange={noop} />);
  // @ts-expect-error a tab says whether it is selected
  void (<TabButton>Notes</TabButton>);
});

test("OptionButton is one row of a listbox and says whether it is selected", () => {
  assert.match(html(<OptionButton selected>Apple</OptionButton>), /role="option" aria-selected="true"/);
  assert.match(html(<OptionButton selected={false} tabIndex={-1}>Pear</OptionButton>), /role="option" aria-selected="false" tabindex="-1"/);
});

test("RadioButton says whether it is checked", () => {
  assert.match(html(<RadioButton checked aria-label="Red" />), /role="radio" aria-checked="true" aria-label="Red"/);
});

test("ComboboxButton opens a listbox and says whether it is open", () => {
  assert.match(html(<ComboboxButton expanded={false}>Pick</ComboboxButton>), /role="combobox" aria-expanded="false"/);
  assert.match(html(<ComboboxButton expanded aria-controls="lb" />), /role="combobox" aria-expanded="true" aria-controls="lb"/);
});

test("Chip is a plain pill, a pressed filter, or a link", () => {
  assert.equal(html(<Chip>ml</Chip>), '<span class="wf-chip">ml</span>');
  assert.equal(html(<Chip onClick={noop} pressed>ml</Chip>), '<button type="button" aria-pressed="true" class="wf-chip">ml</button>');
  assert.match(html(<Chip href="/tags/ml">ml</Chip>), /^<a class="wf-chip" href="\/tags\/ml">ml<\/a>$/);
});

test("Chip's remove × is the red chip-x, named for screen readers", () => {
  const out = html(<Chip onRemove={noop} removeLabel="Remove ml">ml</Chip>);
  assert.match(out, /^<span class="wf-chip">ml<button type="button" class="wf-chip-x" aria-label="Remove ml" title="Remove ml"><svg/);
  assert.match(html(<Chip onRemove={noop}>ml</Chip>), /aria-label="Remove"/);
});

test("FoldButton says whether its section is open, and shows a count", () => {
  const out = html(<FoldButton expanded count={3}>Papers</FoldButton>);
  assert.match(out, /aria-expanded="true"/);
  assert.match(out, /<span class="chev chev-flip"/);
  assert.match(out, /Papers<span class="wf-fold-count">3<\/span><\/button>$/);
  assert.doesNotMatch(html(<FoldButton expanded={false}>Papers</FoldButton>), /wf-fold-count/);
});

test("NavLink marks the page you are on", () => {
  assert.match(html(<NavLink href="/papers" current>Papers</NavLink>), /aria-current="page"/);
  assert.doesNotMatch(html(<NavLink href="/papers">Papers</NavLink>), /aria-current/);
});

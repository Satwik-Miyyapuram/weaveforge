/**
 * The button primitives besides Button and IconButton (design D02): each kind of
 * clickable control has one component that owns its type, role and ARIA state,
 * so no screen writes a raw <button>.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  ComboboxButton,
  MenuItemButton,
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

test("every primitive is type=button, so none submits a form by accident", () => {
  for (const node of [
    <RowButton key="r">Row</RowButton>,
    <ToolButton key="t" label="Pen"><svg /></ToolButton>,
    <MenuItemButton key="m">Item</MenuItemButton>,
    <TabButton key="tb" selected={false}>Tab</TabButton>,
    <Switch key="s" checked={false} label="On" />,
    <Swatch key="sw" label="Red" selected={false} />,
    <ToggleButton key="tg" pressed={false}>Chip</ToggleButton>,
  ]) {
    assert.match(html(node), /^<button type="button"/);
  }
});

test("RowButton keeps the caller's class and marks the current row", () => {
  assert.equal(html(<RowButton className="quick-open-result">Paper</RowButton>), '<button type="button" class="quick-open-result">Paper</button>');
  assert.match(html(<RowButton current>Paper</RowButton>), /aria-current="true"/);
  assert.doesNotMatch(html(<RowButton>Paper</RowButton>), /aria-current/);
});

test("ToolButton is an ink-tool; label names it, tip adds the shortcut to the hover text", () => {
  const out = html(<ToolButton label="Undo" tip="Undo (Ctrl+Z)" className="ink-tool-icon-only"><svg /></ToolButton>);
  assert.match(out, /aria-label="Undo"/);
  assert.match(out, /title="Undo \(Ctrl\+Z\)"/);
  assert.match(out, /class="ink-tool ink-tool-icon-only"/);
  assert.match(html(<ToolButton label="Pen"><svg /></ToolButton>), /title="Pen"/);
});

test("ToolButton is a toggle only when pressed is given", () => {
  assert.match(html(<ToolButton label="Pen" pressed><svg /></ToolButton>), /aria-pressed="true"/);
  assert.match(html(<ToolButton label="Pen" pressed={false}><svg /></ToolButton>), /aria-pressed="false"/);
  assert.doesNotMatch(html(<ToolButton label="Undo"><svg /></ToolButton>), /aria-pressed/);
});

test("a text tool shows its words and needs no aria-label", () => {
  const out = html(<ToolButton tip="Copy the selected strokes" className="ink-tool-text">Copy</ToolButton>);
  assert.doesNotMatch(out, /aria-label/);
  assert.match(out, /title="Copy the selected strokes"/);
});

test("MenuItemButton takes the menu role for its kind and says whether it is checked", () => {
  assert.match(html(<MenuItemButton>Open</MenuItemButton>), /role="menuitem"/);
  assert.doesNotMatch(html(<MenuItemButton>Open</MenuItemButton>), /aria-checked/);
  assert.match(html(<MenuItemButton kind="radio" checked>Pen</MenuItemButton>), /role="menuitemradio"[^>]*aria-checked="true"/);
  assert.match(html(<MenuItemButton kind="checkbox" checked={false}>Grid</MenuItemButton>), /role="menuitemcheckbox"[^>]*aria-checked="false"/);
});

test("TabButton is a tab that says whether it is selected", () => {
  assert.match(html(<TabButton selected>Notes</TabButton>), /role="tab"[^>]*aria-selected="true"/);
  assert.match(html(<TabButton selected={false}>Notes</TabButton>), /aria-selected="false"/);
});

test("Switch is the one on/off toggle: role switch, the knob, and a name", () => {
  assert.equal(
    html(<Switch checked label="Enable access" />),
    '<button type="button" role="switch" aria-checked="true" aria-label="Enable access" class="toggle on"><span class="knob"></span></button>',
  );
  assert.match(html(<Switch checked={false} label="Enable access" />), /aria-checked="false" aria-label="Enable access" class="toggle"/);
});

test("Swatch names its colour for screen readers and hover, and says when it is chosen", () => {
  const out = html(<Swatch label="Ink colour: red" selected className="ink-swatch ink-swatch-red" />);
  assert.match(out, /aria-label="Ink colour: red"/);
  assert.match(out, /title="Ink colour: red"/);
  assert.match(out, /aria-pressed="true"/);
  assert.match(out, /class="ink-swatch ink-swatch-red"/);
});

test("ToggleButton is a pressed/unpressed button for chips and filters", () => {
  assert.match(html(<ToggleButton pressed className="tag-chip">ml</ToggleButton>), /aria-pressed="true" class="tag-chip"/);
  assert.match(html(<ToggleButton pressed={false}>ml</ToggleButton>), /aria-pressed="false"/);
});

test("labels are required where the control has no words of its own", () => {
  // @ts-expect-error a swatch has no text, so it needs a label
  void (<Swatch selected={false} />);
  // @ts-expect-error a switch has no text, so it needs a label
  void (<Switch checked />);
  // @ts-expect-error a tab says whether it is selected
  void (<TabButton>Notes</TabButton>);
});

test("OptionButton is one row of a listbox and says whether it is selected", () => {
  assert.equal(html(<OptionButton selected>Apple</OptionButton>), '<button type="button" role="option" aria-selected="true">Apple</button>');
  assert.match(html(<OptionButton selected={false} tabIndex={-1}>Pear</OptionButton>), /role="option" aria-selected="false" tabindex="-1"/);
});

test("RadioButton is one choice of a radiogroup and says whether it is checked", () => {
  assert.equal(html(<RadioButton checked={false}>Cloud</RadioButton>), '<button type="button" role="radio" aria-checked="false">Cloud</button>');
  assert.match(html(<RadioButton checked aria-label="Red" />), /role="radio" aria-checked="true" aria-label="Red"/);
});

test("ComboboxButton opens a listbox and says whether it is open", () => {
  assert.equal(html(<ComboboxButton expanded={false}>Pick</ComboboxButton>), '<button type="button" role="combobox" aria-expanded="false">Pick</button>');
  assert.match(html(<ComboboxButton expanded aria-controls="lb" />), /role="combobox" aria-expanded="true" aria-controls="lb"/);
});

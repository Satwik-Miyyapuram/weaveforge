import { before, test } from "node:test";
import assert from "node:assert/strict";
import type { DesktopMenuGroup, DesktopMenuItem } from "@/lib/desktop/desktop-bridge";
import { loadTestCore } from "@/lib/test/load-test-core";
import { DOCS_URL, menuPaletteActions, nextShortcutsOpen, settingsPaletteActions } from "../parts-2";

before(loadTestCore);

const item = (id: string, label: string, enabled = true): DesktopMenuItem => ({
  id,
  kind: "item",
  label,
  accelerator: null,
  enabled,
});

const menu: DesktopMenuGroup[] = [
  {
    label: "File",
    items: [
      item("info:workspace", "Workspace: vault", false),
      item("action:show-in-explorer", "Show in file explorer"),
      item("action:choose-workspace", "Change workspace folder…"),
      item("route:/settings", "Settings"),
    ],
  },
  {
    label: "Help",
    items: [
      item("action:docs", "Documentation"),
      item("page:shortcuts", "Keyboard shortcuts"),
      item("action:check-updates", "Check for updates…"),
    ],
  },
];

test("the palette offers the shell's workspace, docs and update entries by id, without the ellipsis", () => {
  assert.deepEqual(menuPaletteActions(menu), [
    { id: "action:check-updates", label: "Check for updates" },
    { id: "action:docs", label: "Documentation" },
    { id: "action:show-in-explorer", label: "Show in file explorer" },
    { id: "action:choose-workspace", label: "Change workspace folder" },
  ]);
});

test("no workspace folder: only the choose entry, under its own label", () => {
  const bare: DesktopMenuGroup[] = [
    { label: "File", items: [item("action:choose-workspace", "Choose workspace folder…")] },
  ];
  assert.deepEqual(menuPaletteActions(bare), [{ id: "action:choose-workspace", label: "Choose workspace folder" }]);
});

test("disabled entries and a missing menu (browser, macOS) give no menu actions", () => {
  assert.deepEqual(menuPaletteActions(null), []);
  const off: DesktopMenuGroup[] = [{ label: "Help", items: [item("action:docs", "Documentation", false)] }];
  assert.deepEqual(menuPaletteActions(off), []);
});

test("the docs link is the documentation site", () => {
  assert.equal(DOCS_URL, "https://www.weaveforge.org/docs/");
});

test("a shortcuts request opens the sheet; a toggle flips it", () => {
  assert.equal(nextShortcutsOpen(false, "open"), true);
  assert.equal(nextShortcutsOpen(true, "open"), true);
  assert.equal(nextShortcutsOpen(false, "toggle"), true);
  assert.equal(nextShortcutsOpen(true, "toggle"), false);
  assert.equal(nextShortcutsOpen(false, undefined), true);
});

test("settingsPaletteActions: none in a browser", () => {
  assert.deepEqual(settingsPaletteActions(null), []);
});

test("settingsPaletteActions: the widget and pen rows follow what the bridge offers", () => {
  const both = settingsPaletteActions({ setPlanWidget: async () => ({}), inkAvailable: async () => true } as never);
  assert.deepEqual(
    both.map((action) => action.path),
    ["/settings#settings-calendar", "/settings#settings-editor"],
  );
  const penOnly = settingsPaletteActions({ inkAvailable: async () => true } as never);
  assert.deepEqual(penOnly.map((action) => action.key), ["settings:pen"]);
});

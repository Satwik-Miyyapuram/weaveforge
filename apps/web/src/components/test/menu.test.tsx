import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { act, create } from "react-test-renderer";
import {
  Menu,
  computeSubmenuPosition,
  type MenuItem,
} from "../menu";
import { CardMenu } from "../card-menu";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

test("computeSubmenuPosition: default placement when space is available", () => {
  // Anchor at (200, 200), viewport 1200x800
  const anchor = { left: 200, right: 350, top: 200, bottom: 236 };
  const flyout = { width: 200, height: 180 };
  const res = computeSubmenuPosition(anchor, flyout, 1200, 800, 6, 12);

  assert.equal(res.placementX, "right", "opens right when space is ample");
  assert.equal(res.placementY, "top", "opens downward when space is ample");
});

test("computeSubmenuPosition: flips left when right boundary overflows", () => {
  // Anchor near right edge (1100 to 1180), viewport 1200x800
  const anchor = { left: 1000, right: 1150, top: 200, bottom: 236 };
  const flyout = { width: 220, height: 180 };
  const res = computeSubmenuPosition(anchor, flyout, 1200, 800, 6, 12);

  assert.equal(res.placementX, "left", "flips left when opening right would overflow viewport");
  assert.equal(res.placementY, "top", "remains top-aligned when bottom space is ample");
});

test("computeSubmenuPosition: flips up when bottom boundary overflows", () => {
  // Anchor near bottom edge (700 to 736), viewport 1200x800
  const anchor = { left: 200, right: 350, top: 700, bottom: 736 };
  const flyout = { width: 200, height: 200 };
  const res = computeSubmenuPosition(anchor, flyout, 1200, 800, 6, 12);

  assert.equal(res.placementX, "right", "remains right-aligned when right space is ample");
  assert.equal(res.placementY, "bottom", "flips up when opening downwards would overflow viewport");
});

test("computeSubmenuPosition: flips both left and up when near bottom-right corner", () => {
  // Anchor near bottom-right corner (user's exact scenario on paper card)
  const anchor = { left: 1000, right: 1160, top: 680, bottom: 716 };
  const flyout = { width: 220, height: 220 };
  const res = computeSubmenuPosition(anchor, flyout, 1200, 800, 6, 12);

  assert.equal(res.placementX, "left", "flips left on horizontal boundary constraint");
  assert.equal(res.placementY, "bottom", "flips up on vertical boundary constraint");
});

test("computeSubmenuPosition: clamps maxHeight to available viewport height", () => {
  const anchor = { left: 200, right: 350, top: 650, bottom: 686 };
  const flyout = { width: 200, height: 400 };
  const res = computeSubmenuPosition(anchor, flyout, 1200, 800, 6, 12);

  assert.equal(res.placementY, "bottom");
  assert.ok(res.maxHeight <= 320, "maxHeight does not exceed upper cap");
  assert.ok(res.maxHeight >= 120, "maxHeight retains a usable floor");
});

test("Menu: renders items and handles clicks and callbacks", () => {
  let selected = false;
  let closed = false;

  const items: MenuItem[] = [
    {
      id: "share",
      label: "Share",
      onSelect: () => { selected = true; },
    },
    {
      id: "sep-1",
      kind: "separator",
      label: "",
    },
    {
      id: "delete",
      label: "Delete",
      danger: true,
      onSelect: () => {},
    },
  ];

  let renderer: ReturnType<typeof create>;
  act(() => {
    renderer = create(
      createElement(Menu, {
        items,
        onClose: () => { closed = true; },
      }),
    );
  });

  const root = renderer!.root;
  const list = root.findByProps({ role: "menu" });
  assert.ok(list, "renders a ul with role='menu'");

  const buttons = root.findAllByType("button");
  assert.equal(buttons.length, 2, "renders 2 action buttons");

  // Share button
  assert.equal(buttons[0]?.props.className.includes("card-menu-item"), true);
  act(() => {
    buttons[0]?.props.onClick();
  });
  assert.equal(selected, true, "fires onSelect");
  assert.equal(closed, true, "fires onClose");

  // Danger delete button
  assert.equal(buttons[1]?.props.className.includes("danger"), true, "marks danger button");

  // Separator
  const sep = root.findByProps({ role: "separator" });
  assert.ok(sep, "renders separator row");
});

test("Menu: supports nested submenu toggling and render functions", () => {
  let subItemClicked = false;
  const items: MenuItem[] = [
    {
      id: "list",
      label: "Add to list",
      submenu: () =>
        createElement("div", { className: "mock-list-picker" }, "Reading Lists"),
    },
  ];

  let renderer: ReturnType<typeof create>;
  act(() => {
    renderer = create(createElement(Menu, { items }));
  });

  const root = renderer!.root;
  const btn = root.findByType("button");
  assert.equal(btn.props["aria-haspopup"], "menu");
  assert.equal(btn.props["aria-expanded"], false);

  // Click row to open submenu
  act(() => {
    btn.props.onClick();
  });

  assert.equal(btn.props["aria-expanded"], true, "opens submenu and updates aria-expanded");
  const picker = root.findByProps({ className: "mock-list-picker" });
  assert.ok(picker, "renders custom submenu content");

  // Click row again to close
  act(() => {
    btn.props.onClick();
  });
  assert.equal(btn.props["aria-expanded"], false, "closes submenu on second click");
});

test("Menu: supports array-based nested MenuItem submenus", () => {
  let subSelected = false;
  const items: MenuItem[] = [
    {
      id: "smoothing",
      label: "Smoothing",
      submenu: [
        {
          id: "ema-1",
          label: "ema 0.5",
          onSelect: () => { subSelected = true; },
        },
      ],
    },
  ];

  let renderer: ReturnType<typeof create>;
  act(() => {
    renderer = create(createElement(Menu, { items }));
  });

  const root = renderer!.root;
  const triggerBtn = root.findByType("button");
  act(() => {
    triggerBtn.props.onClick();
  });

  const allButtons = root.findAllByType("button");
  assert.equal(allButtons.length, 2, "renders trigger button and nested submenu button");

  act(() => {
    allButtons[1]?.props.onClick();
  });
  assert.equal(subSelected, true, "nested submenu item triggers its onSelect");
});

test("CardMenu: renders trigger and delegates to Menu", () => {
  const items: MenuItem[] = [
    { id: "test", label: "Test Action", onSelect: () => {} },
  ];

  let renderer: ReturnType<typeof create>;
  act(() => {
    renderer = create(createElement(CardMenu, { items }));
  });

  assert.ok(renderer!.root, "CardMenu mounts successfully with Popover trigger");
});

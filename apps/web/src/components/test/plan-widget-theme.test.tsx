import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { PlanWidgetTheme, widgetFont, widgetShape } from "../plan-widget-theme";
import { THEME_CHANGE_EVENT } from "@/lib/theme/theme-events";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

test("a theme frame still queued at unmount is cancelled, and bursts share one frame (13-13)", () => {
  const g = globalThis as Record<string, unknown>;
  const saved = { window: g.window, raf: g.requestAnimationFrame, caf: g.cancelAnimationFrame };
  const frames = new Map<number, () => void>();
  let nextId = 0;
  const listeners: Record<string, () => void> = {};
  g.window = {
    weaveforge: { fetchTitle() {}, setPlanWidgetTheme() {} },
    addEventListener: (event: string, handler: () => void) => { listeners[event] = handler; },
    removeEventListener: (event: string) => { delete listeners[event]; },
  };
  g.requestAnimationFrame = (cb: () => void) => { frames.set(++nextId, cb); return nextId; };
  g.cancelAnimationFrame = (id: number) => { frames.delete(id); };
  try {
    let tree: ReturnType<typeof create> | undefined;
    act(() => { tree = create(createElement(PlanWidgetTheme)); });
    assert.equal(frames.size, 1, "first paint queued");
    listeners[THEME_CHANGE_EVENT]!();
    listeners[THEME_CHANGE_EVENT]!();
    assert.equal(frames.size, 1, "a theme change replaces the queued frame");
    act(() => tree!.unmount());
    assert.equal(frames.size, 0, "nothing runs after unmount");
    assert.equal(listeners[THEME_CHANGE_EVENT], undefined);
  } finally {
    g.window = saved.window;
    g.requestAnimationFrame = saved.raf;
    g.cancelAnimationFrame = saved.caf;
  }
});

// The widget kept Poster's hard shadow, 2px border and corners under every
// theme, because only colours crossed over (design D-27, DA-145). The shape is
// read off a real card and control, so it is whatever the theme draws.
test("the widget gets the theme's corners, border, shadows, font and text sizes", () => {
  const style = (over: Partial<Record<string, string>>) =>
    ({ borderTopWidth: "", borderTopLeftRadius: "", boxShadow: "", fontFamily: "", fontSize: "", ...over }) as CSSStyleDeclaration;
  const poster = widgetShape({
    card: style({ borderTopWidth: "2px", borderTopLeftRadius: "6px", boxShadow: "rgb(18, 17, 15) 5px 5px 0px 0px" }),
    control: style({ borderTopLeftRadius: "4px", boxShadow: "rgb(18, 17, 15) 4px 4px 0px 0px" }),
    page: style({ fontFamily: "__Rubik_a1, ui-sans-serif" }),
    text: style({ fontSize: "14px" }),
    small: style({ fontSize: "12px" }),
  });
  assert.deepEqual(poster, {
    radius: "6px",
    "radius-sm": "4px",
    bw: "2px",
    sh: "rgb(18, 17, 15) 5px 5px 0px 0px",
    "sh-sm": "rgb(18, 17, 15) 4px 4px 0px 0px",
    font: "Rubik, ui-sans-serif",
    fs: "14px",
    "fs-sm": "12px",
  });
  const flat = widgetShape({
    card: style({ borderTopWidth: "1px", borderTopLeftRadius: "14px", boxShadow: "none" }),
    control: style({ borderTopLeftRadius: "10px", boxShadow: "none" }),
    page: style({ fontFamily: "system-ui" }),
    text: style({ fontSize: "14px" }),
    small: style({ fontSize: "12px" }),
  });
  assert.equal(flat.sh, "none", "a flat theme has no hard shadow in the widget either");
  assert.equal(flat.bw, "1px");
  assert.equal(flat.radius, "14px");
});

test("the shape is probed off a card and a control, and sent with the colours", () => {
  const src = readFileSync(fileURLToPath(new URL("../plan-widget-theme.tsx", import.meta.url)), "utf8");
  assert.match(src, /className = "card"/);
  assert.match(src, /className = "btn-secondary btn-sm"/);
  assert.match(src, /bridge\.setPlanWidgetTheme\?\.\(\{ \.\.\.palette, \.\.\.widgetShape\(/);
});

// next/font hashes the family name ("__Rubik_d5b2e6", or "Rubik" plus a
// "Rubik Fallback" under Turbopack). The widget is a local page with only its
// own bundled Rubik, so it gets the plain family name (design D16).
test("the widget gets the font's real family name, not next/font's hashed one", () => {
  assert.equal(widgetFont("__Rubik_d5b2e6, __Rubik_Fallback_d5b2e6, ui-sans-serif, system-ui"), "Rubik, ui-sans-serif, system-ui");
  assert.equal(widgetFont("'__Rubik_d5b2e6', '__Rubik_Fallback_d5b2e6', sans-serif"), "Rubik, sans-serif");
  assert.equal(widgetFont('Rubik, "Rubik Fallback", system-ui'), "Rubik, system-ui");
  assert.equal(widgetFont("__JetBrains_Mono_9c1a, monospace"), "JetBrains Mono, monospace");
  assert.equal(widgetFont('"Segoe UI", system-ui'), '"Segoe UI", system-ui', "a plain stack is sent as it is");
});

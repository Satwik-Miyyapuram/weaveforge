/**
 * Ink follows a theme switch without reopening the page: the hook re-reads the
 * palette and page background on the app's own theme-change event.
 */
import { after, afterEach, before, test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { act, create } from "react-test-renderer";

import { THEME_CHANGE_EVENT } from "@/lib/theme/theme-events";
import { INK_RENDER_COLOURS } from "../render/parts-1";
import { PAPER_INK_THEME } from "../render/map-ink-colour";
import type { ThemeInk } from "../render/resolve-ink-colour";
import { useThemeInk } from "../ui/use-theme-ink";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const g = globalThis as Record<string, unknown>;
const saved = { window: g.window, document: g.document, MutationObserver: g.MutationObserver };

before(() => {
  const win = new EventTarget() as EventTarget & Record<string, unknown>;
  win.matchMedia = () => ({ addEventListener() {}, removeEventListener() {} });
  win.setTimeout = setTimeout;
  win.clearTimeout = clearTimeout;
  g.window = win;
  g.document = { documentElement: {} };
  g.MutationObserver = class {
    observe() {}
    disconnect() {}
  };
});
after(() => Object.assign(g, saved));

const mounted: ReturnType<typeof create>[] = [];
afterEach(() => {
  for (const r of mounted.splice(0)) act(() => r.unmount());
});

test("the theme-change event re-reads the palette and theme", () => {
  let current: ThemeInk = { palette: INK_RENDER_COLOURS, theme: PAPER_INK_THEME };
  const seen: ThemeInk[] = [];
  function Probe() {
    seen.push(useThemeInk(() => current));
    return null;
  }
  act(() => {
    mounted.push(create(createElement(Probe)));
  });
  assert.equal(seen.at(-1)?.theme.bg, PAPER_INK_THEME.bg);

  current = {
    palette: { ...INK_RENDER_COLOURS, text: [0.9, 0.9, 0.9] },
    theme: { bg: "#1e1e1e", fg: "#e6e6e6", accents: [] },
  };
  act(() => {
    (g.window as EventTarget).dispatchEvent(new Event(THEME_CHANGE_EVENT));
  });
  assert.equal(seen.at(-1)?.theme.bg, "#1e1e1e");
  assert.deepEqual(seen.at(-1)?.palette.text, [0.9, 0.9, 0.9]);
});

/**
 * The live layer spans the scroller, so its sheet centres where the slots do.
 * The page is capped at real size, so widening the pane (Focus) changes no
 * prop the rail sees: the rail must re-measure on its scroller's resize, or
 * the live sheet stays centred in the old width beside its own slot.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { InkRail, type InkRailProps } from "../ui/ink-rail";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

test("the live layer follows the scroller's width when the pane widens", () => {
  const g = globalThis as Record<string, unknown>;
  const saved = [g.ResizeObserver, g.MutationObserver] as const;
  const resized: (() => void)[] = [];
  class Recording {
    constructor(callback: () => void) {
      resized.push(callback);
    }
    observe() {}
    disconnect() {}
  }
  class Idle {
    observe() {}
    disconnect() {}
  }
  Object.assign(g, { ResizeObserver: Recording, MutationObserver: Idle });

  const scroller = {
    scrollWidth: 1440,
    scrollHeight: 2000,
    querySelector: () => ({ offsetTop: 18 }),
    closest: () => null,
    addEventListener() {},
    removeEventListener() {},
  };
  const layerStyle: Record<string, string> & { setProperty: (k: string, v: string) => void } = {
    setProperty() {},
  } as never;
  const classOf = (element: { props: unknown }) => (element.props as { className?: string }).className;
  const createNodeMock = (element: { props: unknown }) =>
    classOf(element) === "ink-page-scroll"
      ? scroller
      : classOf(element) === "ink-live-layer"
        ? { style: layerStyle }
        : { closest: () => null, querySelector: () => null, addEventListener() {}, removeEventListener() {} };

  const props: InkRailProps = {
    children: null,
    scrollRef: { current: null },
    pageIndex: 0,
    pageCount: 1,
    pageSize: { width: 2100, height: 2970 },
    scale: 96 / 254,
    paper: "plain",
    pages: null,
    ghosts: new Map(),
  };
  try {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(createElement(InkRail, props), { createNodeMock });
    });
    assert.equal(layerStyle.width, "1440px");
    scroller.scrollWidth = 2560;
    act(() => resized.forEach((callback) => callback()));
    assert.equal(layerStyle.width, "2560px", "the layer re-measures on resize");
    act(() => tree.unmount());
  } finally {
    Object.assign(g, { ResizeObserver: saved[0], MutationObserver: saved[1] });
  }
});

test("the rail fills the editor's growing row even when the bar floats", () => {
  // `.ink-wrap` rows are `auto` (the bar) then `1fr`. In Focus the bar floats
  // out of flow, so an auto-placed rail took the `auto` row and left the `1fr`
  // row an empty strip under the page.
  const css = readFileSync(
    fileURLToPath(new URL("../../../app/styles/editor-workspace.css", import.meta.url)),
    "utf8",
  );
  const rule = (selector: string) => {
    const at = css.indexOf(`\n${selector} {`);
    assert.ok(at >= 0, `${selector} has a rule`);
    return css.slice(at, css.indexOf("}", at));
  };
  assert.match(rule(".ink-rail-container"), /grid-row: 2;/);
  assert.match(rule(".ink-text"), /grid-row: 2;/);
});

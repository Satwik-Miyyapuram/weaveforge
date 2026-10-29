import { test } from "node:test";
import assert from "node:assert/strict";
import { act, create, type ReactTestInstance } from "react-test-renderer";

import { ColourMenu } from "../colour-menu";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

test("recent and palette swatches pick a colour and close the menu (12-12)", () => {
  const g = globalThis as Record<string, unknown>;
  const saved = { window: g.window, document: g.document, ResizeObserver: g.ResizeObserver };
  g.window = { addEventListener() {}, removeEventListener() {}, innerWidth: 1000, innerHeight: 800 };
  g.document = { activeElement: null, addEventListener() {}, removeEventListener() {} };
  g.ResizeObserver = class { observe() {} disconnect() {} };
  const node = {
    getBoundingClientRect: () => ({ left: 10, right: 60, top: 10, bottom: 40 }),
    offsetWidth: 100, offsetHeight: 50,
    focus() {}, contains: () => false, querySelector: () => null,
  };
  const picked: string[] = [];
  try {
    let r: ReturnType<typeof create>;
    act(() => {
      r = create(
        <ColourMenu
          value="#AA0000"
          palette={["#aa0000", "#00aa00"]}
          recent={["#123456", "#AA0000"]}
          ariaLabel="Ink colour"
          onChange={(c) => picked.push(c)}
        />,
        { createNodeMock: () => node },
      );
    });
    const swatches = () =>
      r!.root.findAll((n: ReactTestInstance) => n.type === "button" && String(n.props["aria-label"]).startsWith("Colour "));
    act(() => { r!.root.findByProps({ "aria-label": "Ink colour" }).props.onClick({ detail: 1 }); });

    assert.deepEqual(swatches().map((b) => b.props.title), ["Colour #123456", "Colour #aa0000", "Colour #00aa00"]);
    assert.deepEqual(swatches().map((b) => b.props["aria-pressed"]), [false, true, false]);
    assert.equal(swatches()[0]!.props.style.background, "#123456");

    act(() => { swatches()[0]!.props.onClick(); });
    assert.deepEqual(picked, ["#123456"]);
    assert.equal(swatches().length, 0, "picking closes the menu");

    act(() => { r!.root.findByProps({ "aria-label": "Ink colour" }).props.onClick({ detail: 1 }); });
    act(() => { swatches()[2]!.props.onClick(); });
    assert.deepEqual(picked, ["#123456", "#00aa00"]);
    act(() => { r!.unmount(); });
  } finally {
    Object.assign(g, saved);
  }
});

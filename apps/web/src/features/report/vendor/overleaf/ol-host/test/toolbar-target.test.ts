import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { getToolbarTarget, setToolbarTarget, subscribeToolbarTarget } from "../toolbar-target";

test("the host sets where the IDE's top bar goes, and listeners hear each change once", () => {
  const el = {} as HTMLElement;
  let calls = 0;
  const off = subscribeToolbarTarget(() => calls++);
  assert.equal(getToolbarTarget(), null);
  setToolbarTarget(el);
  assert.equal(getToolbarTarget(), el);
  setToolbarTarget(el);
  assert.equal(calls, 1, "the same target again is not a change");
  setToolbarTarget(null);
  assert.equal(calls, 2);
  off();
  setToolbarTarget(el);
  assert.equal(calls, 2, "unsubscribed");
  setToolbarTarget(null);
});

test("the vendored Toolbar portals into the host's target when it has one", () => {
  const src = readFileSync(new URL("../../frontend/js/features/ide-react/components/toolbar/toolbar.tsx", import.meta.url), "utf8");
  assert.match(src, /useToolbarTarget\(\)/);
  assert.match(src, /createPortal\(<ToolbarBar \/>, target\)/);
});

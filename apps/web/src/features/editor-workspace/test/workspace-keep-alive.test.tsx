/**
 * The workspace stays mounted behind other screens (`workspace-host.tsx`), so
 * going to Papers and back does not rebuild every editor. Hidden, it keeps the
 * workspace's own size, so nothing is laid out again on the way back, and it
 * hands the nav and window chrome back to the screen on show.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { ScreenActiveContext } from "@/lib/hooks/use-screen-active";
import { useFocusMode } from "../ui/use-focus-mode";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const css = readFileSync(fileURLToPath(new URL("../../../app/styles/editor-workspace.css", import.meta.url)), "utf8");
const rule = (selector: string) => {
  const at = css.indexOf(`\n${selector} {`);
  assert.ok(at >= 0, selector);
  return css.slice(at, css.indexOf("}", at));
};

test("hidden, the workspace keeps its size and takes no clicks", () => {
  const hidden = rule(".workspace-host:not([data-shown])");
  assert.match(hidden, /position:\s*fixed/);
  assert.match(hidden, /inset:\s*var\(--titlebar-h\) 0 0 var\(--nav-rail-width\)/);
  assert.match(hidden, /visibility:\s*hidden/);
  assert.match(hidden, /pointer-events:\s*none/);
  assert.doesNotMatch(hidden, /display:\s*none/, "display: none would lay every editor out again");
});

test("focus mode hides the nav only while the workspace is on show", async () => {
  const dataset: Record<string, string> = {};
  Object.assign(globalThis, { document: { documentElement: { dataset } } });
  let toggle = () => {};
  function Probe() {
    toggle = useFocusMode().toggleFocus;
    return null;
  }
  const at = (shown: boolean) =>
    createElement(ScreenActiveContext.Provider, { value: shown }, createElement(Probe));
  let tree: ReactTestRenderer | undefined;
  await act(async () => {
    tree = create(at(true));
  });
  await act(async () => toggle());
  assert.ok("workspaceFocus" in dataset, "focused on show");
  await act(async () => tree!.update(at(false)));
  assert.ok(!("workspaceFocus" in dataset), "another screen gets its nav back");
  await act(async () => tree!.update(at(true)));
  assert.ok("workspaceFocus" in dataset, "back to the workspace, still focused");
  await act(async () => tree!.unmount());
  assert.ok(!("workspaceFocus" in dataset));
});

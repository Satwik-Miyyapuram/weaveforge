/**
 * Papers stays mounted behind other screens (`keep-alive.tsx`), like the
 * workspace: its route page hands the screen to a host beside the routes, so
 * leaving Papers does not throw its card grid away and coming back does not
 * build it again.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement, useEffect, type ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { ScreenActiveContext, useScreenActive } from "@/lib/hooks/use-screen-active";
import { renderHook } from "@/lib/test/react-harness";
import { KeepAliveProvider, KeepAliveRoute, useWhileShown } from "../keep-alive";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let mounts = 0;
let unmounts = 0;
const seen: boolean[] = [];
function Screen({ label = "papers" }: { label?: string }) {
  const active = useScreenActive();
  seen.push(active);
  useEffect(() => {
    mounts += 1;
    return () => {
      unmounts += 1;
    };
  }, []);
  return createElement("p", null, label);
}

function reset() {
  mounts = 0;
  unmounts = 0;
  seen.length = 0;
}

type At = { pathname: string; projectId?: string; enabled?: boolean; route?: ReactNode };

/** The shell: a provider around the routes, and the route the pathname picks. */
function shell({ pathname, projectId = "p1", enabled = true, route }: At) {
  const page =
    route !== undefined
      ? route
      : pathname === "/papers"
        ? createElement(KeepAliveRoute, { path: "/papers", scope: "Papers" }, createElement(Screen))
        : createElement("p", null, "other");
  return createElement(KeepAliveProvider, { pathname, projectId, enabled }, createElement("main", null, page));
}

async function mount(at: At): Promise<ReactTestRenderer> {
  let tree: ReactTestRenderer | undefined;
  await act(async () => {
    tree = create(shell(at));
  });
  return tree!;
}

const hosts = (tree: ReactTestRenderer) =>
  tree.root.findAll((node) => node.type === "div" && node.props.className === "keep-alive-host");

test("on its route, the screen renders in a shown host", async () => {
  reset();
  const tree = await mount({ pathname: "/papers" });
  const [host] = hosts(tree);
  assert.ok(host, "a host");
  assert.equal(host.props["data-shown"], "");
  assert.equal(host.props.inert, false);
  assert.equal(seen.at(-1), true, "active");
  assert.equal(mounts, 1);
  await act(async () => tree.unmount());
});

test("on another route it stays mounted, hidden, inert and inactive", async () => {
  reset();
  const tree = await mount({ pathname: "/papers" });
  await act(async () => tree.update(shell({ pathname: "/workspace" })));
  const [host] = hosts(tree);
  assert.ok(host, "still there");
  assert.equal(host.props["data-shown"], undefined);
  assert.equal(host.props.inert, true);
  assert.equal(seen.at(-1), false, "inactive while hidden");
  assert.equal(unmounts, 0, "not unmounted");
  assert.ok(tree.root.findAll((n) => n.type === "p" && n.props.children === "other").length === 1);
  await act(async () => tree.unmount());
});

test("coming back shows the same instance, not a new one", async () => {
  reset();
  const tree = await mount({ pathname: "/papers" });
  await act(async () => tree.update(shell({ pathname: "/notes" })));
  await act(async () => tree.update(shell({ pathname: "/papers" })));
  assert.equal(mounts, 1, "mounted once");
  assert.equal(unmounts, 0);
  assert.equal(hosts(tree).length, 1, "one host, not two");
  assert.equal(hosts(tree)[0]!.props["data-shown"], "");
  assert.equal(seen.at(-1), true);
  await act(async () => tree.unmount());
});

test("a project switch drops the last project's screen", async () => {
  reset();
  const tree = await mount({ pathname: "/papers", projectId: "p1" });
  await act(async () => tree.update(shell({ pathname: "/workspace", projectId: "p2" })));
  assert.equal(hosts(tree).length, 0, "nothing kept for the old project");
  assert.equal(unmounts, 1);
  await act(async () => tree.update(shell({ pathname: "/papers", projectId: "p2" })));
  assert.equal(mounts, 2, "a fresh screen for the new project");
  await act(async () => tree.unmount());
});

test("switching project while on the route remounts it for the new project", async () => {
  reset();
  const tree = await mount({ pathname: "/papers", projectId: "p1" });
  await act(async () => tree.update(shell({ pathname: "/papers", projectId: "p2" })));
  assert.equal(hosts(tree).length, 1);
  assert.equal(mounts, 2);
  assert.equal(unmounts, 1);
  await act(async () => tree.unmount());
});

test("disabled (phone layout), the route renders inline and nothing is kept", async () => {
  reset();
  const tree = await mount({ pathname: "/papers", enabled: false });
  assert.equal(hosts(tree).length, 0);
  assert.equal(seen.at(-1), true);
  await act(async () => tree.update(shell({ pathname: "/notes", enabled: false })));
  assert.equal(unmounts, 1, "left like any other screen");
  await act(async () => tree.unmount());
});

test("without a provider the route renders its screen in place", async () => {
  reset();
  let tree: ReactTestRenderer | undefined;
  await act(async () => {
    tree = create(createElement(KeepAliveRoute, { path: "/papers", scope: "Papers" }, createElement(Screen)));
  });
  assert.equal(hosts(tree!).length, 0);
  assert.equal(mounts, 1);
  await act(async () => tree!.unmount());
});

test("a render error in the kept screen stays inside its own boundary", async () => {
  reset();
  function Broken(): never {
    throw new Error("boom");
  }
  const original = console.error;
  console.error = () => {};
  try {
    const route = createElement(KeepAliveRoute, { path: "/papers", scope: "Papers" }, createElement(Broken));
    const tree = await mount({ pathname: "/papers", route });
    assert.ok(tree.root.findAll((n) => n.type === "main").length === 1, "the shell still renders");
    assert.match(JSON.stringify(tree.toJSON()), /Papers/);
    await act(async () => tree.unmount());
  } finally {
    console.error = original;
  }
});

test("useWhileShown keeps the last value seen on show while hidden", async () => {
  let active = true;
  const harness = await renderHook((value: string) => useWhileShown(value), "?paper=a", {
    wrapper: (children: ReactNode) => createElement(ScreenActiveContext.Provider, { value: active }, children),
  });
  assert.equal(harness.current, "?paper=a");
  active = false;
  await harness.rerender("");
  assert.equal(harness.current, "?paper=a", "another screen's URL does not reach the hidden one");
  active = true;
  await harness.rerender("?paper=b");
  assert.equal(harness.current, "?paper=b");
  await harness.unmount();
});

const css = readFileSync(fileURLToPath(new URL("../styles/shell.css", import.meta.url)), "utf8");

test("hidden, the kept screen is out of layout and takes no clicks", () => {
  const at = css.indexOf("\n.keep-alive-host:not([data-shown]) {");
  assert.ok(at >= 0, "rule present");
  const rule = css.slice(at, css.indexOf("}", at));
  assert.match(rule, /display:\s*none/);
});

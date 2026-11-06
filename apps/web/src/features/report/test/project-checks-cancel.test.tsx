import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { withAppLogs } from "@/lib/error-report/test/capture-app-logs";
import { ProjectChecks } from "../ui/project-checks";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const files = [{ path: "main.tex", content: "\\documentclass{article}" }];
const stopped = {
  ok: false,
  pdf: null,
  log: "",
  errors: [{ file: "main.tex", line: 0, message: "The compile was stopped." }],
  engine: null,
};

type Bridge = Record<string, unknown>;

/** Mounts the checks with a TeX found and a compile that waits for `finish`. */
async function mounted(bridge: Bridge) {
  let finish: (result: typeof stopped) => void = () => {};
  bridge.probeTex = () => Promise.resolve({ version: "TeX Live 2026" });
  bridge.compileTex = () => new Promise((resolve) => (finish = resolve));
  let tree: ReactTestRenderer | undefined;
  await act(async () => {
    tree = create(createElement(ProjectChecks, { files, entryFile: "main.tex" }));
  });
  const button = (label: RegExp) =>
    tree!.root.findAll((node) => node.type === "button" && label.test(JSON.stringify(node.props.children)))[0];
  await act(async () => button(/Compile here/)!.props.onClick());
  return { tree: tree!, button, finish: (result: typeof stopped) => finish(result) };
}

function bridgeOf(): Bridge {
  return (window as unknown as { weaveforge: Bridge }).weaveforge;
}

test("Cancel stops the compile and the panel says Stopped, not errors", async () => {
  await withAppLogs(async () => {
    const bridge = bridgeOf();
    let cancels = 0;
    bridge.cancelTex = () => {
      cancels += 1;
      return Promise.resolve();
    };
    const { tree, button, finish } = await mounted(bridge);
    assert.ok(button(/Cancel/), "Cancel shows while compiling");
    await act(async () => button(/Cancel/)!.props.onClick());
    assert.equal(cancels, 1);
    await act(async () => finish(stopped));
    const shown = JSON.stringify(tree.toJSON());
    assert.match(shown, /Stopped\./);
    assert.doesNotMatch(shown, /no PDF/);
    assert.equal(button(/Cancel/), undefined, "Cancel goes once the compile ends");
    await act(async () => tree.unmount());
  });
});

test("no Cancel button when the shell cannot stop a compile", async () => {
  await withAppLogs(async () => {
    const bridge = bridgeOf();
    delete bridge.cancelTex;
    const { tree, button, finish } = await mounted(bridge);
    assert.equal(button(/Cancel/), undefined);
    await act(async () => finish({ ...stopped, errors: [] }));
    await act(async () => tree.unmount());
  });
});

test("a running compile shows the seconds it has taken", async () => {
  mock.timers.enable({ apis: ["setInterval", "Date"] });
  try {
    await withAppLogs(async () => {
      const bridge = bridgeOf();
      bridge.cancelTex = () => Promise.resolve();
      const { tree, finish } = await mounted(bridge);
      await act(async () => mock.timers.tick(3000));
      assert.match(JSON.stringify(tree.toJSON()), /Compiling… 3 s/);
      await act(async () => finish({ ...stopped, errors: [] }));
      await act(async () => tree.unmount());
    });
  } finally {
    mock.timers.reset();
  }
});

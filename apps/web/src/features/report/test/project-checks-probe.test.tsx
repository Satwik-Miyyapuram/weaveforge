import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { act, create } from "react-test-renderer";

import { withAppLogs } from "@/lib/error-report/test/capture-app-logs";
import { ProjectChecks } from "../ui/project-checks";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const files = [{ path: "main.tex", content: "\documentclass{article}" }];

test("the TeX probe runs once per mount, however often the panel re-renders (30-13)", async () => {
  await withAppLogs(async () => {
    const bridge = (window as unknown as { weaveforge: Record<string, unknown> }).weaveforge;
    let probes = 0;
    let answer: (found: { version: string } | null) => void = () => {};
    bridge.probeTex = () => {
      probes += 1;
      return new Promise((resolve) => (answer = resolve));
    };
    bridge.compileTex = () => Promise.reject(new Error("unused"));
    let tree: ReturnType<typeof create> | undefined;
    await act(async () => {
      tree = create(createElement(ProjectChecks, { files, entryFile: "main.tex" }));
    });
    // Re-renders while the probe is still out must not ask again.
    await act(async () => tree?.update(createElement(ProjectChecks, { files: [...files], entryFile: "main.tex" })));
    await act(async () => tree?.update(createElement(ProjectChecks, { files: [...files], entryFile: "main.tex" })));
    assert.equal(probes, 1);
    await act(async () => answer({ version: "TeX Live 2026" }));
    assert.match(JSON.stringify(tree?.toJSON()), /Compile here/);
    assert.equal(probes, 1);
    await act(async () => tree?.unmount());
  });
});

test("a probe that answers after unmount raises no error (30-13)", async () => {
  await withAppLogs(async () => {
    const bridge = (window as unknown as { weaveforge: Record<string, unknown> }).weaveforge;
    let answer: (found: { version: string } | null) => void = () => {};
    bridge.probeTex = () => new Promise((resolve) => (answer = resolve));
    bridge.compileTex = () => Promise.reject(new Error("unused"));
    const errors: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => void errors.push(args);
    try {
      let tree: ReturnType<typeof create> | undefined;
      await act(async () => {
        tree = create(createElement(ProjectChecks, { files, entryFile: "main.tex" }));
      });
      await act(async () => tree?.unmount());
      await act(async () => answer({ version: "TeX Live 2026" }));
    } finally {
      console.error = original;
    }
    // The renderer warns that it is deprecated; anything else is the bug.
    assert.deepEqual(errors.filter((args) => !/deprecated/.test(String((args as unknown[])[0]))), []);
  });
});

test("a failed probe hides the compile button (30-13)", async () => {
  await withAppLogs(async () => {
    const bridge = (window as unknown as { weaveforge: Record<string, unknown> }).weaveforge;
    bridge.probeTex = () => Promise.reject(new Error("no tex"));
    bridge.compileTex = () => Promise.reject(new Error("unused"));
    let tree: ReturnType<typeof create> | undefined;
    await act(async () => {
      tree = create(createElement(ProjectChecks, { files, entryFile: "main.tex" }));
    });
    await act(async () => Promise.resolve());
    assert.doesNotMatch(JSON.stringify(tree?.toJSON()), /Compile here/);
    await act(async () => tree?.unmount());
  });
});

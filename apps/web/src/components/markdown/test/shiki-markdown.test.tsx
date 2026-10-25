import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { withAppLogs } from "@/lib/error-report/test/capture-app-logs";
import { ShikiMarkdown } from "../shiki-markdown";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

test("a failed highlight is logged and leaves the readable fallback, not busy (13-05)", async () => {
  const g = globalThis as Record<string, unknown>;
  const saved = { document: g.document, MutationObserver: g.MutationObserver };
  g.document = { documentElement: { dataset: {} } };
  g.MutationObserver = class { observe() {} disconnect() {} };
  try {
    let calls = 0;
    // The fallback render resolves the link; the highlighted render then fails.
    const resolveWikilink = () => {
      calls++;
      if (calls > 1) throw new Error("highlighter chunk failed");
      return { href: "/a", exists: true } as never;
    };
    const logs = await withAppLogs(async (logs) => {
      let tree: ReactTestRenderer | undefined;
      await act(async () => {
        tree = create(createElement(ShikiMarkdown, { children: "See [[A]].", resolveWikilink }));
      });
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
      const div = tree!.root.findByType("div");
      assert.equal(div.props["aria-busy"], false);
      assert.match(div.props.dangerouslySetInnerHTML.__html, /See/);
      await act(async () => tree!.unmount());
      return logs;
    });
    const entry = logs.find((log) => log.source === "markdown");
    assert.ok(entry, JSON.stringify(logs));
    assert.equal(entry.level, "warn");
    assert.match(entry.detail ?? "", /highlighter chunk failed/);
  } finally {
    g.document = saved.document;
    g.MutationObserver = saved.MutationObserver;
  }
});

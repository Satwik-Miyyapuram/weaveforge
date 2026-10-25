import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";

import { withAppLogs } from "@/lib/error-report/test/capture-app-logs";
import { DesktopTitleBar } from "../desktop-title-bar";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const router = { push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} };

test("a menu model the shell cannot send is logged, not dropped (12-09)", async () => {
  const logs = await withAppLogs(async (logs) => {
    const bridge = (window as unknown as { weaveforge: Record<string, unknown> }).weaveforge;
    bridge.menuModel = () => Promise.reject(new Error("ipc closed"));
    Object.assign(window, { addEventListener() {}, removeEventListener() {} });
    let tree: ReturnType<typeof create> | undefined;
    await act(async () => {
      tree = create(
        createElement(AppRouterContext.Provider, { value: router as never }, createElement(DesktopTitleBar)),
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => tree?.unmount());
    return logs;
  });
  const entry = logs.find((log) => log.source === "title-bar");
  assert.ok(entry, JSON.stringify(logs));
  assert.equal(entry.level, "warn");
  assert.match(entry.detail ?? "", /ipc closed/);
});

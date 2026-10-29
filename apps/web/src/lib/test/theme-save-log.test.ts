import { test } from "node:test";
import assert from "node:assert/strict";
import { withAppLogs } from "@/lib/error-report/test/capture-app-logs";
import { persistThemeChange } from "@/lib/theme/theme-persistence";

test("a failed appearance save is logged, not thrown or swallowed (11-09)", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  await withAppLogs(async (logs) => {
    Object.assign((globalThis as { window: object }).window, { matchMedia: () => ({ matches: false }) });
    // No container is built in a unit test, so the save fails the way it does
    // before sign-in completes.
    persistThemeChange({ mode: "dark" }, { apply: false });
    assert.doesNotThrow(() => t.mock.timers.tick(600));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(logs.length, 1);
    assert.equal(logs[0]?.source, "appearance");
    assert.equal(logs[0]?.level, "warn");
    assert.match(String(logs[0]?.detail), /container not ready/i);
  });
});

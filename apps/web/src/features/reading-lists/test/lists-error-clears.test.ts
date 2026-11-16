// Source-match guard: the lists screen error banner must clear when a new load starts.
// Without it a stale error stays on screen after a successful retry.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const screen = readFileSync(new URL("../ui/lists-screen.tsx", import.meta.url), "utf8");

test("lists load clears the error banner before reloading", () => {
  assert.match(screen, /const load = useCallback\(async \(\) => \{\n\s*setError\(null\);\n\s*await reload\(\);/);
});

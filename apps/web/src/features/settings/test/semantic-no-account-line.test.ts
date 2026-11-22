/**
 * With no account, meaning search has no store to save to in 0.9.8, so the
 * settings line says so instead of the engine's status text. Static: the panel
 * pulls in the Rust core and styles, which are not loaded in node tests.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const panel = readFileSync(new URL("../ui/search-settings-panel.tsx", import.meta.url), "utf8");

test("the settings line shows the no-account text when isLocalMode() is true", () => {
  assert.match(panel, /import \{ isLocalMode \} from "@\/features\/auth\/infrastructure\/no-account-mode";/);
  assert.match(
    panel,
    /const text = isLocalMode\(\) \? "Semantic search needs an account\. Keyword search still works\." : readyCore\(\)\.semanticStatusText\(status\);/,
  );
});

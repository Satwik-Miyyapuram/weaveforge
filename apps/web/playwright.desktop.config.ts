/**
 * Desktop E2E config: attaches to a running WeaveForge Dev over CDP.
 * Never launches a browser or server. Start Dev first with
 * `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223` (.agents/testing.md §3).
 * Never run this against the installed app.
 */
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e-desktop",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  timeout: 90_000,
});

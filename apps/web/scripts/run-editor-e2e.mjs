/**
 * The editor paste spec, on its own.
 *
 * It bundles the editor onto a file:// page, so it needs neither the dev server
 * nor a signed-in user — but Playwright's global setup and webServer are config
 * level, not spec level, and would run for it regardless. This sets the flag
 * that turns both off. A script rather than an inline env assignment because
 * `VAR=value cmd` is not something cmd.exe understands.
 */
import { spawnSync } from "node:child_process";

const { status } = spawnSync(
  "npx",
  ["playwright", "test", "e2e/editor-paste.spec.ts"],
  { stdio: "inherit", shell: true, env: { ...process.env, PLAYWRIGHT_NO_SESSION: "1" } },
);
process.exit(status ?? 1);

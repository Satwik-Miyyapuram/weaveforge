/**
 * The page-level design guards (design D20: G5 targets, G6 overflow).
 *
 * First the self-test on planted pages, which needs no server and no account,
 * so it always runs. Then the real screens, signed in; that spec skips itself
 * when the e2e account is not configured (local-dev/test-accounts.env).
 */
import { spawnSync } from "node:child_process";

function playwright(spec, env = {}) {
  const { status } = spawnSync("npm", ["run", "-s", "test:e2e", "--", spec], {
    stdio: "inherit",
    shell: true,
    env: { ...process.env, ...env },
  });
  if (status !== 0) process.exit(status ?? 1);
}

playwright("e2e/design-guards-self.spec.ts", { PLAYWRIGHT_NO_SESSION: "1" });
playwright("e2e/design-guards.spec.ts");

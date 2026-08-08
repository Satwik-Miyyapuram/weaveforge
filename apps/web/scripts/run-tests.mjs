#!/usr/bin/env node
/**
 * Run the unit suite under the node:test runner.
 *
 * Exists only to set `TSX_TSCONFIG_PATH` before spawning, which cannot be done
 * inline in an npm script without a shell that differs between Windows and CI.
 * `tsconfig.test.json` switches the JSX transform to the automatic runtime —
 * see the comment in that file for why the app's own `jsx: "preserve"` cannot
 * be used here.
 *
 *   npm run test --workspace @weaveforge/web
 *   npm run test --workspace @weaveforge/web -- --test-name-pattern startup
 */

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const child = spawn(
  process.execPath,
  [
    "--import",
    "tsx",
    "--test",
    ...process.argv.slice(2),
    // Two patterns rather than a brace expansion: node's test-runner glob does
    // not expand `{ts,tsx}`, and a pattern that matches nothing is ignored.
    "src/**/*.test.ts",
    "src/**/*.test.tsx",
  ],
  {
    cwd: appRoot,
    stdio: "inherit",
    env: { ...process.env, TSX_TSCONFIG_PATH: path.join(appRoot, "tsconfig.test.json") },
  },
);

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});

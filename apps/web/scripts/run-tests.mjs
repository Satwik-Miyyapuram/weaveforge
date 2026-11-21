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
 *
 * It also preloads the Rust core (src/lib/test/preload-core.mts).
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
    // Loads the Rust core before any test, for callers of readyCore().
    "--import",
    "./src/lib/test/preload-core.mts",
    "--test",
    // One test file at a time by default: node otherwise starts one process
    // per core, which breaks the 1 GB RAM rule. A later flag overrides it.
    `--test-concurrency=${process.env.WF_TEST_CONCURRENCY ?? 1}`,
    ...process.argv.slice(2),
    // Named test files run alone; otherwise the whole suite. Two patterns
    // rather than a brace expansion: node's test-runner glob does not expand
    // `{ts,tsx}`, and a pattern that matches nothing is ignored.
    ...(process.argv.slice(2).some((a) => /\.test\.tsx?$/.test(a))
      ? []
      : ["src/**/*.test.ts", "src/**/*.test.tsx"]),
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

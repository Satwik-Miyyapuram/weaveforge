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
 *   node ./scripts/run-tests.mjs src/features/ink     (one feature)
 *
 * It also preloads the Rust core (src/lib/test/preload-core.mts).
 */

import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { testArgs } from "./lib/test-args.mjs";

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
    // Named files or directories run alone; otherwise the whole suite.
    ...testArgs(process.argv.slice(2), {
      isDir: (p) => statSync(path.resolve(appRoot, p), { throwIfNoEntry: false })?.isDirectory() ?? false,
      env: process.env,
    }),
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

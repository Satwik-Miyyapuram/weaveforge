#!/usr/bin/env node
/**
 * Run a script from local-dev/ (gitignored). Committed templates live in local-dev.example/.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LOCAL_DIR = resolve(REPO, "local-dev");

export function runLocalDev(scriptName, extraArgs = []) {
  const target = resolve(LOCAL_DIR, scriptName);
  if (!existsSync(target)) {
    console.error(`Missing local-dev/${scriptName}`);
    console.error("");
    console.error("One-time setup:");
    console.error("  npm run setup:local-dev");
    console.error("  # then edit local-dev/test-accounts.env (never commit)");
    process.exit(1);
  }
  const result = spawnSync(process.execPath, [target, ...extraArgs], {
    stdio: "inherit",
    cwd: REPO,
  });
  process.exit(result.status ?? 1);
}

if (process.argv[1]?.endsWith("run-local-dev.mjs") && process.argv[2]) {
  runLocalDev(process.argv[2], process.argv.slice(3));
}

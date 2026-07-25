#!/usr/bin/env node
/** Run `next build` with ANALYZE=true for @next/bundle-analyzer. */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

process.env.ANALYZE = "true";
const cwd = path.dirname(fileURLToPath(import.meta.url));
const result = spawnSync("npx", ["next", "build"], {
  cwd,
  stdio: "inherit",
  env: process.env,
  shell: true,
});
process.exit(result.status ?? 1);

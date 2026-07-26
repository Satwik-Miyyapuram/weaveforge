// Expand *.integration.ts for node --test (Node does not expand star-star globs).
import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith(".integration.ts")) out.push(full);
  }
  return out;
}

const root = join(process.cwd(), "src", "features");
const files = walk(root).map((f) => relative(process.cwd(), f).replaceAll("\\", "/"));
if (files.length === 0) {
  console.log("No *.integration.ts files under src/features — nothing to run.");
  process.exit(0);
}

const result = spawnSync(
  process.execPath,
  ["--import", "tsx", "--import", "./scripts/load-test-env.ts", "--test", ...files],
  { stdio: "inherit" },
);
process.exit(result.status ?? 1);

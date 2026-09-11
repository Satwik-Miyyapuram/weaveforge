// Expand *.integration.ts for node --test (Node does not expand star-star globs).
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith(".integration.ts")) out.push(full);
  }
  return out;
}

// `src/features` holds the per-feature suites. `src/backend` holds the ones
// about the schema itself rather than any one feature — the invariant checks
// that read `pg_class`/`pg_proc` — and those belong beside the test database
// they use (`src/backend/test/pg-test-db.ts`) instead of inside whichever
// feature happened to sort first. Walking both keeps that possible.
const roots = [join(process.cwd(), "src", "features"), join(process.cwd(), "src", "backend")];
const files = roots
  .filter(existsSync)
  .flatMap((root) => walk(root))
  .map((f) => relative(process.cwd(), f).replaceAll("\\", "/"));
if (files.length === 0) {
  console.log("No *.integration.ts files under src/features or src/backend — nothing to run.");
  process.exit(0);
}

const result = spawnSync(
  process.execPath,
  ["--import", "tsx", "--test", ...files],
  { stdio: "inherit" },
);
process.exit(result.status ?? 1);

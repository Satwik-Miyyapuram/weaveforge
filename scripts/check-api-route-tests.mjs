#!/usr/bin/env node
/**
 * Every Next.js `route.ts` under apps/web/src/app/api must have a colocated
 * `test/route.test.ts` (or `test/<name>.test.ts` covering the route).
 */
import { readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const apiRoot = join(root, "apps/web/src/app/api");

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (name === "route.ts") out.push(path);
  }
  return out;
}

const missing = [];
for (const route of walk(apiRoot)) {
  const dir = join(route, "..");
  const colocated = join(dir, "test", "route.test.ts");
  if (existsSync(colocated)) continue;
  // Allow sibling shared tests that import this route (rare); still require route.test.ts.
  missing.push(relative(root, route).replaceAll("\\", "/"));
}

if (missing.length) {
  console.error("API routes missing colocated test/route.test.ts:\n" + missing.map((m) => `  - ${m}`).join("\n"));
  process.exit(1);
}

console.log(`API route test coverage OK (${walk(apiRoot).length} routes).`);

#!/usr/bin/env node
/**
 * Every Next.js route handler under apps/web/src/app must have a colocated
 * `test/route.test.ts` that actually exercises it.
 *
 * Two things the previous version did not do, both of which let a route ship
 * untested while the gate reported success:
 *
 *   - It walked `app/api` only. Next.js serves a route handler from any
 *     `route.ts` under `app/`, so `app/.well-known/appspecific/…` — and any
 *     future non-API handler — was outside the gate entirely. The walk now
 *     starts at `app/`.
 *   - It checked for the file's existence and nothing else, so an empty file,
 *     or one that imports nothing and asserts nothing, satisfied it. The review
 *     had to count by hand to find that 18 of 34 route tests assert only "401
 *     without a token".
 *
 * This is deliberately not a coverage measurement. It asserts two cheap things
 * a placeholder cannot have: at least one `test(`/`it(` in the file, and an
 * import of the route under test — `../route`, or one of the two shared
 * `_shared` modules the routes delegate their gate to, whose own tests then
 * cover the assertion the route test would otherwise repeat.
 */
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const appRoot = join(root, "apps/web/src/app");

/**
 * Routes that legitimately need no test, with the reason.
 *
 * `com.chrome.devtools.json` answers `{}` so Chrome's DevTools probe stops
 * filling the dev log with 404s. There is no input, no branch and no data: a
 * test would assert that a literal equals itself. It is listed here rather than
 * skipped by directory so that the exemption is one visible line and the next
 * `.well-known` handler — which may well do something — is not excused with it.
 */
const NO_TEST_REQUIRED = new Map([
  [
    "apps/web/src/app/.well-known/appspecific/com.chrome.devtools.json/route.ts",
    "returns a constant empty object for Chrome's DevTools probe; there is no behaviour to test",
  ],
]);

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
const empty = [];
const routes = walk(appRoot);

for (const route of routes) {
  const rel = relative(root, route).replaceAll("\\", "/");
  if (NO_TEST_REQUIRED.has(rel)) continue;

  const colocated = join(route, "..", "test", "route.test.ts");
  if (!existsSync(colocated)) {
    missing.push(rel);
    continue;
  }

  const source = readFileSync(colocated, "utf8");
  const relTest = relative(root, colocated).replaceAll("\\", "/");

  // A test file with no test in it is a placeholder, not a test.
  if (!/(?:^|\s)(?:test|it)\s*\(/m.test(source)) {
    empty.push(`${relTest} — no test()/it() call`);
    continue;
  }

  // And a test that never reaches the handler proves nothing about it. The two
  // `_shared` modules are accepted because the routes under them delegate their
  // whole precondition to that module, which has its own test.
  const importsRoute =
    /from\s+["'][^"']*route["']/.test(source) ||
    /from\s+["'][^"']*_shared["']/.test(source);
  if (!importsRoute) {
    empty.push(`${relTest} — does not import the route or its _shared gate`);
  }
}

if (missing.length || empty.length) {
  if (missing.length) {
    console.error(
      "Route handlers with no colocated test/route.test.ts:\n" +
        missing.map((m) => `  - ${m}`).join("\n"),
    );
  }
  if (empty.length) {
    console.error(
      "\nRoute tests that exist but assert nothing about the route:\n" +
        empty.map((m) => `  - ${m}`).join("\n"),
    );
  }
  process.exit(1);
}

console.log(`API route test coverage OK (${routes.length} route handlers).`);

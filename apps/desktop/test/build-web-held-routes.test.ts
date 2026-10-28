import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

/**
 * The desktop build holds some route directories aside while `next build`
 * exports the app (`scripts/build-web.mjs`). Any file left in place that
 * imports from one of them fails the export's type check, which is how a web
 * test importing `@/app/api/blobs/_shared` broke the desktop build.
 */

const web = path.resolve(import.meta.dirname, "../../web");
const app = path.join(web, "src/app");
const HELD = ["api", "experiments/[id]", "pitch"];
const heldDirs = HELD.map((route) => path.join(app, route));

function sourceFiles(dir: string): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && /\.(ts|tsx|mts)$/.test(e.name))
    .map((e) => path.join(e.parentPath, e.name))
    .filter((file) => !file.includes(`${path.sep}node_modules${path.sep}`));
}

function isHeld(file: string): boolean {
  return heldDirs.some((dir) => file === dir || file.startsWith(dir + path.sep));
}

/** Where an import specifier points inside `src`, or null for a package. */
function target(from: string, spec: string): string | null {
  if (spec.startsWith("@/")) return path.join(web, "src", spec.slice(2));
  if (spec.startsWith(".")) return path.resolve(path.dirname(from), spec);
  return null;
}

const IMPORT = /(?:from\s+|import\s*\(\s*|import\s+)["']([^"']+)["']/g;

test("the held route list matches build-web.mjs", () => {
  const script = fs.readFileSync(path.resolve(import.meta.dirname, "../scripts/build-web.mjs"), "utf8");
  assert.ok(script.includes(`const heldRoutes = [${HELD.map((r) => JSON.stringify(r)).join(", ")}]`), "update HELD here to match the script");
});

test("/org ships in the app: it only redirects to Settings, so holding it aside made a 404", () => {
  assert.ok(!HELD.includes("org"));
  const page = fs.readFileSync(path.join(app, "org/page.tsx"), "utf8");
  assert.match(page, /redirect\("\/settings"\)/);
  assert.doesNotMatch(page, /\/api\//);
});

test("no file the desktop build keeps imports from a route it holds aside", () => {
  const offenders: string[] = [];
  for (const file of sourceFiles(path.join(web, "src"))) {
    if (isHeld(file)) continue;
    for (const [, spec] of fs.readFileSync(file, "utf8").matchAll(IMPORT)) {
      const to = target(file, spec!);
      if (to && isHeld(to)) offenders.push(`${path.relative(web, file)} -> ${spec}`);
    }
  }
  assert.deepEqual(offenders, []);
});

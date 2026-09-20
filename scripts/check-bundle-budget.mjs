/**
 * A first-load budget for every route, measured from the build's own manifest.
 *
 * `WF-P07` was advisory: the app ships a force graph, a PDF reader, metric
 * charting and a Yjs editor, each pulling a heavyweight browser-only library, and
 * Next only splits what is dynamically imported or route-isolated — so one static
 * import in a module the layout reaches puts a megabyte on the sign-in page. The
 * audit could not confirm which import site did it, and neither could a reader:
 * nothing measured the result.
 *
 * This measures it. For each route in `.next/app-build-manifest.json`, the JS
 * chunks that page loads are summed, and the largest is compared against a budget.
 * The numbers are per route rather than one total because the failure mode is a
 * *route* that drags something in — a total hides it behind the fifty routes that
 * did not change.
 *
 * Runs after `npm run build`, like `check:deployment-surface`: it reads build
 * output, so it cannot run inside `check:boundaries`, which runs before it.
 *
 *     npm run bundle:budget
 */
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { gzipSync } from "node:zlib";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const buildDir = path.join(root, "apps/web/.next");

/**
 * What a route may load before it paints, gzipped — a ratchet.
 *
 * The default is 340 KB, which is today's shared shell (`/layout` and the error
 * pages: ~92 KB of framework plus the app's common code) with room for one
 * feature to grow. The allowances below are the routes already above it. They may
 * only come down: raising one needs a note saying what makes that route heavy,
 * because the question a failure should prompt is "why did this route get a new
 * dependency", not "what number makes it pass".
 *
 * What the first run measured, and what it says about `WF-P07`:
 *
 *   * `/reader` is **207 KB** and `/graph` 342 KB — pdf.js and the force graph
 *     are already behind dynamic imports. That is the half of the finding the
 *     audit could not confirm, and the lazy boundaries held.
 *   * The heavy routes are the *list* screens: `/papers` 483 KB, `/report` 475,
 *     `/notes` 467, `/settings` 372. They pull their features in eagerly, and
 *     `components/markdown/markdown.tsx` — which statically imports `katex` — is
 *     loaded by four route modules (report, logbook, ai-review, ink). That is the
 *     lead for the next pass: dynamic-import the renderer, or split the plain
 *     one from the maths one.
 */
const ROUTE_BUDGET_KB = 340;

/** Routes already above the default, at their measured size plus a little. */
const ROUTE_ALLOWANCES_KB = {
  "/papers": 500,
  "/report": 490,
  "/notes": 480,
  "/settings": 385,
  "/graph": 355,
};

/** The allowance for a route, longest matching prefix first. */
function allowanceFor(route) {
  const prefixes = Object.keys(ROUTE_ALLOWANCES_KB).sort((a, b) => b.length - a.length);
  const match = prefixes.find((prefix) => route.startsWith(prefix));
  return match ? ROUTE_ALLOWANCES_KB[match] : ROUTE_BUDGET_KB;
}

function gzippedChunkSize(file) {
  try {
    return gzipSync(readFileSync(file)).byteLength;
  } catch {
    return 0;
  }
}

let manifest;
try {
  manifest = JSON.parse(readFileSync(path.join(buildDir, "app-build-manifest.json"), "utf8"));
} catch {
  console.error(
    "FAIL: no build output to measure. Run `npm run build` first — this check reads\n" +
      "      .next/app-build-manifest.json, which only exists after one.",
  );
  process.exit(1);
}

const chunksDir = path.join(buildDir, "static/chunks");
const measured = [];
for (const [route, files] of Object.entries(manifest.pages ?? {})) {
  let bytes = 0;
  for (const file of files) {
    if (!file.endsWith(".js")) continue;
    // Manifest paths are relative to the build root (`static/chunks/…`).
    bytes += gzippedChunkSize(path.join(buildDir, file));
  }
  measured.push({ route, kb: Math.round(bytes / 1024) });
}

if (measured.length === 0) {
  console.error("FAIL: the build manifest lists no routes — this check read nothing.");
  process.exit(1);
}

const overBudget = measured
  .map(({ route, kb }) => ({ route, kb, limit: allowanceFor(route) }))
  .filter(({ kb, limit }) => kb > limit)
  .sort((a, b) => b.kb - a.kb);

const heaviest = [...measured].sort((a, b) => b.kb - a.kb).slice(0, 5);

if (overBudget.length) {
  console.error("FAIL: a route loads more first-load JS than its budget:");
  for (const { route, kb, limit } of overBudget) {
    console.error(`  ${route}: ${kb} KB gzipped (budget ${limit} KB)`);
  }
  console.error("\n  The five heaviest routes, for comparison:");
  for (const { route, kb } of heaviest) console.error(`    ${kb} KB  ${route}`);
  console.error(
    "\n  What to do: find the import that arrived. A library a route does not paint\n" +
      "  with belongs behind `next/dynamic(() => import(…))` — see WF-P07, which was\n" +
      "  written because a static import in a module the layout reaches ships to\n" +
      "  every page. Raise a budget only with a note saying why this route is heavy.",
  );
  process.exit(1);
}

console.log(
  `Bundle budget OK (${measured.length} routes; heaviest ${heaviest[0].kb} KB for ${heaviest[0].route}; default budget ${ROUTE_BUDGET_KB} KB).`,
);

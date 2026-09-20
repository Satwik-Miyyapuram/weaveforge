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
 * ## What the measurements have said so far
 *
 * **The first run** partly refuted `WF-P07`: `/reader` was 207 KB and `/graph`
 * 342 KB, so pdf.js and the force graph were already behind dynamic imports — the
 * half of that finding the audit could not confirm.
 *
 * **The second run** found the real thing, and it was bigger than the import graph
 * suggested: `components/markdown/markdown.tsx` imported KaTeX at module scope, so
 * **six routes** carried a **75 KB gzipped** chunk of it in first-load JS —
 * `/papers` (483 KB), `/report` and `/report/overleaf` (475), `/notes` (467),
 * `/log` (291), `/ai-review` (287). Maths now loads on demand, from
 * `components/markdown/math-renderer.ts`, and only when the text contains a
 * delimiter the renderer actually recognises, so a prose-only screen never fetches
 * it. `/papers` is **409 KB** — 74 KB lighter, about 15% — and no route carries
 * KaTeX eagerly.
 *
 * `/papers` at 409 KB is still heavy and is the next question; the remaining
 * chunks are not dominated by anything this script can name, which means the next
 * step is the bundle analyser rather than another grep.
 *
 * **The third run was this gate failing on its own pull request**, which is the
 * most useful thing it has done: every route measured ~5 KB above the local build,
 * and `/layout` came out at 343 KB against a 340 KB limit. The cause is the build
 * environment, not the code — CI inlines `NEXT_PUBLIC_SUPABASE_URL` and
 * `NEXT_PUBLIC_SUPABASE_ANON_KEY` into the client bundle and the local one does
 * not — so a limit that tight is measuring the machine. Every limit carries
 * `ENVIRONMENT_ALLOWANCE_KB` for that variance; the numbers below are the CI
 * ones, because CI is where the gate has to hold.
 */
const ROUTE_BUDGET_KB = 340;

/**
 * Headroom for the build environment, on every limit.
 *
 * A few KB of inlined public config is not a regression and must not fail a build,
 * while the thing this gate exists for — a 75 KB library arriving on a route — is
 * an order of magnitude larger. Twelve kilobytes covers the measured spread with
 * room to spare; the ratchet still tightens whenever a route genuinely shrinks.
 */
const ENVIRONMENT_ALLOWANCE_KB = 12;

/** Routes already above the default, at their measured size plus a little. */
const ROUTE_ALLOWANCES_KB = {
  "/papers": 425,
  "/report": 415,
  "/notes": 405,
  "/settings": 385,
  "/graph": 365,
};

/** The allowance for a route, longest matching prefix first, plus the environment's. */
function allowanceFor(route) {
  const prefixes = Object.keys(ROUTE_ALLOWANCES_KB).sort((a, b) => b.length - a.length);
  const match = prefixes.find((prefix) => route.startsWith(prefix));
  return (match ? ROUTE_ALLOWANCES_KB[match] : ROUTE_BUDGET_KB) + ENVIRONMENT_ALLOWANCE_KB;
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

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
 * This measures it. For each route the build wrote (see `readRoutes`), the JS
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
import { readdirSync, readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { gzipSync } from "node:zlib";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
// BUNDLE_BUILD_DIR lets a test point this at a made-up build.
const buildDir = process.env.BUNDLE_BUILD_DIR ?? path.join(root, "apps/web/.next");

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
const ROUTE_BUDGET_KB = 410;

/*
 * **The rebase for Next 16** (React 19) changed both the measure and the numbers,
 * so every limit below was set again from one build rather than ratcheted:
 *
 * - The measure. `app-build-manifest.json` is gone; the routes are now read from
 *   each page's client reference manifest, which counts the layout chunks every
 *   page loads. On the same Next 15 build that adds ~40 KB to each page and makes
 *   `/layout` disappear as a separate entry — the shell (`/`, `/_not-found`) is
 *   the floor every route now starts from: 366 KB on Next 15.
 * - The framework. The root chunks went from 91 KB to 137 KB gzipped (React 19's
 *   react-dom and the Next 16 router) while the app's shell chunks shrank 16 KB,
 *   so every route grew by the same ~30 KB and the shell is 396 KB. No app import
 *   arrived; the per-route differences are unchanged from Next 15.
 *
 * The default is the shell plus room for one feature, as before. The allowances
 * are the routes above it at their measured size plus 2 KB, and the notes on them
 * still say what makes each heavy.
 */

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
  "/papers": 485,
  "/report": 452,
  "/notes": 471,
  // the AI review panel and the proposal executors it configures live in the
  // container every route boots, so every route carries their code: +1 KB.
  // Settings houses workspace folder mirror, git 3-way conflict resolution, and sync issues:
  // Plus the local API token panel, Connect panel for local AI clients (0.8.11), and DatePicker.
  // The shared row and tab buttons, connection state and settings find from the
  // design sweep (#527): +4 KB. No dependency arrived.
  "/settings": 488,
  // graph and experiments share the top navigation with live sync status indicators;
  // experiments added the image viewer, result editor and token create form, and
  // graph shares the chunk that carries them: +3 KB each.
  // Graph settings drawer added tabs, relation chips, and reading list integration: +4 KB.
  "/graph": 473,
  // Reader zoom keys in the shell and aborted-transaction recovery in the screen loader: +1 KB.
  // Logged failures and a once-per-mount TeX probe from the S10 sweep (#504): +1 KB.
  // No dependency arrived; the code is the error paths that used to be empty.
  // The S13 sweep (#505) logs live-sync probe and listener failures in the shared
  // top navigation: +1 KB, again error paths and no new dependency.
  "/experiments": 444,
  // The review panel and the PDF reader shell each sit a little above the default.
  "/ai-review": 432,
  "/reader": 428,
  "/dashboard": 427,
  // Lists screen carries reading lists, membership management, and EntityCardMenu:
  "/lists": 425,
  "/log": 422,
  "/plan": 422,
};

/** The allowance for a route, longest matching prefix first, plus the environment's. */
function allowanceFor(route) {
  const prefixes = Object.keys(ROUTE_ALLOWANCES_KB).sort((a, b) => b.length - a.length);
  const match = prefixes.find((prefix) => route.startsWith(prefix));
  return (match ? ROUTE_ALLOWANCES_KB[match] : ROUTE_BUDGET_KB) + ENVIRONMENT_ALLOWANCE_KB;
}

/** Chunks a manifest names that the build did not write; see the check below. */
const missingChunks = new Set();

/** Gzipped size by chunk path: most chunks are shared, so each is compressed once (41-06). */
const gzippedSizes = new Map();

function gzippedChunkSize(file) {
  if (!gzippedSizes.has(file)) gzippedSizes.set(file, measureChunk(file));
  return gzippedSizes.get(file);
}

function measureChunk(file) {
  try {
    return gzipSync(readFileSync(file)).byteLength;
  } catch {
    // Counting it as zero would pass a route whose bytes were never measured (41-05).
    missingChunks.add(path.relative(buildDir, file).split(path.sep).join("/"));
    return 0;
  }
}

/**
 * Every route's first-load JS: the chunks its client components need, plus the
 * framework's root chunks every page boots with.
 *
 * Next 16 dropped `app-build-manifest.json`, which this used to read. What every
 * version still writes is each page's client reference manifest, which lists the
 * chunks of every client module the page renders — its layouts included — and
 * `build-manifest.json`'s `rootMainFiles`. That is the whole of what a cold load
 * of the route fetches, so it is a larger number than the old per-page entry,
 * which left the layout chunks out and counted them once under `/layout`.
 */
function readRoutes() {
  const rootMainFiles = JSON.parse(readFileSync(path.join(buildDir, "build-manifest.json"), "utf8")).rootMainFiles ?? [];
  const appDir = path.join(buildDir, "server/app");
  const routes = new Map();
  for (const entry of readdirSync(appDir, { recursive: true })) {
    const file = String(entry);
    if (path.basename(file) !== "page_client-reference-manifest.js") continue;
    const sandbox = {};
    sandbox.globalThis = sandbox;
    runInNewContext(readFileSync(path.join(appDir, file), "utf8"), sandbox);
    for (const [page, manifest] of Object.entries(sandbox.__RSC_MANIFEST ?? {})) {
      const chunks = Object.values(manifest.clientModules ?? {}).flatMap((mod) => mod.chunks ?? []);
      const route = page.replace(/\/page$/, "") || "/";
      routes.set(route, new Set([...rootMainFiles, ...chunks].filter((chunk) => String(chunk).endsWith(".js"))));
    }
  }
  return routes;
}

let routes;
try {
  routes = readRoutes();
} catch {
  console.error(
    "FAIL: no build output to measure. Run `npm run build` first — this check reads\n" +
      "      .next/build-manifest.json and .next/server/app, which only exist after one.",
  );
  process.exit(1);
}

const measured = [];
for (const [route, files] of routes) {
  let bytes = 0;
  // Manifest paths are relative to the build root (`static/chunks/…`).
  // The manifest names a dynamic segment URL-encoded (`%5Bid%5D`); the file on disk is `[id]`.
  for (const file of files) bytes += gzippedChunkSize(path.join(buildDir, decodeURIComponent(file)));
  measured.push({ route, kb: Math.round(bytes / 1024) });
}

if (missingChunks.size) {
  console.error("FAIL: the build manifest names chunks the build did not write, so their size is unknown:");
  for (const chunk of missingChunks) console.error(`  ${chunk}`);
  console.error("\n  Rebuild (`npm run build`) and run this again on the fresh output.");
  process.exit(1);
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

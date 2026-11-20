/**
 * Turn `run-tests.mjs` arguments into node:test arguments.
 *
 * - Named `*.test.ts(x)` files run alone.
 * - A directory runs only the tests under it (`src/features/ink`).
 * - Nothing named runs the whole suite.
 * - Concurrency is capped (default 4, `WF_TEST_CONCURRENCY` overrides) so a
 *   full run stays under ~3 GB instead of one child per core.
 *
 * Two glob patterns rather than a brace expansion: node's test-runner glob
 * does not expand `{ts,tsx}`, and a pattern that matches nothing is ignored.
 */

const DEFAULT_CONCURRENCY = "4";

export function testArgs(argv, { isDir, env }) {
  const out = [];
  let named = false;
  for (const arg of argv) {
    if (/\.test\.tsx?$/.test(arg)) {
      named = true;
      out.push(arg);
      continue;
    }
    const dir = arg.replace(/\\/g, "/").replace(/\/+$/, "");
    if (!arg.startsWith("-") && isDir(dir)) {
      named = true;
      out.push(`${dir}/**/*.test.ts`, `${dir}/**/*.test.tsx`);
      continue;
    }
    out.push(arg);
  }
  if (!named) out.push("src/**/*.test.ts", "src/**/*.test.tsx");
  if (!argv.some((a) => a.startsWith("--test-concurrency"))) {
    out.unshift(`--test-concurrency=${env.WF_TEST_CONCURRENCY ?? DEFAULT_CONCURRENCY}`);
  }
  return out;
}

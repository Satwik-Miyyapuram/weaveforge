/**
 * Turn `run-tests.mjs` arguments into node:test arguments.
 *
 * - Named `*.test.ts(x)` files run alone.
 * - A directory runs only the tests under it (`src/features/ink`).
 * - Nothing named runs the whole suite.
 * - One test file at a time by default (`WF_TEST_CONCURRENCY` or an explicit
 *   flag overrides), not one child per core, for the 1 GB RAM rule (P1-8).
 *
 * Two glob patterns rather than a brace expansion: node's test-runner glob
 * does not expand `{ts,tsx}`, and a pattern that matches nothing is ignored.
 */

const DEFAULT_CONCURRENCY = "1";

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

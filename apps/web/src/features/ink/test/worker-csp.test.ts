/**
 * The CSP the ink worker needs, asserted as configuration.
 *
 * The plan's step 2 says "add `worker-src 'self' blob:` to the web CSP, and add a
 * browser test that constructs the worker in a production build rather than only
 * in dev". The second half of that is a browser test this suite cannot be, so what
 * is checked here is the half that is a fact about the repository: both builds
 * allow a blob worker, because the failure it prevents is environment-specific —
 * ink rendering working on the desktop shell and silently failing on the web.
 *
 * The production-build browser test stays on the open list.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
  "..",
  "..",
);

function read(relative: string): string {
  return readFileSync(path.join(repoRoot, relative), "utf8");
}

test("the web CSP allows a blob worker, which is what the ink worker is emitted as", () => {
  const config = read("apps/web/next.config.mjs");
  assert.match(
    config,
    /worker-src 'self' blob:/,
    "without worker-src the CSP falls back to script-src, which has no blob:",
  );
});

test("the desktop shell already allowed it, which is why omitting it fails on web only", () => {
  const protocol = read("apps/desktop/src/app-protocol.ts");
  assert.match(protocol, /worker-src 'self' blob:/);
});

test("the worker file the hook constructs exists where the hook says it does", () => {
  const hook = read("apps/web/src/features/ink/application/use-pen-capture.ts");
  const match = /new URL\("([^"]*ink-worker\.ts)", import\.meta\.url\)/.exec(
    hook,
  );
  assert.ok(
    match,
    "the hook must construct the worker by a bundler-visible URL",
  );
  const worker = path.resolve(
    repoRoot,
    "apps/web/src/features/ink/application",
    match![1]!,
  );
  assert.doesNotThrow(
    () => readFileSync(worker, "utf8"),
    `the worker the hook constructs must exist: ${worker}`,
  );
});

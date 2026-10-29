/**
 * The PDF viewer embeds the compiled PDF as `<iframe src="blob:...">`. Without an
 * explicit `frame-src` the CSP falls back through `child-src` to `default-src
 * 'self'`, which refuses a blob frame, so the viewer renders blank on the web.
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

test("the web CSP allows a blob frame for the Workshop PDF viewer", () => {
  const config = read("apps/web/next.config.mjs");
  assert.match(
    config,
    /"frame-src 'self' blob:"/,
    "without frame-src the CSP falls back to default-src 'self', which refuses blob: frames",
  );
});

test("the frame-src directive is not weakened to allow any origin", () => {
  const config = read("apps/web/next.config.mjs");
  const directive = /"frame-src ([^"]*)"/.exec(config);
  assert.ok(directive, "frame-src must be declared");
  assert.doesNotMatch(directive![1]!, /\*|https?:/);
});

test("the viewer frames only a blob URL, which the CSP now allows", () => {
  const viewer = read(
    "apps/web/src/features/report/ui/workshop-pdf-viewer.tsx",
  );
  assert.match(viewer, /<iframe[\s\S]*?src=\{/);
  assert.match(viewer, /URL\.createObjectURL/);
});

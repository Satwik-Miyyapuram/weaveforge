import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../check-bundle-budget.mjs");

/** A build directory with one route whose page needs `chunks`; `present` are written to disk. */
function fakeBuild(chunks, present) {
  const dir = mkdtempSync(path.join(tmpdir(), "wf-budget-"));
  writeFileSync(path.join(dir, "build-manifest.json"), JSON.stringify({ rootMainFiles: [] }));
  const page = path.join(dir, "server/app/papers");
  mkdirSync(page, { recursive: true });
  const manifest = { "/papers/page": { clientModules: { m: { chunks } } } };
  writeFileSync(
    path.join(page, "page_client-reference-manifest.js"),
    `globalThis.__RSC_MANIFEST = ${JSON.stringify(manifest)};`,
  );
  mkdirSync(path.join(dir, "static/chunks"), { recursive: true });
  for (const chunk of present) writeFileSync(path.join(dir, chunk), "console.log(1);");
  return dir;
}

function run(buildDir) {
  return spawnSync(process.execPath, [script], { env: { ...process.env, BUNDLE_BUILD_DIR: buildDir }, encoding: "utf8" });
}

test("a route within budget passes", () => {
  const out = run(fakeBuild(["static/chunks/a.js"], ["static/chunks/a.js"]));
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /Bundle budget OK \(1 routes/);
});

test("a chunk the manifest names but the build lacks fails the gate, not counts as zero (41-05)", () => {
  const out = run(fakeBuild(["static/chunks/a.js", "static/chunks/gone.js"], ["static/chunks/a.js"]));
  assert.equal(out.status, 1);
  assert.match(out.stderr, /static\/chunks\/gone\.js/);
});

// Keeps .github/workflows/release-desktop.yml in step with the release scripts and CI:
// every updater platform is built, the x64 Postgres pin matches CI's, and the release
// goes out as a pre-release (Latest stays a manual promotion).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PLATFORMS } from "./release-manifest.mjs";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const workflow = readFileSync(`${root}.github/workflows/release-desktop.yml`, "utf8");
const ci = readFileSync(`${root}.github/workflows/ci.yml`, "utf8");

test("builds every arch latest.json needs", () => {
  const arches = [...workflow.matchAll(/^\s+- arch: (\S+)$/gm)].map((m) => m[1]);
  assert.deepEqual(arches.sort(), Object.values(PLATFORMS).sort());
});

test("x64 Postgres pin matches CI", () => {
  const ciHash = ci.match(/\$hash -ne "([0-9A-F]{64})"/)[1];
  const x64 = workflow.match(/arch: x64[\s\S]*?postgres_sha256: ([0-9A-F]{64})/)[1];
  assert.equal(x64, ciHash);
});

test("triggers on desktop tags only", () => {
  assert.match(workflow, /tags: \["v\*\.\*\.\*"\]/);
});

test("signs with the updater key and publishes a pre-release", () => {
  assert.match(workflow, /TAURI_SIGNING_PRIVATE_KEY: \$\{\{ secrets\.TAURI_SIGNING_PRIVATE_KEY \}\}/);
  assert.match(workflow, /write-latest-json\.mjs "\$TAG" dist/);
  assert.match(workflow, /gh release create "\$TAG" --verify-tag --prerelease /);
  assert.doesNotMatch(workflow, /--latest/);
});

test("CI bundles without the updater key; the release never does", () => {
  assert.match(ci, /--config tauri\.bundle\.json --config tauri\.unsigned\.json/);
  assert.doesNotMatch(workflow, /tauri\.unsigned\.json/);
  const unsigned = JSON.parse(readFileSync(`${root}apps/shell/tauri.unsigned.json`, "utf8"));
  assert.equal(unsigned.bundle.createUpdaterArtifacts, false);
});

// Keeps .github/workflows/release-desktop.yml in step with the release scripts and CI:
// every updater platform is built, the x64 Postgres pin matches CI's, and the release
// goes out as a pre-release (Latest stays a manual promotion).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { MANIFEST_NAME, PLATFORMS } from "./release-manifest.mjs";

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
  assert.match(workflow, /gh release download v0\.9\.7 --pattern latest\.json --dir bridge/);
  assert.match(workflow, /gh release create "\$TAG" --verify-tag --draft --prerelease /);
  assert.doesNotMatch(workflow, /--latest/);
});

test("the release is created as a draft, checked, and only then published", () => {
  const create = workflow.indexOf('gh release create "$TAG" --verify-tag --draft --prerelease');
  const check = workflow.indexOf('node apps/shell/scripts/check-release-assets.mjs "$TAG"');
  const publish = workflow.indexOf('gh release edit "$TAG" --draft=false');
  assert.ok(create >= 0, "gh release create runs as a draft");
  assert.ok(check > create, "the check runs after the draft is created");
  assert.ok(publish > check, "the draft is published only after the check");
});

test("CI bundles without the updater key; the release never does", () => {
  assert.match(ci, /--config tauri\.bundle\.json --config tauri\.unsigned\.json/);
  assert.doesNotMatch(workflow, /tauri\.unsigned\.json/);
  const unsigned = JSON.parse(readFileSync(`${root}apps/shell/tauri.unsigned.json`, "utf8"));
  assert.equal(unsigned.bundle.createUpdaterArtifacts, false);
});

test("the updater reads latest-v2.json; 0.9.6 clients keep reading the latest.json bridge", () => {
  const conf = JSON.parse(readFileSync(`${root}apps/shell/tauri.conf.json`, "utf8"));
  const endpoints = conf.plugins.updater.endpoints;
  assert.equal(endpoints.length, 1);
  assert.match(endpoints[0], /\/releases\/latest\/download\/latest-v2\.json$/);
});

test("the updater endpoint is the manifest the release scripts write (MANIFEST_NAME)", () => {
  const conf = JSON.parse(readFileSync(`${root}apps/shell/tauri.conf.json`, "utf8"));
  const [endpoint] = conf.plugins.updater.endpoints;
  assert.ok(endpoint.endsWith(`/${MANIFEST_NAME}`), `${endpoint} does not end with ${MANIFEST_NAME}`);
});

test("the workflow header names latest-v2.json as the manifest the updater reads", () => {
  assert.match(workflow.split("\n").slice(0, 8).join("\n"), /reads latest-v2\.json from the Latest release only/);
});

test("a validate job rejects any tag that is not vX.Y.Z before anything is built", () => {
  const validate = workflow.match(/^  validate:\n([\s\S]*?)(?=^  \w)/m);
  assert.ok(validate, "the workflow has a validate job");
  assert.match(validate[1], /\[\[ ! "\$TAG" =~ \^v\[0-9\]\+\\.\[0-9\]\+\\.\[0-9\]\+\$ \]\]/);
  assert.match(workflow, /^  build:\n(?:    .*\n)*?    needs: validate\n/m);
});

test("the tag pattern takes vX.Y.Z and refuses release candidates", () => {
  // Parsed from the workflow, so the test checks the regex the job really runs.
  const source = workflow.match(/"\$TAG" =~ (\^[^\s]+\$) \]\]/);
  assert.ok(source, "the validate step has a tag regex");
  const vxyz = new RegExp(source[1]);
  assert.ok(vxyz.test("v0.9.7"));
  assert.ok(vxyz.test("v1.0.0"));
  assert.ok(!vxyz.test("v0.9.7-rc1"));
  assert.ok(!vxyz.test("v0.9.7-rc.1"));
  assert.ok(!vxyz.test("v0.9"));
  assert.ok(!vxyz.test("v0x9x7"));
});

test("the published release is checked against the gate after it is created", () => {
  const create = workflow.indexOf('gh release create "$TAG"');
  const check = workflow.indexOf('node apps/shell/scripts/check-release-assets.mjs "$TAG"');
  assert.ok(create > 0, "the workflow creates the release");
  assert.ok(check > create, "check-release-assets runs after gh release create");
});
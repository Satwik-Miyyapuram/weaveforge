import { test } from "node:test";
import assert from "node:assert/strict";
import { checkRelease } from "./check-release-assets.mjs";

const TAG = "v0.9.1";
const URL_BASE = "https://github.com/Satwik-Miyyapuram/weaveforge/releases/download/v0.9.1";
const SIG_X64 = Buffer.from("untrusted comment: x64\nRUQx64\n").toString("base64");
const SIG_ARM = Buffer.from("untrusted comment: arm64\nRUQarm\n").toString("base64");

/** A release as `gh api repos/.../releases/tags/<tag>` returns it, parsed from JSON text. */
function releaseFixture(assetNames = ALL) {
  const assets = assetNames.map((name) => ({ name, browser_download_url: `${URL_BASE}/${name}` }));
  return JSON.parse(JSON.stringify({ tag_name: TAG, draft: false, prerelease: true, assets }));
}

const ALL = [
  "WeaveForge_0.9.1_x64-setup.exe",
  "WeaveForge_0.9.1_x64-setup.exe.sig",
  "WeaveForge_0.9.1_arm64-setup.exe",
  "WeaveForge_0.9.1_arm64-setup.exe.sig",
  "latest.json",
];

/** latest.json as the release script writes it, parsed from JSON text. */
function manifestFixture(overrides = {}) {
  const manifest = {
    version: "0.9.1",
    notes: "",
    pub_date: "2026-11-16T10:00:00Z",
    platforms: {
      "windows-x86_64": { signature: SIG_X64, url: `${URL_BASE}/WeaveForge_0.9.1_x64-setup.exe` },
      "windows-aarch64": { signature: SIG_ARM, url: `${URL_BASE}/WeaveForge_0.9.1_arm64-setup.exe` },
    },
    ...overrides,
  };
  return JSON.stringify(manifest);
}

/** Serves asset text by name, like downloading the release assets would. */
function assetsFrom(files) {
  return async (name) => (name in files ? files[name] : null);
}

const GOOD_FILES = () => ({
  "WeaveForge_0.9.1_x64-setup.exe.sig": `${SIG_X64}\n`,
  "WeaveForge_0.9.1_arm64-setup.exe.sig": SIG_ARM,
  "latest.json": manifestFixture(),
});

test("a complete release with a matching manifest has no problems", async () => {
  const problems = await checkRelease({
    tag: TAG,
    release: releaseFixture(),
    readAsset: assetsFrom(GOOD_FILES()),
  });
  assert.deepEqual(problems, []);
});

test("a missing x64 setup.exe is reported", async () => {
  const problems = await checkRelease({
    tag: TAG,
    release: releaseFixture(ALL.filter((n) => n !== "WeaveForge_0.9.1_x64-setup.exe")),
    readAsset: assetsFrom(GOOD_FILES()),
  });
  assert.ok(problems.some((p) => p.includes("WeaveForge_0.9.1_x64-setup.exe") && p.includes("missing")));
});

test("a missing arm64 setup.exe is reported", async () => {
  const problems = await checkRelease({
    tag: TAG,
    release: releaseFixture(ALL.filter((n) => n !== "WeaveForge_0.9.1_arm64-setup.exe")),
    readAsset: assetsFrom(GOOD_FILES()),
  });
  assert.ok(problems.some((p) => p.includes("WeaveForge_0.9.1_arm64-setup.exe") && p.includes("missing")));
});

test("a setup.exe without its .sig is reported, per architecture", async () => {
  const problems = await checkRelease({
    tag: TAG,
    release: releaseFixture(ALL.filter((n) => n !== "WeaveForge_0.9.1_arm64-setup.exe.sig")),
    readAsset: assetsFrom(GOOD_FILES()),
  });
  assert.ok(problems.some((p) => p.includes("WeaveForge_0.9.1_arm64-setup.exe.sig")));
  assert.equal(problems.some((p) => p.includes("x64")), false);
});

test("a missing latest.json is reported", async () => {
  const problems = await checkRelease({
    tag: TAG,
    release: releaseFixture(ALL.filter((n) => n !== "latest.json")),
    readAsset: assetsFrom(GOOD_FILES()),
  });
  assert.ok(problems.some((p) => p.includes("latest.json") && p.includes("missing")));
});

test("a latest.json whose version is not the tag is reported", async () => {
  const files = GOOD_FILES();
  files["latest.json"] = manifestFixture({ version: "0.9.0" });
  const problems = await checkRelease({ tag: TAG, release: releaseFixture(), readAsset: assetsFrom(files) });
  assert.ok(problems.some((p) => p.includes("0.9.0") && p.includes("0.9.1")));
});

test("manifest URLs that point at another tag's assets are reported", async () => {
  const files = GOOD_FILES();
  files["latest.json"] = manifestFixture({
    platforms: {
      "windows-x86_64": {
        signature: SIG_X64,
        url: "https://github.com/Satwik-Miyyapuram/weaveforge/releases/download/v0.9.0/WeaveForge_0.9.1_x64-setup.exe",
      },
      "windows-aarch64": { signature: SIG_ARM, url: `${URL_BASE}/WeaveForge_0.9.1_arm64-setup.exe` },
    },
  });
  const problems = await checkRelease({ tag: TAG, release: releaseFixture(), readAsset: assetsFrom(files) });
  assert.ok(problems.some((p) => p.includes("windows-x86_64") && p.includes("url")));
  assert.equal(problems.some((p) => p.includes("windows-aarch64")), false);
});

test("a manifest signature that is not the uploaded .sig is reported", async () => {
  const files = GOOD_FILES();
  files["latest.json"] = manifestFixture({
    platforms: {
      "windows-x86_64": { signature: SIG_X64, url: `${URL_BASE}/WeaveForge_0.9.1_x64-setup.exe` },
      "windows-aarch64": { signature: "stale", url: `${URL_BASE}/WeaveForge_0.9.1_arm64-setup.exe` },
    },
  });
  const problems = await checkRelease({ tag: TAG, release: releaseFixture(), readAsset: assetsFrom(files) });
  assert.ok(problems.some((p) => p.includes("windows-aarch64") && p.includes("signature")));
});

test("a latest.json that cannot be read or parsed is reported, not thrown", async () => {
  const files = GOOD_FILES();
  files["latest.json"] = "{not json";
  const problems = await checkRelease({ tag: TAG, release: releaseFixture(), readAsset: assetsFrom(files) });
  assert.ok(problems.some((p) => p.includes("latest.json") && p.includes("parse")));

  const unreadable = await checkRelease({
    tag: TAG,
    release: releaseFixture(),
    readAsset: assetsFrom({ ...GOOD_FILES(), "latest.json": null }),
  });
  assert.ok(unreadable.some((p) => p.includes("latest.json") && p.includes("download")));
});

test("a release whose tag is not the one asked for is reported", async () => {
  const release = releaseFixture();
  release.tag_name = "v0.9.0";
  const problems = await checkRelease({ tag: TAG, release, readAsset: assetsFrom(GOOD_FILES()) });
  assert.ok(problems.some((p) => p.includes("v0.9.0")));
});

test("an asset whose download URL points at another tag is reported", async () => {
  const release = releaseFixture();
  const asset = release.assets.find((a) => a.name === "WeaveForge_0.9.1_arm64-setup.exe");
  asset.browser_download_url = `https://github.com/Satwik-Miyyapuram/weaveforge/releases/download/v0.9.0/${asset.name}`;
  const problems = await checkRelease({ tag: TAG, release, readAsset: assetsFrom(GOOD_FILES()) });
  assert.ok(problems.some((p) => p.includes("WeaveForge_0.9.1_arm64-setup.exe") && p.includes("URL")));
});

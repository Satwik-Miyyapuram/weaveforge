import { test } from "node:test";
import assert from "node:assert/strict";
import { checkRelease } from "./check-release-assets.mjs";

const TAG = "v0.9.7";
const URL_BASE = "https://github.com/Satwik-Miyyapuram/weaveforge/releases/download/v0.9.7";
const SIG_X64 = Buffer.from("untrusted comment: x64\nRUQx64\n").toString("base64");
const SIG_ARM = Buffer.from("untrusted comment: arm64\nRUQarm\n").toString("base64");

/** A release as `gh api repos/.../releases/tags/<tag>` returns it, parsed from JSON text. */
function releaseFixture(assetNames = ALL) {
  const assets = assetNames.map((name) => ({ name, browser_download_url: `${URL_BASE}/${name}` }));
  return JSON.parse(JSON.stringify({ tag_name: TAG, draft: false, prerelease: true, assets }));
}

const ALL = [
  "WeaveForge_0.9.7_x64-setup.exe",
  "WeaveForge_0.9.7_x64-setup.exe.sig",
  "WeaveForge_0.9.7_arm64-setup.exe",
  "WeaveForge_0.9.7_arm64-setup.exe.sig",
  "latest-v2.json",
  "latest.json",
];

/** latest.json as the release script writes it, parsed from JSON text. */
function manifestFixture(overrides = {}) {
  const manifest = {
    version: "0.9.7",
    notes: "",
    pub_date: "2026-11-16T10:00:00Z",
    platforms: {
      "windows-x86_64": { signature: SIG_X64, url: `${URL_BASE}/WeaveForge_0.9.7_x64-setup.exe` },
      "windows-aarch64": { signature: SIG_ARM, url: `${URL_BASE}/WeaveForge_0.9.7_arm64-setup.exe` },
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
  "WeaveForge_0.9.7_x64-setup.exe.sig": `${SIG_X64}\n`,
  "WeaveForge_0.9.7_arm64-setup.exe.sig": SIG_ARM,
  "latest-v2.json": manifestFixture(),
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
    release: releaseFixture(ALL.filter((n) => n !== "WeaveForge_0.9.7_x64-setup.exe")),
    readAsset: assetsFrom(GOOD_FILES()),
  });
  assert.ok(problems.some((p) => p.includes("WeaveForge_0.9.7_x64-setup.exe") && p.includes("missing")));
});

test("a missing arm64 setup.exe is reported", async () => {
  const problems = await checkRelease({
    tag: TAG,
    release: releaseFixture(ALL.filter((n) => n !== "WeaveForge_0.9.7_arm64-setup.exe")),
    readAsset: assetsFrom(GOOD_FILES()),
  });
  assert.ok(problems.some((p) => p.includes("WeaveForge_0.9.7_arm64-setup.exe") && p.includes("missing")));
});

test("a setup.exe without its .sig is reported, per architecture", async () => {
  const problems = await checkRelease({
    tag: TAG,
    release: releaseFixture(ALL.filter((n) => n !== "WeaveForge_0.9.7_arm64-setup.exe.sig")),
    readAsset: assetsFrom(GOOD_FILES()),
  });
  assert.ok(problems.some((p) => p.includes("WeaveForge_0.9.7_arm64-setup.exe.sig")));
  assert.equal(problems.some((p) => p.includes("x64")), false);
});

test("a missing latest-v2.json is reported", async () => {
  const problems = await checkRelease({
    tag: TAG,
    release: releaseFixture(ALL.filter((n) => n !== "latest-v2.json")),
    readAsset: assetsFrom(GOOD_FILES()),
  });
  assert.ok(problems.some((p) => p.includes("latest-v2.json") && p.includes("missing")));
});

test("a latest-v2.json whose version is not the tag is reported", async () => {
  const files = GOOD_FILES();
  files["latest-v2.json"] = manifestFixture({ version: "0.9.0" });
  const problems = await checkRelease({ tag: TAG, release: releaseFixture(), readAsset: assetsFrom(files) });
  assert.ok(problems.some((p) => p.includes("0.9.0") && p.includes("0.9.7")));
});

test("manifest URLs that point at another tag's assets are reported", async () => {
  const files = GOOD_FILES();
  files["latest-v2.json"] = manifestFixture({
    platforms: {
      "windows-x86_64": {
        signature: SIG_X64,
        url: "https://github.com/Satwik-Miyyapuram/weaveforge/releases/download/v0.9.0/WeaveForge_0.9.7_x64-setup.exe",
      },
      "windows-aarch64": { signature: SIG_ARM, url: `${URL_BASE}/WeaveForge_0.9.7_arm64-setup.exe` },
    },
  });
  const problems = await checkRelease({ tag: TAG, release: releaseFixture(), readAsset: assetsFrom(files) });
  assert.ok(problems.some((p) => p.includes("windows-x86_64") && p.includes("url")));
  assert.equal(problems.some((p) => p.includes("windows-aarch64")), false);
});

test("a manifest signature that is not the uploaded .sig is reported", async () => {
  const files = GOOD_FILES();
  files["latest-v2.json"] = manifestFixture({
    platforms: {
      "windows-x86_64": { signature: SIG_X64, url: `${URL_BASE}/WeaveForge_0.9.7_x64-setup.exe` },
      "windows-aarch64": { signature: "stale", url: `${URL_BASE}/WeaveForge_0.9.7_arm64-setup.exe` },
    },
  });
  const problems = await checkRelease({ tag: TAG, release: releaseFixture(), readAsset: assetsFrom(files) });
  assert.ok(problems.some((p) => p.includes("windows-aarch64") && p.includes("signature")));
});

test("a latest-v2.json that cannot be read or parsed is reported, not thrown", async () => {
  const files = GOOD_FILES();
  files["latest-v2.json"] = "{not json";
  const problems = await checkRelease({ tag: TAG, release: releaseFixture(), readAsset: assetsFrom(files) });
  assert.ok(problems.some((p) => p.includes("latest-v2.json") && p.includes("parse")));

  const unreadable = await checkRelease({
    tag: TAG,
    release: releaseFixture(),
    readAsset: assetsFrom({ ...GOOD_FILES(), "latest-v2.json": null }),
  });
  assert.ok(unreadable.some((p) => p.includes("latest-v2.json") && p.includes("download")));
});

test("a release whose tag is not the one asked for is reported", async () => {
  const release = releaseFixture();
  release.tag_name = "v0.9.0";
  const problems = await checkRelease({ tag: TAG, release, readAsset: assetsFrom(GOOD_FILES()) });
  assert.ok(problems.some((p) => p.includes("v0.9.0")));
});

test("an asset whose download URL points at another tag is reported", async () => {
  const release = releaseFixture();
  const asset = release.assets.find((a) => a.name === "WeaveForge_0.9.7_arm64-setup.exe");
  asset.browser_download_url = `https://github.com/Satwik-Miyyapuram/weaveforge/releases/download/v0.9.0/${asset.name}`;
  const problems = await checkRelease({ tag: TAG, release, readAsset: assetsFrom(GOOD_FILES()) });
  assert.ok(problems.some((p) => p.includes("WeaveForge_0.9.7_arm64-setup.exe") && p.includes("URL")));
});

// Two manifests per release. A 0.9.8 release keeps latest.json at the 0.9.7 bridge.
const TAG8 = "v0.9.8";
const URL8 = "https://github.com/Satwik-Miyyapuram/weaveforge/releases/download/v0.9.8";
const NAMES8 = [
  "WeaveForge_0.9.8_x64-setup.exe",
  "WeaveForge_0.9.8_x64-setup.exe.sig",
  "WeaveForge_0.9.8_arm64-setup.exe",
  "WeaveForge_0.9.8_arm64-setup.exe.sig",
  "latest-v2.json",
  "latest.json",
];
const release8 = (names = NAMES8) => ({
  tag_name: TAG8,
  draft: false,
  prerelease: true,
  assets: names.map((name) => ({ name, browser_download_url: `${URL8}/${name}` })),
});
const manifest8 = JSON.stringify({
  version: "0.9.8",
  notes: "",
  pub_date: "2026-11-22T00:00:00Z",
  platforms: {
    "windows-x86_64": { signature: SIG_X64, url: `${URL8}/WeaveForge_0.9.8_x64-setup.exe` },
    "windows-aarch64": { signature: SIG_ARM, url: `${URL8}/WeaveForge_0.9.8_arm64-setup.exe` },
  },
});
const files8 = (legacyText) => ({
  "WeaveForge_0.9.8_x64-setup.exe.sig": `${SIG_X64}\n`,
  "WeaveForge_0.9.8_arm64-setup.exe.sig": SIG_ARM,
  "latest-v2.json": manifest8,
  "latest.json": legacyText,
});
const BRIDGE = JSON.parse(manifestFixture());

test("a 0.9.8 release passes when latest.json is the 0.9.7 bridge it was given", async () => {
  const problems = await checkRelease({
    tag: TAG8,
    release: release8(),
    readAsset: assetsFrom(files8(manifestFixture())),
    bridge: BRIDGE,
  });
  assert.deepEqual(problems, []);
});

test("a 0.9.8 release whose latest.json is not the 0.9.7 bridge is reported", async () => {
  const problems = await checkRelease({
    tag: TAG8,
    release: release8(),
    readAsset: assetsFrom(files8(manifest8)),
    bridge: BRIDGE,
  });
  assert.ok(problems.some((p) => p.includes("latest.json") && p.includes("0.9.7")));
});

test("a 0.9.8 release with no bridge to compare against says so, instead of passing", async () => {
  const problems = await checkRelease({
    tag: TAG8,
    release: release8(),
    readAsset: assetsFrom(files8(manifestFixture())),
  });
  assert.ok(problems.some((p) => p.includes("latest.json") && p.includes("bridge")));
});

test("a 0.9.8 release missing latest.json is reported", async () => {
  const problems = await checkRelease({
    tag: TAG8,
    release: release8(NAMES8.filter((n) => n !== "latest.json")),
    readAsset: assetsFrom(files8(manifestFixture())),
    bridge: BRIDGE,
  });
  assert.ok(problems.some((p) => p.includes("latest.json") && p.includes("missing")));
});

test("a 0.9.8 release missing latest-v2.json is reported", async () => {
  const problems = await checkRelease({
    tag: TAG8,
    release: release8(NAMES8.filter((n) => n !== "latest-v2.json")),
    readAsset: assetsFrom(files8(manifestFixture())),
    bridge: BRIDGE,
  });
  assert.ok(problems.some((p) => p.includes("latest-v2.json") && p.includes("missing")));
});

test("a 0.9.7 release whose latest.json is not the same manifest as latest-v2.json is reported", async () => {
  const problems = await checkRelease({
    tag: TAG,
    release: releaseFixture(),
    readAsset: assetsFrom({ ...GOOD_FILES(), "latest.json": manifestFixture({ version: "0.9.6" }) }),
  });
  assert.ok(problems.some((p) => p.includes("latest.json") && p.includes("0.9.6")));
});

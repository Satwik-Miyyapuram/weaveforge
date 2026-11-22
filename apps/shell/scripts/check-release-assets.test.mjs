import { test } from "node:test";
import assert from "node:assert/strict";
import { assetRequest, checkRelease, findRelease, parseBridge } from "./check-release-assets.mjs";

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
const BRIDGE_TEXT = manifestFixture();

test("a 0.9.8 release passes when latest.json is the 0.9.7 bridge it was given", async () => {
  const problems = await checkRelease({
    tag: TAG8,
    release: release8(),
    readAsset: assetsFrom(files8(manifestFixture())),
    bridgeBytes: BRIDGE_TEXT,
  });
  assert.deepEqual(problems, []);
});

test("a 0.9.8 latest.json with the same keys in another order is reported: the bridge is compared byte for byte", async () => {
  const reordered = JSON.stringify(Object.fromEntries(Object.entries(BRIDGE).reverse()), null, 2) + "\n";
  const problems = await checkRelease({
    tag: TAG8,
    release: release8(),
    readAsset: assetsFrom(files8(reordered)),
    bridgeBytes: BRIDGE_TEXT,
  });
  assert.ok(problems.some((p) => p.includes("latest.json") && p.includes("byte")), problems.join("\n"));
});

/** Runs the 0.9.8 check with the given latest.json bytes against the 0.9.7 bridge. */
function problemsWithLegacy(legacy) {
  return checkRelease({
    tag: TAG8,
    release: release8(),
    readAsset: assetsFrom(files8(legacy)),
    bridgeBytes: BRIDGE_TEXT,
  });
}

test("a 0.9.8 latest.json equal in JSON but indented differently is reported: bytes decide", async () => {
  const problems = await problemsWithLegacy(JSON.stringify(BRIDGE, null, 4) + "\n");
  assert.ok(problems.some((p) => p.includes("latest.json") && p.includes("byte")), problems.join("\n"));
});

test("a 0.9.8 latest.json equal in JSON but with CRLF line endings is reported: bytes decide", async () => {
  const crlf = (JSON.stringify(BRIDGE, null, 2) + "\n").replace(/\n/g, "\r\n");
  const problems = await problemsWithLegacy(crlf);
  assert.ok(problems.some((p) => p.includes("latest.json") && p.includes("byte")), problems.join("\n"));
});

test("a 0.9.8 latest.json equal in JSON but missing the trailing newline is reported: bytes decide", async () => {
  const problems = await problemsWithLegacy(JSON.stringify(BRIDGE, null, 2));
  assert.ok(problems.some((p) => p.includes("latest.json") && p.includes("byte")), problems.join("\n"));
});

test("a 0.9.8 latest.json with a UTF-8 byte order mark is reported", async () => {
  const withBom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(BRIDGE_TEXT)]);
  const problems = await problemsWithLegacy(withBom);
  assert.ok(problems.some((p) => p.includes("latest.json")), problems.join("\n"));
});

test("a 0.9.8 release whose latest.json is not the 0.9.7 bridge is reported", async () => {
  const problems = await checkRelease({
    tag: TAG8,
    release: release8(),
    readAsset: assetsFrom(files8(manifest8)),
    bridgeBytes: BRIDGE_TEXT,
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
    bridgeBytes: BRIDGE_TEXT,
  });
  assert.ok(problems.some((p) => p.includes("latest.json") && p.includes("missing")));
});

test("a 0.9.8 release missing latest-v2.json is reported", async () => {
  const problems = await checkRelease({
    tag: TAG8,
    release: release8(NAMES8.filter((n) => n !== "latest-v2.json")),
    readAsset: assetsFrom(files8(manifestFixture())),
    bridgeBytes: BRIDGE_TEXT,
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

test("a bridge latest.json that does not parse is reported, not thrown", () => {
  const { bridge, problems } = parseBridge("{ not json");
  assert.equal(bridge, undefined);
  assert.deepEqual(problems, ["bridge latest.json does not parse"]);
});

test("a readable bridge latest.json parses with no problems", () => {
  const { bridge, problems } = parseBridge(JSON.stringify(BRIDGE));
  assert.deepEqual(bridge, BRIDGE);
  assert.deepEqual(problems, []);
});

test("a bridge latest.json with no platforms is reported: it must name at least one download", () => {
  const { problems } = parseBridge(JSON.stringify({ ...BRIDGE, platforms: {} }));
  assert.ok(problems.some((p) => p.includes("platforms")), problems.join("; "));
});

test("a missing bridge latest.json is left for the release check to report", () => {
  assert.deepEqual(parseBridge(""), { bridge: undefined, problems: [] });
});

test("a release after 0.9.7 without latest.json is reported: 0.9.6 clients read it from releases/latest", async () => {
  const tag = "v0.9.8";
  const names = [
    "WeaveForge_0.9.8_x64-setup.exe",
    "WeaveForge_0.9.8_x64-setup.exe.sig",
    "WeaveForge_0.9.8_arm64-setup.exe",
    "WeaveForge_0.9.8_arm64-setup.exe.sig",
    "latest-v2.json",
  ];
  const release = {
    tag_name: tag,
    draft: false,
    prerelease: true,
    assets: names.map((name) => ({ name, browser_download_url: `https://github.com/Satwik-Miyyapuram/weaveforge/releases/download/${tag}/${name}` })),
  };
  const files = {
    "WeaveForge_0.9.8_x64-setup.exe.sig": SIG_X64,
    "WeaveForge_0.9.8_arm64-setup.exe.sig": SIG_ARM,
    "latest-v2.json": manifestFixture({ version: "0.9.8" }),
  };
  const problems = await checkRelease({ tag, release, readAsset: assetsFrom(files) });
  assert.ok(problems.some((p) => p.includes("latest.json") && p.includes("missing")), problems.join("\n"));
});

test("a bridge latest.json for another version is reported: the bridge must be 0.9.7", () => {
  const { problems } = parseBridge(manifestFixture({ version: "0.9.6" }).replace('"version":"0.9.7"', '"version":"0.9.6"'));
  assert.ok(problems.some((p) => p.includes("0.9.6") && p.includes("0.9.7")), problems.join("; "));
});

test("a bridge latest.json whose URLs point at another tag is reported", () => {
  const { problems } = parseBridge(manifestFixture().replaceAll("/download/v0.9.7/", "/download/v0.9.8/"));
  assert.ok(problems.some((p) => p.includes("v0.9.8")), problems.join("; "));
});
test("a draft release is found by tag in the release list", () => {
  const releases = [
    { tag_name: "v0.9.7", draft: false, assets: [] },
    { tag_name: "v0.9.8", draft: true, assets: [] },
  ];
  assert.equal(findRelease(releases, "v0.9.8")?.draft, true);
  assert.equal(findRelease(releases, "v0.9.9"), undefined);
});

test("a draft asset is downloaded through its API url with auth when GH_TOKEN is set", () => {
  const asset = {
    name: "WeaveForge_0.9.8_x64-setup.exe",
    url: "https://api.github.com/repos/o/r/releases/assets/42",
    browser_download_url: "https://github.com/o/r/releases/download/v0.9.8/WeaveForge_0.9.8_x64-setup.exe",
  };
  const withToken = assetRequest(asset, { GH_TOKEN: "t0k" });
  assert.equal(withToken.url, asset.url);
  assert.equal(withToken.headers.Accept, "application/octet-stream");
  assert.equal(withToken.headers.Authorization, "Bearer t0k");
});

test("without a token a public asset is downloaded from browser_download_url with no auth", () => {
  const asset = { name: "latest-v2.json", url: "https://api.github.com/x", browser_download_url: "https://github.com/y" };
  const plain = assetRequest(asset, {});
  assert.equal(plain.url, "https://github.com/y");
  assert.equal(plain.headers.Authorization, undefined);
});

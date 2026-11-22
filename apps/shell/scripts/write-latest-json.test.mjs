import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildFromFiles, writeManifests } from "./write-latest-json.mjs";
import { compareVersions } from "./release-manifest.mjs";

const SIG = Buffer.from(
  "untrusted comment: signature from tauri secret key\nRUQfake\ntrusted comment: timestamp\nAAAA\n",
).toString("base64");
const SIG_X64 = SIG;
const SIG_ARM = Buffer.from("untrusted comment: arm\nRUQarm\n").toString("base64");

// The shell crate's Cargo.toml as it is in the repo: `version.workspace = true`.
// Pass `cargoVersion` to write an explicit `[package] version` instead.
function fixture({ tauriVersion = "0.9.1", cargoVersion = null, sigs = ["x64", "arm64"] } = {}) {
  const root = mkdtempSync(join(tmpdir(), "wf-latest-"));
  const assets = join(root, "assets");
  mkdirSync(assets);
  const tauriConf = join(root, "tauri.conf.json");
  const shellCargoToml = join(root, "Cargo.toml");
  writeFileSync(tauriConf, JSON.stringify({ version: tauriVersion }));
  const versionLine = cargoVersion === null ? "version.workspace = true" : `version = "${cargoVersion}"`;
  writeFileSync(shellCargoToml, `[package]\nname = "weaveforge-shell"\n${versionLine}\nedition = "2021"\n`);
  if (sigs.includes("x64")) {
    writeFileSync(join(assets, "WeaveForge_0.9.1_x64-setup.exe.sig"), `${SIG_X64}\n`);
  }
  if (sigs.includes("arm64")) {
    writeFileSync(join(assets, "WeaveForge_0.9.1_arm64-setup.exe.sig"), SIG_ARM);
  }
  return {
    root,
    options: {
      tag: "v0.9.1",
      assetsDir: assets,
      tauriConfPath: tauriConf,
      shellCargoTomlPath: shellCargoToml,
      notes: "Fixes.",
      pubDate: "2026-11-16T10:00:00Z",
    },
  };
}

test("writes both Windows platforms with their own signature and the tag's asset URL", () => {
  const { root, options } = fixture();
  try {
    const manifest = buildFromFiles(options);
    assert.equal(manifest.version, "0.9.1");
    assert.equal(manifest.notes, "Fixes.");
    assert.equal(manifest.pub_date, "2026-11-16T10:00:00Z");
    assert.deepEqual(Object.keys(manifest.platforms).sort(), ["windows-aarch64", "windows-x86_64"]);
    assert.equal(
      manifest.platforms["windows-x86_64"].url,
      "https://github.com/Satwik-Miyyapuram/weaveforge/releases/download/v0.9.1/WeaveForge_0.9.1_x64-setup.exe",
    );
    assert.equal(
      manifest.platforms["windows-aarch64"].url,
      "https://github.com/Satwik-Miyyapuram/weaveforge/releases/download/v0.9.1/WeaveForge_0.9.1_arm64-setup.exe",
    );
    assert.equal(manifest.platforms["windows-x86_64"].signature, SIG_X64);
    assert.equal(manifest.platforms["windows-aarch64"].signature, SIG_ARM);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fails clearly and names the file when the arm64 .sig is missing", () => {
  const { root, options } = fixture({ sigs: ["x64"] });
  try {
    assert.throws(() => buildFromFiles(options), /WeaveForge_0\.9\.1_arm64-setup\.exe\.sig/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("refuses a .sig that is not a minisign signature", () => {
  const { root, options } = fixture();
  try {
    writeFileSync(join(options.assetsDir, "WeaveForge_0.9.1_x64-setup.exe.sig"), "not a signature!");
    assert.throws(() => buildFromFiles(options), /not a minisign signature/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fails when tauri.conf.json is not at the tag's version", () => {
  const { root, options } = fixture({ tauriVersion: "0.9.0" });
  try {
    assert.throws(() => buildFromFiles(options), /tauri\.conf\.json says 0\.9\.0, the release is 0\.9\.1/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fails when apps/shell/Cargo.toml [package] sets a version other than the tag's", () => {
  const { root, options } = fixture({ cargoVersion: "0.9.0" });
  try {
    assert.throws(
      () => buildFromFiles(options),
      /apps\/shell\/Cargo\.toml \[package\] says 0\.9\.0, the release is 0\.9\.1/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("accepts a shell crate that inherits the workspace version (version.workspace = true)", () => {
  const { root, options } = fixture();
  try {
    assert.equal(buildFromFiles(options).version, "0.9.1");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fails when apps/shell/Cargo.toml has no [package] version at all", () => {
  const { root, options } = fixture();
  try {
    writeFileSync(options.shellCargoTomlPath, '[package]\nname = "weaveforge-shell"\n');
    assert.throws(() => buildFromFiles(options), /apps\/shell\/Cargo\.toml has no package version/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("refuses a tag that is not a desktop release tag", () => {
  const { root, options } = fixture();
  try {
    assert.throws(() => buildFromFiles({ ...options, tag: "0.9.1" }), /is not a desktop release tag/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// Two manifests per release: latest-v2.json (this release) and latest.json (the
// 0.9.7 bridge that 0.9.6 clients keep reading).
const readJson = (dir, name) => JSON.parse(readFileSync(join(dir, name), "utf8"));

function releaseAt(version) {
  const root = mkdtempSync(join(tmpdir(), "wf-both-"));
  const assets = join(root, "assets");
  mkdirSync(assets);
  const tauriConf = join(root, "tauri.conf.json");
  const shellCargoToml = join(root, "Cargo.toml");
  writeFileSync(tauriConf, JSON.stringify({ version }));
  writeFileSync(shellCargoToml, '[package]\nname = "weaveforge-shell"\nversion.workspace = true\n');
  writeFileSync(join(assets, `WeaveForge_${version}_x64-setup.exe.sig`), SIG_X64);
  writeFileSync(join(assets, `WeaveForge_${version}_arm64-setup.exe.sig`), SIG_ARM);
  const options = {
    tag: `v${version}`,
    assetsDir: assets,
    tauriConfPath: tauriConf,
    shellCargoTomlPath: shellCargoToml,
    notes: "",
    pubDate: "2026-11-22T00:00:00Z",
  };
  return { root, assets, options };
}

test("a 0.9.7 release writes latest-v2.json and latest.json, both at 0.9.7", () => {
  const { root, assets, options } = releaseAt("0.9.7");
  try {
    writeManifests(options);
    const current = readJson(assets, "latest-v2.json");
    const legacy = readJson(assets, "latest.json");
    assert.equal(current.version, "0.9.7");
    assert.equal(legacy.version, "0.9.7");
    assert.deepEqual(legacy, current);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a 0.9.8 release writes latest-v2.json for 0.9.8 and latest.json as a byte-identical copy of the 0.9.7 bridge", () => {
  const first = releaseAt("0.9.7");
  let bridgeText;
  try {
    writeManifests(first.options);
    bridgeText = readFileSync(join(first.assets, "latest.json"), "utf8");
  } finally {
    rmSync(first.root, { recursive: true, force: true });
  }
  const second = releaseAt("0.9.8");
  try {
    writeManifests({ ...second.options, bridgeText });
    assert.equal(readJson(second.assets, "latest-v2.json").version, "0.9.8");
    assert.match(readJson(second.assets, "latest-v2.json").platforms["windows-x86_64"].url, /releases\/download\/v0\.9\.8\//);
    assert.equal(readFileSync(join(second.assets, "latest.json"), "utf8"), bridgeText, "latest.json must be the 0.9.7 bridge, byte for byte");
  } finally {
    rmSync(second.root, { recursive: true, force: true });
  }
});

test("a 0.9.8 release with no 0.9.7 bridge is refused and writes nothing", () => {
  const { root, assets, options } = releaseAt("0.9.8");
  try {
    assert.throws(() => writeManifests(options), /needs the 0\.9\.7 bridge/);
    assert.equal(existsSync(join(assets, "latest-v2.json")), false);
    assert.equal(existsSync(join(assets, "latest.json")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a bridge that is not the 0.9.7 manifest is refused and writes nothing", () => {
  const first = releaseAt("0.9.7");
  let bridge;
  try {
    writeManifests(first.options);
    bridge = JSON.parse(readFileSync(join(first.assets, "latest.json"), "utf8"));
  } finally {
    rmSync(first.root, { recursive: true, force: true });
  }
  const { root, assets, options } = releaseAt("0.9.8");
  try {
    const wrong = `${JSON.stringify({ ...bridge, version: "0.9.6" }, null, 2)}\n`;
    assert.throws(() => writeManifests({ ...options, bridgeText: wrong }), /expected 0\.9\.7/);
    assert.equal(existsSync(join(assets, "latest-v2.json")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a bridge that does not parse as JSON is refused with a message that names it", () => {
  const { root, assets, options } = releaseAt("0.9.8");
  try {
    assert.throws(() => writeManifests({ ...options, bridgeText: "{ not json" }), /bridge latest\.json does not parse/);
    assert.equal(existsSync(join(assets, "latest-v2.json")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("a bridge that differs from the 0.9.7 manifest by one byte is refused", () => {
  const first = releaseAt("0.9.7");
  let bridgeText;
  try {
    writeManifests(first.options);
    bridgeText = readFileSync(join(first.assets, "latest.json"), "utf8");
  } finally {
    rmSync(first.root, { recursive: true, force: true });
  }
  const { root, assets, options } = releaseAt("0.9.8");
  try {
    const dropped = bridgeText.slice(0, -1);
    assert.throws(() => writeManifests({ ...options, bridgeText: dropped }), /byte-identical/);
    assert.equal(existsSync(join(assets, "latest.json")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("a release older than 0.9.7 is refused: 0.9.6 clients are bridged by 0.9.7, not by older builds", () => {
  const { root, options } = releaseAt("0.9.6");
  try {
    assert.throws(() => writeManifests(options), /older than 0\.9\.7/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("compareVersions rejects anything that is not X.Y.Z, so a pre-release is never newer", () => {
  for (const bad of ["0.9.8-rc1", "0.9.8.1", "v0.9.8", "0.9", "a.b.c", ""]) {
    assert.throws(() => compareVersions(bad, "0.9.7"), /not X\.Y\.Z/, bad);
    assert.throws(() => compareVersions("0.9.7", bad), /not X\.Y\.Z/, bad);
  }
  assert.equal(compareVersions("0.9.8", "0.9.7") > 0, true);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildFromFiles } from "./write-latest-json.mjs";

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

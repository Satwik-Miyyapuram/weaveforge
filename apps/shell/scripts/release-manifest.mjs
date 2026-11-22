// The desktop release manifest (`latest-v2.json`) that the shell's updater reads,
// in Tauri v2's static format. Shared by write-latest-json.mjs (writes it) and
// check-release-assets.mjs (checks a published release against it).

/** The GitHub repository whose release assets the updater downloads. */
export const REPO = "Satwik-Miyyapuram/weaveforge";
/** The installer's product name, as Tauri writes it into the file name. */
export const PRODUCT = "WeaveForge";
/** Tauri updater platform key -> the arch Tauri writes into the NSIS file name. */
export const PLATFORMS = { "windows-x86_64": "x64", "windows-aarch64": "arm64" };
/** The manifest's file name on a release. */
export const MANIFEST_NAME = "latest-v2.json";
/** The bridge manifest 0.9.6 and older clients read; pinned to BRIDGE_VERSION from 0.9.8 on. */
export const LEGACY_MANIFEST_NAME = "latest.json";
/** The last release that keeps latest.json; 0.9.6 clients update to it first. */
export const BRIDGE_VERSION = "0.9.7";

const TAG = /^v(\d+\.\d+\.\d+)$/;

/** `v0.9.1` -> `0.9.1`, or null when the tag is not a desktop release tag. */
export function versionFromTag(tag) {
  const match = TAG.exec(tag);
  return match ? match[1] : null;
}

/** `WeaveForge_0.9.1_x64-setup.exe`: the NSIS installer Tauri builds for an arch. */
export function installerName(version, arch) {
  return `${PRODUCT}_${version}_${arch}-setup.exe`;
}

/** The public download URL of one asset of one tag. */
export function releaseAssetUrl(tag, name) {
  return `https://github.com/${REPO}/releases/download/${tag}/${name}`;
}

/** The `.sig` file's text, trimmed. A minisign signature, base64 of "untrusted comment: ...". */
export function signatureText(raw) {
  return String(raw).trim();
}

/** Whether a signature text looks like a minisign signature (base64 of its comment line). */
export function looksLikeMinisign(text) {
  if (!/^[A-Za-z0-9+/=\s]+$/.test(text) || text.length === 0) return false;
  return Buffer.from(text, "base64").toString("utf8").startsWith("untrusted comment:");
}

/**
 * Builds the manifest. `installers` maps each platform key to `{ name, signature }`;
 * both platforms are required.
 */
export function buildLatestManifest({ tag, version, notes, pubDate, installers }) {
  const platforms = {};
  for (const key of Object.keys(PLATFORMS)) {
    const installer = installers[key];
    if (!installer) throw new Error(`no installer for ${key}`);
    platforms[key] = { signature: installer.signature, url: releaseAssetUrl(tag, installer.name) };
  }
  return { version, notes, pub_date: pubDate, platforms };
}

/** Marker for a crate whose version comes from the workspace. */
export const INHERITED = "inherited";

/**
 * The version disagreements, one line each. `tauri` is apps/shell/tauri.conf.json's
 * version. `cargo` is the shell crate's own version: a string when set explicitly,
 * INHERITED when it uses `version.workspace = true` (not checked), or null when missing.
 */
export function versionProblems(version, { tauri, cargo }) {
  const problems = [];
  if (tauri !== version) problems.push(`apps/shell/tauri.conf.json says ${tauri}, the release is ${version}`);
  if (cargo === null) {
    problems.push("apps/shell/Cargo.toml has no package version");
  } else if (cargo !== INHERITED && cargo !== version) {
    problems.push(`apps/shell/Cargo.toml [package] says ${cargo}, the release is ${version}`);
  }
  return problems;
}

/** The `version` under `[package]` in a crate's Cargo.toml: a string, INHERITED, or null. */
export function cargoCrateVersion(cargoText) {
  const section = /^\[package\]\s*$([\s\S]*?)(?=^\[|(?![\s\S]))/m.exec(cargoText);
  if (!section) return null;
  if (/^version\.workspace\s*=\s*true/m.test(section[1])) return INHERITED;
  const match = /^version\s*=\s*"([^"]+)"/m.exec(section[1]);
  return match ? match[1] : null;
}

/** Compares `X.Y.Z` strings: negative when a < b, 0 when equal, positive when a > b. */
export function compareVersions(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

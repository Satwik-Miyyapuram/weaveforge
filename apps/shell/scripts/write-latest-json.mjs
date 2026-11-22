// Writes the updater's manifests for one desktop release, from the NSIS .sig
// files that `tauri build` produced. Each release writes two files into the
// assets folder:
//   latest-v2.json  this release (what current builds read)
//   latest.json     the 0.9.7 bridge (what 0.9.6 and older builds read)
// A 0.9.7 release writes both as 0.9.7. Later releases copy the 0.9.7 manifest
// (passed as the optional bridge file) into latest.json, so it never moves.
// Usage:
//   node apps/shell/scripts/write-latest-json.mjs v0.9.7 <dir-with-setup-exe-and-sig> [bridge-latest.json]

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BRIDGE_VERSION,
  LEGACY_MANIFEST_NAME,
  MANIFEST_NAME,
  PLATFORMS,
  buildLatestManifest,
  cargoCrateVersion,
  compareVersions,
  installerName,
  looksLikeMinisign,
  signatureText,
  versionFromTag,
  versionProblems,
} from "./release-manifest.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const TAURI_CONF = join(here, "..", "tauri.conf.json");
export const SHELL_CARGO_TOML = join(here, "..", "Cargo.toml");

/**
 * Builds the manifest for `tag` from the files in `assetsDir`. Throws with a message
 * a person can act on: the missing file, the bad signature, or the version that
 * disagrees with the tag.
 */
export function buildFromFiles({
  tag,
  assetsDir,
  tauriConfPath = TAURI_CONF,
  shellCargoTomlPath = SHELL_CARGO_TOML,
  notes = "",
  pubDate = new Date().toISOString(),
}) {
  const version = versionFromTag(tag);
  if (!version) throw new Error(`"${tag}" is not a desktop release tag (expected vX.Y.Z)`);

  const tauri = JSON.parse(readFileSync(tauriConfPath, "utf8")).version;
  const cargo = cargoCrateVersion(readFileSync(shellCargoTomlPath, "utf8"));
  const problems = versionProblems(version, { tauri, cargo });
  if (problems.length > 0) {
    throw new Error(`version mismatch, bump before releasing:\n  ${problems.join("\n  ")}`);
  }

  const installers = {};
  for (const [platform, arch] of Object.entries(PLATFORMS)) {
    const name = installerName(version, arch);
    const sigPath = join(assetsDir, `${name}.sig`);
    if (!existsSync(sigPath)) {
      throw new Error(`missing ${name}.sig in ${assetsDir} (build with the signing env vars set)`);
    }
    const signature = signatureText(readFileSync(sigPath, "utf8"));
    if (!looksLikeMinisign(signature)) {
      throw new Error(`${name}.sig is not a minisign signature`);
    }
    installers[platform] = { name, signature };
  }

  return buildLatestManifest({ tag, version, notes, pubDate, installers });
}

/**
 * Writes latest-v2.json for `tag` into `assetsDir`, and latest.json next to it.
 * latest.json is this release's manifest for 0.9.7, and the 0.9.7 `bridge` manifest
 * for any later release. Refuses (writing nothing) a release older than 0.9.7, or a
 * later release without a 0.9.7 bridge.
 */
export function writeManifests({ bridge, ...options }) {
  const manifest = buildFromFiles(options);
  const order = compareVersions(manifest.version, BRIDGE_VERSION);
  let legacy;
  if (order < 0) {
    throw new Error(`release ${manifest.version} is older than ${BRIDGE_VERSION}; it has no bridge manifest`);
  } else if (order === 0) {
    legacy = manifest;
  } else {
    if (!bridge || bridge.version !== BRIDGE_VERSION) {
      throw new Error(`release ${manifest.version} needs the ${BRIDGE_VERSION} bridge manifest (latest.json) to write latest.json`);
    }
    legacy = bridge;
  }
  const text = (value) => `${JSON.stringify(value, null, 2)}\n`;
  writeFileSync(join(options.assetsDir, MANIFEST_NAME), text(manifest));
  writeFileSync(join(options.assetsDir, LEGACY_MANIFEST_NAME), text(legacy));
  return manifest;
}

function main(argv) {
  const [tag, assetsDir, bridgePath] = argv;
  if (!tag || !assetsDir) {
    throw new Error("usage: write-latest-json.mjs <tag> <assets-dir> [bridge-latest.json]");
  }
  const bridge = bridgePath ? JSON.parse(readFileSync(bridgePath, "utf8")) : undefined;
  const dir = resolve(assetsDir);
  writeManifests({ tag, assetsDir: dir, bridge });
  console.log(`wrote ${join(dir, MANIFEST_NAME)} and ${join(dir, LEGACY_MANIFEST_NAME)}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`write-latest-json: ${error.message}`);
    process.exitCode = 1;
  }
}

// Writes the updater's manifests for one desktop release, from the NSIS .sig
// files that `tauri build` produced. Each release writes two files into the
// assets folder:
//   latest-v2.json  this release (what current builds read)
//   latest.json     the 0.9.7 bridge (what 0.9.6 and older builds read)
// A 0.9.7 release writes both as 0.9.7. Every later release must be given the
// 0.9.7 latest.json (the bridge) and writes it back byte for byte, so old clients
// that poll releases/latest/download/latest.json always get the 0.9.7 manifest.
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
 * A 0.9.7 release writes its own manifest as latest.json. A later release needs
 * `bridgeText`, the exact 0.9.7 latest.json bytes, and writes them unchanged as
 * latest.json. Refuses (writing nothing) a release older than 0.9.7, a later release
 * without a bridge, a bridge that is not version 0.9.7, or a bridge whose bytes are
 * not the canonical writer output (one dropped or added byte).
 */
export function writeManifests(options) {
  const manifest = buildFromFiles(options);
  const order = compareVersions(manifest.version, BRIDGE_VERSION);
  if (order < 0) {
    throw new Error(`release ${manifest.version} is older than ${BRIDGE_VERSION}; it has no bridge manifest`);
  }
  const text = (value) => `${JSON.stringify(value, null, 2)}\n`;
  const v2Path = join(options.assetsDir, MANIFEST_NAME);
  const legacyPath = join(options.assetsDir, LEGACY_MANIFEST_NAME);
  if (order === 0) {
    writeFileSync(v2Path, text(manifest));
    writeFileSync(legacyPath, text(manifest));
    return manifest;
  }
  const bridgeText = options.bridgeText;
  if (bridgeText === undefined) {
    throw new Error(`release ${manifest.version} needs the ${BRIDGE_VERSION} bridge (${LEGACY_MANIFEST_NAME}) to copy; none given`);
  }
  const bridgeVersion = JSON.parse(bridgeText).version;
  if (bridgeVersion !== BRIDGE_VERSION) {
    throw new Error(`bridge ${LEGACY_MANIFEST_NAME} is version ${bridgeVersion}, expected ${BRIDGE_VERSION}`);
  }
  if (bridgeText !== text(JSON.parse(bridgeText))) {
    throw new Error(`bridge ${LEGACY_MANIFEST_NAME} is not byte-identical to the writer's output; refusing to copy it`);
  }
  writeFileSync(v2Path, text(manifest));
  writeFileSync(legacyPath, bridgeText);
  return manifest;
}

function main(argv) {
  const [tag, assetsDir, bridgePath] = argv;
  if (!tag || !assetsDir) {
    throw new Error("usage: write-latest-json.mjs <tag> <assets-dir> [bridge-latest.json]");
  }
  const bridgeText = bridgePath ? readFileSync(bridgePath, "utf8") : undefined;
  const dir = resolve(assetsDir);
  writeManifests({ tag, assetsDir: dir, bridgeText });
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

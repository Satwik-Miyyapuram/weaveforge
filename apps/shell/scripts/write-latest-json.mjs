// Writes the updater's latest.json for one desktop release, from the NSIS .sig
// files that `tauri build` produced. Usage:
//   node apps/shell/scripts/write-latest-json.mjs v0.9.1 <dir-with-setup-exe-and-sig> [out.json]

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MANIFEST_NAME,
  PLATFORMS,
  buildLatestManifest,
  cargoCrateVersion,
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

function main(argv) {
  const [tag, assetsDir, out] = argv;
  if (!tag || !assetsDir) {
    throw new Error("usage: write-latest-json.mjs <tag> <assets-dir> [out.json]");
  }
  const target = out ?? join(resolve(assetsDir), MANIFEST_NAME);
  const manifest = buildFromFiles({ tag, assetsDir: resolve(assetsDir) });
  writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`wrote ${target}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`write-latest-json: ${error.message}`);
    process.exitCode = 1;
  }
}

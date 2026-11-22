// Read-only release gate. Fails unless a desktop release has both Windows installers,
// their .sig files, and two manifests: latest-v2.json (this release) and latest.json
// (the 0.9.7 bridge). Usage:
//   node apps/shell/scripts/check-release-assets.mjs v0.9.8
// It only reads (gh api and asset downloads); it never changes the release. For a
// release after 0.9.7 it also reads the v0.9.7 release to check latest.json against it.

import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { promisify } from "node:util";
import {
  BRIDGE_VERSION,
  LEGACY_MANIFEST_NAME,
  MANIFEST_NAME,
  PLATFORMS,
  REPO,
  compareVersions,
  installerName,
  releaseAssetUrl,
  signatureText,
  versionFromTag,
} from "./release-manifest.mjs";

const run = promisify(execFile);

/**
 * Returns one line per problem; an empty list means the release passes.
 * `release` is the parsed `gh api releases/tags/<tag>` response. `readAsset(name)`
 * resolves the asset's text, or null when it cannot be downloaded. `bridge` is the
 * parsed 0.9.7 latest.json, needed to check latest.json on releases after 0.9.7.
 */
export async function checkRelease({ tag, release, readAsset, bridge }) {
  const version = versionFromTag(tag);
  if (!version) return [`"${tag}" is not a desktop release tag (expected vX.Y.Z)`];

  const problems = [];
  if (release.tag_name !== tag) problems.push(`release tag is ${release.tag_name}, not ${tag}`);

  const assets = new Map((release.assets ?? []).map((asset) => [asset.name, asset]));
  const has = (name) => {
    if (!assets.has(name)) {
      problems.push(`missing asset ${name}`);
      return false;
    }
    return true;
  };

  for (const arch of Object.values(PLATFORMS)) {
    const name = installerName(version, arch);
    if (has(name)) {
      const expected = releaseAssetUrl(tag, name);
      if (assets.get(name).browser_download_url !== expected) {
        problems.push(`${name} download URL is not ${expected}`);
      }
    }
    has(`${name}.sig`);
  }

  const readJson = async (name) => {
    const text = await readAsset(name);
    if (text === null || text === undefined) {
      problems.push(`could not download ${name}`);
      return null;
    }
    try {
      return JSON.parse(text);
    } catch {
      problems.push(`${name} does not parse as JSON`);
      return null;
    }
  };

  let current = null;
  if (has(MANIFEST_NAME)) {
    current = await readJson(MANIFEST_NAME);
    if (current) {
      problems.push(...(await manifestProblems({ tag, version, manifest: current, readAsset, assets })));
    }
  }

  if (has(LEGACY_MANIFEST_NAME)) {
    const legacy = await readJson(LEGACY_MANIFEST_NAME);
    if (legacy) problems.push(...legacyProblems({ version, legacy, current, bridge }));
  }
  return problems;
}

/** Checks latest-v2.json: its version, its URLs, and its signatures against the .sig files. */
async function manifestProblems({ tag, version, manifest, readAsset, assets }) {
  const problems = [];
  if (manifest.version !== version) {
    problems.push(`${MANIFEST_NAME} version is ${manifest.version}, the release is ${version}`);
  }
  for (const [platform, arch] of Object.entries(PLATFORMS)) {
    const name = installerName(version, arch);
    const entry = manifest.platforms?.[platform];
    if (!entry) {
      problems.push(`${MANIFEST_NAME} has no ${platform} entry`);
      continue;
    }
    const expectedUrl = releaseAssetUrl(tag, name);
    if (entry.url !== expectedUrl) {
      problems.push(`${MANIFEST_NAME} ${platform} url is ${entry.url}, expected ${expectedUrl}`);
    }
    if (assets.has(`${name}.sig`)) {
      const sig = signatureText((await readAsset(`${name}.sig`)) ?? "");
      if (entry.signature !== sig) {
        problems.push(`${MANIFEST_NAME} ${platform} signature does not match ${name}.sig`);
      }
    }
  }
  return problems;
}

/**
 * Checks the bridge latest.json. On 0.9.7 it is the same manifest as latest-v2.json;
 * on a later release it must be the 0.9.7 bridge itself.
 */
function legacyProblems({ version, legacy, current, bridge }) {
  const order = compareVersions(version, BRIDGE_VERSION);
  if (order < 0) return [`release ${version} is older than ${BRIDGE_VERSION}`];
  if (order === 0) {
    if (current && JSON.stringify(legacy) !== JSON.stringify(current)) {
      return [`${LEGACY_MANIFEST_NAME} differs from ${MANIFEST_NAME} (version ${legacy.version}, expected ${version})`];
    }
    return [];
  }
  if (!bridge) {
    return [`cannot check ${LEGACY_MANIFEST_NAME}: no ${BRIDGE_VERSION} bridge given to compare it with`];
  }
  if (JSON.stringify(legacy) !== JSON.stringify(bridge)) {
    return [`${LEGACY_MANIFEST_NAME} is not the ${BRIDGE_VERSION} bridge (it has version ${legacy.version}, expected ${BRIDGE_VERSION})`];
  }
  return [];
}

/** Reads a release with the GitHub CLI; never writes to GitHub. */
async function fetchRelease(tag) {
  const { stdout } = await run("gh", ["api", `repos/${REPO}/releases/tags/${tag}`]);
  return JSON.parse(stdout);
}

async function downloadAsset(release) {
  return async (name) => {
    const asset = release.assets.find((a) => a.name === name);
    if (!asset) return null;
    const response = await fetch(asset.browser_download_url);
    return response.ok ? response.text() : null;
  };
}

async function main(argv) {
  const [tag] = argv;
  if (!tag) throw new Error("usage: check-release-assets.mjs <tag>");
  let release;
  try {
    release = await fetchRelease(tag);
  } catch (error) {
    throw new Error(`no release for ${tag} (gh api failed: ${error.stderr ?? error.message})`);
  }
  const version = versionFromTag(tag);
  let bridge;
  if (version && compareVersions(version, BRIDGE_VERSION) > 0) {
    const bridgeRelease = await fetchRelease(`v${BRIDGE_VERSION}`);
    const text = await (await downloadAsset(bridgeRelease))(LEGACY_MANIFEST_NAME);
    bridge = text ? JSON.parse(text) : undefined;
  }
  const problems = await checkRelease({ tag, release, readAsset: await downloadAsset(release), bridge });
  if (problems.length > 0) {
    console.error(`check-release-assets: ${tag} fails the release gate:`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exitCode = 1;
    return;
  }
  console.log(`check-release-assets: ${tag} passes (installers, .sig files, latest-v2.json, latest.json)`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`check-release-assets: ${error.message}`);
    process.exitCode = 1;
  });
}

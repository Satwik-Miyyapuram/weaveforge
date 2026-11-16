// Read-only release gate. Fails unless a desktop release has both Windows installers,
// their .sig files, and a latest.json whose version is the tag and whose URLs and
// signatures match that tag's uploaded assets. Usage:
//   node apps/shell/scripts/check-release-assets.mjs v0.9.1
// It only reads (gh api and asset downloads); it never changes the release.

import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { promisify } from "node:util";
import {
  MANIFEST_NAME,
  PLATFORMS,
  REPO,
  installerName,
  releaseAssetUrl,
  signatureText,
  versionFromTag,
} from "./release-manifest.mjs";

const run = promisify(execFile);

/**
 * Returns one line per problem; an empty list means the release passes.
 * `release` is the parsed `gh api releases/tags/<tag>` response. `readAsset(name)`
 * resolves the asset's text, or null when it cannot be downloaded.
 */
export async function checkRelease({ tag, release, readAsset }) {
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

  if (!has(MANIFEST_NAME)) return problems;

  const text = await readAsset(MANIFEST_NAME);
  if (text === null || text === undefined) {
    problems.push(`could not download ${MANIFEST_NAME}`);
    return problems;
  }
  let manifest;
  try {
    manifest = JSON.parse(text);
  } catch {
    problems.push(`${MANIFEST_NAME} does not parse as JSON`);
    return problems;
  }

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
  const problems = await checkRelease({ tag, release, readAsset: await downloadAsset(release) });
  if (problems.length > 0) {
    console.error(`check-release-assets: ${tag} fails the release gate:`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exitCode = 1;
    return;
  }
  console.log(`check-release-assets: ${tag} passes (installers, .sig files, latest.json)`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`check-release-assets: ${error.message}`);
    process.exitCode = 1;
  });
}

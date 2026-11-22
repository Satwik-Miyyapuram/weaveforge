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
 * `bridgeBytes` are the raw bytes of the 0.9.7 latest.json, needed to check latest.json
 * on releases after 0.9.7.
 */
export async function checkRelease({ tag, release, readAsset, bridgeBytes }) {
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
    const bytes = await readAsset(name);
    if (bytes === null || bytes === undefined) {
      problems.push(`could not download ${name}`);
      return null;
    }
    try {
      return { value: JSON.parse(Buffer.from(bytes).toString("utf8")), bytes };
    } catch {
      problems.push(`${name} does not parse as JSON`);
      return null;
    }
  };

  let current = null;
  if (has(MANIFEST_NAME)) {
    current = (await readJson(MANIFEST_NAME))?.value ?? null;
    if (current) {
      problems.push(...(await manifestProblems({ tag, version, manifest: current, readAsset, assets })));
    }
  }

  if (has(LEGACY_MANIFEST_NAME)) {
    const legacy = await readJson(LEGACY_MANIFEST_NAME);
    if (legacy) {
      problems.push(...legacyProblems({ version, legacy: legacy.value, legacyBytes: legacy.bytes, current, bridgeBytes }));
    }
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
 * on a later release it must be the 0.9.7 bridge itself, byte for byte.
 */
function legacyProblems({ version, legacy, legacyBytes, current, bridgeBytes }) {
  const order = compareVersions(version, BRIDGE_VERSION);
  if (order < 0) return [`release ${version} is older than ${BRIDGE_VERSION}`];
  if (order === 0) {
    if (current && JSON.stringify(legacy) !== JSON.stringify(current)) {
      return [`${LEGACY_MANIFEST_NAME} differs from ${MANIFEST_NAME} (version ${legacy.version}, expected ${version})`];
    }
    return [];
  }
  if (!bridgeBytes) {
    return [`cannot check ${LEGACY_MANIFEST_NAME}: no ${BRIDGE_VERSION} bridge given to compare it with`];
  }
  if (!Buffer.from(legacyBytes).equals(Buffer.from(bridgeBytes))) {
    return [`${LEGACY_MANIFEST_NAME} is not the ${BRIDGE_VERSION} bridge, byte for byte (it reads version ${legacy.version})`];
  }
  return [];
}

/**
 * Finds a release by tag in the release list. The list includes drafts; the
 * `releases/tags/<tag>` endpoint does not, and the gate runs on a draft before it is published.
 */
export function findRelease(releases, tag) {
  return releases.find((release) => release.tag_name === tag);
}

/** Reads a release with the GitHub CLI; never writes to GitHub. */
async function fetchRelease(tag) {
  const { stdout } = await run("gh", ["api", "--paginate", `repos/${REPO}/releases`, "--jq", ".[]"]);
  const releases = stdout
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line));
  const release = findRelease(releases, tag);
  if (!release) throw new Error(`no release named ${tag}`);
  return release;
}

/**
 * How to fetch one asset. A draft's browser_download_url needs no auth in theory but
 * returns 404 to anonymous requests, so with a token the API asset url is used instead.
 */
export function assetRequest(asset, env = process.env) {
  if (env.GH_TOKEN) {
    return {
      url: asset.url,
      headers: { Accept: "application/octet-stream", Authorization: `Bearer ${env.GH_TOKEN}` },
    };
  }
  return { url: asset.browser_download_url, headers: {} };
}

async function downloadAsset(release) {
  return async (name) => {
    const asset = release.assets.find((a) => a.name === name);
    if (!asset) return null;
    const { url, headers } = assetRequest(asset);
    const response = await fetch(url, { headers });
    return response.ok ? Buffer.from(await response.arrayBuffer()) : null;
  };
}

/**
 * Parses the bridge latest.json text. Unparseable text is a problem, not a throw; a
 * parsed bridge must be the 0.9.7 manifest (its version and every URL name v0.9.7).
 */
export function parseBridge(text) {
  if (!text) return { bridge: undefined, problems: [] };
  let bridge;
  try {
    bridge = JSON.parse(text);
  } catch {
    bridge = undefined;
  }
  if (!bridge || typeof bridge !== "object") {
    return { bridge: undefined, problems: [`bridge ${LEGACY_MANIFEST_NAME} does not parse`] };
  }
  return { bridge, problems: bridgeProblems(bridge) };
}

function bridgeProblems(bridge) {
  const problems = [];
  if (bridge.version !== BRIDGE_VERSION) {
    problems.push(`bridge ${LEGACY_MANIFEST_NAME} version is ${bridge.version}, expected ${BRIDGE_VERSION}`);
  }
  const prefix = releaseAssetUrl(`v${BRIDGE_VERSION}`, "");
  const entries = Object.values(bridge.platforms ?? {});
  if (entries.length === 0) {
    problems.push(`bridge ${LEGACY_MANIFEST_NAME} has no platforms`);
  }
  for (const entry of entries) {
    if (typeof entry?.url !== "string" || !entry.url.startsWith(prefix)) {
      problems.push(`bridge ${LEGACY_MANIFEST_NAME} url ${entry?.url} is not under ${prefix}`);
    }
  }
  return problems;
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
  let bridgeBytes;
  let problems = [];
  if (version && compareVersions(version, BRIDGE_VERSION) > 0) {
    try {
      const bridgeRelease = await fetchRelease(`v${BRIDGE_VERSION}`);
      const bytes = await (await downloadAsset(bridgeRelease))(LEGACY_MANIFEST_NAME);
      const parsed = parseBridge(bytes && Buffer.from(bytes).toString("utf8"));
      problems = parsed.problems;
      if (parsed.bridge) bridgeBytes = bytes;
    } catch (error) {
      problems = [`cannot fetch the ${BRIDGE_VERSION} bridge ${LEGACY_MANIFEST_NAME}: ${error.message}`];
    }
  }
  problems = [
    ...problems,
    ...(await checkRelease({ tag, release, readAsset: await downloadAsset(release), bridgeBytes })),
  ];
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

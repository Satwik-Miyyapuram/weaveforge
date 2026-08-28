/**
 * Telling the reader their shell is stale.
 *
 * Almost nothing here needs updating. The window loads the web app from a
 * server, so a change to the site reaches an installed copy the next time it
 * opens — there is no bundled build to replace and no version of the UI to keep
 * in step. What does not arrive that way is this process: the preload contract,
 * the IPC channels, the sign-in loopback, the Electron runtime underneath them.
 * Those ship inside the installer, and until now an installed copy had no way
 * to learn that a newer one existed. It would simply keep working until one of
 * them stopped matching the server, and then keep working badly.
 *
 * So this checks, and only tells. Nothing is downloaded, nothing is executed,
 * and the reader ends up at the release page with the same installer a first
 * install came from. An updater that fetches and runs code silently is a much
 * larger promise — it needs signing on both platforms to be safe, and unsigned
 * it is a channel for handing arbitrary binaries to a machine.
 *
 * Everything except the dialog is a pure function over injected dependencies,
 * because an Electron app cannot be started inside `node --test`.
 */

/** A release, as much of one as this needs. */
export interface Release {
  tag_name: string;
  html_url: string;
  draft?: boolean;
  prerelease?: boolean;
}

export interface Update {
  version: string;
  url: string;
}

/**
 * `v0.5.2` → `[0, 5, 2]`.
 *
 * Deliberately strict. The repository's releases are not all this app's: the
 * Android builds are tagged `android-v0.5.2` and the Python SDK `py-v0.6.0`,
 * and either would otherwise sort as the newest thing on offer — sending a
 * desktop reader to download an APK, or a wheel.
 */
export function parseTag(tag: string): [number, number, number] | null {
  const m = /^v(\d+)\.(\d+)\.(\d+)$/.exec(tag.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** `0.5.2` → `[0, 5, 2]`, for the version this build was stamped with. */
export function parseVersion(version: string): [number, number, number] | null {
  return parseTag(`v${version.trim()}`);
}

/** Whether `candidate` is a later version than `current`. */
export function isNewer(candidate: [number, number, number], current: [number, number, number]): boolean {
  for (let i = 0; i < 3; i += 1) {
    if (candidate[i]! !== current[i]!) return candidate[i]! > current[i]!;
  }
  return false;
}

/**
 * The newest desktop release in the list, or nothing.
 *
 * The list is read rather than trusted in order: GitHub returns releases by
 * creation time, and a patch published after a later minor would otherwise win.
 * Drafts and pre-releases are skipped — a reader on the stable installer should
 * not be sent to a build that was not announced.
 */
export function newestRelease(releases: Release[]): { version: [number, number, number]; url: string } | null {
  let best: { version: [number, number, number]; url: string } | null = null;
  for (const release of releases) {
    if (release.draft || release.prerelease) continue;
    const version = parseTag(release.tag_name);
    if (!version) continue;
    if (!best || isNewer(version, best.version)) best = { version, url: release.html_url };
  }
  return best;
}

/**
 * The check itself: what to tell the reader, if anything.
 *
 * Returns the update to announce, or null — which covers every ordinary case.
 * Up to date is null. A network that is not there is null: this is a courtesy,
 * and a shell that cannot reach GitHub is still a working shell.
 *
 * It does not remember having asked. A stale shell is stale until it is
 * replaced, and one dismissed dialog does not make it less so — so the offer
 * stands at every launch and at every sign-in until the reader takes it. The
 * cost of being wrong in the other direction is worse: a preload contract that
 * no longer matches the server, on a machine that was told once, months ago.
 */
export async function findUpdate(deps: {
  currentVersion: string;
  fetchReleases: () => Promise<Release[]>;
}): Promise<Update | null> {
  const current = parseVersion(deps.currentVersion);
  if (!current) return null;

  let releases: Release[];
  try {
    releases = await deps.fetchReleases();
  } catch {
    return null;
  }

  const newest = newestRelease(releases);
  if (!newest || !isNewer(newest.version, current)) return null;

  return { version: newest.version.join("."), url: newest.url };
}

const RELEASES_URL = "https://api.github.com/repos/Satwik-Miyyapuram/weaveforge/releases?per_page=30";

/**
 * The releases, from GitHub's public API.
 *
 * Unauthenticated, which is rate-limited per IP — at one call per launch that
 * is not a limit anybody reaches, and a token in a shipped binary is a token
 * that has been published.
 */
export async function fetchReleases(): Promise<Release[]> {
  const response = await fetch(RELEASES_URL, {
    headers: { accept: "application/vnd.github+json", "user-agent": "WeaveForge-Desktop" },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`releases: ${response.status}`);
  const body: unknown = await response.json();
  return Array.isArray(body) ? (body as Release[]) : [];
}

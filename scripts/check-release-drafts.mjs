#!/usr/bin/env node
/**
 * Fails when a desktop release has been left as a draft.
 *
 * A draft release is invisible to installed copies twice over: GitHub does not
 * return drafts to unauthenticated callers, and `newestRelease()` skips them
 * anyway (`apps/desktop/src/update-check.ts`). So a draft holding a complete
 * set of installers looks, from inside the app, exactly like no release at all
 * — which is how v0.6.0 sat unreachable while the updater was blamed for it.
 *
 * Drafts are legitimate *while a tagged release is building*: three platforms
 * upload into one draft and the `publish` job un-drafts it at the end. That
 * window is minutes, so only a draft older than GRACE_MS is a fault.
 *
 * Desktop tags only. Android and the SDK do not feed the updater.
 *
 * Two skip paths, and they are no longer the same thing:
 *
 *   - No token. The normal state on a contributor's laptop, where this guards
 *     the repository's releases rather than the checkout. Skipping keeps it
 *     from failing every local run; CI always has a token.
 *   - A failed request *with* a token. That is an outage, a bad token, or a
 *     repository rename — and it used to exit 0, so the one check that notices
 *     an invisible release went green for the duration of a GitHub incident.
 *     An outage is not a pass, so it now fails.
 *
 * `WEAVEFORGE_SKIP_RELEASE_DRAFT_CHECK=1` opts out deliberately, for the case
 * where the API is known to be down and the run should not be blocked on it.
 * It has to be typed out, so it cannot happen by accident.
 */

const REPO = process.env.GITHUB_REPOSITORY ?? "Satwik-Miyyapuram/weaveforge";
const GRACE_MS = 2 * 60 * 60 * 1000;
const DESKTOP_TAG = /^v\d+\.\d+\.\d+$/;

/** Releases, drafts included — which is why this needs a token. */
async function fetchReleases(token) {
  const response = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=50`, {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "user-agent": "weaveforge-check-release-drafts",
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`releases: ${response.status} ${response.statusText}`);
  return response.json();
}

const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;

// No token is the normal state on a contributor's laptop. Skipping is right:
// this guards the repository's releases, not the checkout, and CI always has
// one. Failing here would only teach people that the check is noise.
if (!token) {
  console.log("check:release-drafts skipped — no GH_TOKEN/GITHUB_TOKEN");
  process.exit(0);
}

if (process.env.WEAVEFORGE_SKIP_RELEASE_DRAFT_CHECK === "1") {
  console.log(
    "check:release-drafts skipped — WEAVEFORGE_SKIP_RELEASE_DRAFT_CHECK=1 " +
      "(a draft left in place will not be reported by this run)",
  );
  process.exit(0);
}

/**
 * The reporting half, reachable only when the releases were actually listed.
 *
 * It is a function so the fetch failure above has somewhere to go: the process
 * has to end without running this, and on Windows ending it with `process.exit`
 * while undici's abort timer is still pending trips a libuv assertion
 * (`UV_HANDLE_CLOSING`, exit 0xC0000409). Setting `process.exitCode` and letting
 * the module finish is what gets both a red job and an exit code that says why.
 */
function reportStaleDrafts(releases) {
  const now = Date.now();
  const stale = releases.filter(
    (release) =>
      release.draft &&
      DESKTOP_TAG.test(String(release.tag_name ?? "")) &&
      now - Date.parse(release.created_at) > GRACE_MS,
  );

  if (stale.length === 0) {
    console.log(
      `check:release-drafts passed — no desktop release left as a draft (${releases.length} checked)`,
    );
    return;
  }

  console.error("Desktop releases left as drafts:\n");
  for (const release of stale) {
    console.error(`  ${release.tag_name}  created ${release.created_at}  ${release.html_url}`);
  }
  console.error(
    "\nA draft is invisible to every installed copy — the app reports no update available\n" +
      "while the installers sit in the release. Either publish it:\n\n" +
      "  gh release edit <tag> --draft=false --latest\n\n" +
      "or delete it and re-push the tag so it is built from current main:\n\n" +
      "  gh release delete <tag> --yes\n" +
      "  git push origin <tag>\n\n" +
      "See docs/building/release.md.",
  );
  process.exitCode = 1;
}

let releases;
try {
  releases = await fetchReleases(token);
} catch (error) {
  // With a token present this is not "nothing to check", it is "the check could
  // not run" — and the thing it would have found is a release nobody can
  // install. Green here is indistinguishable from a pass, so it is red.
  console.error(
    `check:release-drafts FAILED — could not list releases: ${
      error instanceof Error ? error.message : error
    }\n` +
      "  A failed request is not a clean repository: a draft left as a draft is invisible to\n" +
      "  every installed copy, and this run cannot tell whether one exists. Re-run once the\n" +
      "  API is reachable, or set WEAVEFORGE_SKIP_RELEASE_DRAFT_CHECK=1 to skip knowingly.\n" +
      "  See docs/building/release.md.",
  );
  process.exitCode = 1;
}

if (releases) reportStaleDrafts(releases);


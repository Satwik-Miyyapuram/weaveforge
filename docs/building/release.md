# Releasing WeaveForge

This monorepo ships **four release tracks**, one tag prefix each. Do not mix them.

| | **Desktop app** | **Python SDK** | **Android** | **iOS** |
|---|---|---|---|---|
| Tag | `vX.Y.Z` | `py-vX.Y.Z` | `android-vX.Y.Z` | `ios-vX.Y.Z` |
| Covers | Electron shell + the offline web build inside it | The `weaveforge` SDK on PyPI | Native app (`apps/android`) | WKWebView shell (`apps/ios`) |
| Artifact | One installer per Windows chip (x64, arm64), one universal macOS dmg, one Linux AppImage, plus the `latest*.yml` the in-app updater reads | PyPI wheel + sdist | `WeaveForge-<v>-Android.apk` | `WeaveForge-<v>-iOS.ipa` (unsigned) |
| Workflow | `release-desktop.yml` | `publish-python.yml` | `android.yml` | `ios.yml` |
| Changelog | [`../CHANGELOG.md`](../../CHANGELOG.md) | Same | Same | Same |

**Why the desktop keeps the bare `vX.Y.Z`.** Copies already installed look for
`v*` releases (`apps/desktop/src/update-check.ts`), so moving that track to
another prefix would strand every one of them on the version they have. The SDK
moved instead — which is also what stops a desktop release publishing to PyPI,
where a version cannot be taken back.

**Each track carries its own version number.** They are cut separately and
they move separately: the desktop app going to 0.7.0 does not oblige the SDK to
follow, and an SDK patch does not reissue the app. What a track's number means
is what changed *in that track*.

| Track | Version lives in | Free to move |
|---|---|---|
| Desktop app | `apps/desktop/package.json` | independently |
| Python SDK | `python/weaveforge/__init__.py` `__version__` | independently |
| Android | `apps/android/app/build.gradle.kts` `versionName` / `versionCode` | independently |
| iOS | `apps/ios/project.yml` `MARKETING_VERSION` | independently |

`package.json`, `apps/web/package.json` and `packages/core/package.json` are
**not** release numbers. Core is consumed as `"*"` by every workspace that uses
it, so nothing resolves against those values; they track the desktop app
because that is the artifact they are built into.

Nothing enforces agreement between tracks, because nothing depends on it: the
SDK does not send its version to the server and the server does not ask for it.
The one check that does exist is per track — each workflow refuses a tag that
disagrees with its own version file.

Releases before 0.6.0 were cut in lockstep, so `py-v0.5.1` and `v0.5.1` are the
same commit. From 0.6.0 on they need not be. Older separate SDK history is
archived in
[`changelog-sdk-legacy.md`](../internal/reports/changelog-sdk-legacy.md).

All changes still land on `main` via pull request (branch protection). Tags are cut **from `main` after merge**.

## Desktop app (`vX.Y.Z`)

1. PR: bump the desktop version, and add the entry under `### Desktop` in
   [`../CHANGELOG.md`](../../CHANGELOG.md).

   ```
   apps/desktop/package.json           "version"
   package.json                        "version"   (follows the app)
   apps/web/package.json               "version"   (follows the app)
   packages/core/package.json          "version"   (follows the app)
   ```

   Leave `python/weaveforge/__init__.py` alone unless the SDK itself changed.

   `release-desktop.yml` refuses a tag that does not match
   `apps/desktop/package.json`: an installer that claims a version it is not
   makes every installed copy either miss the update or reinstall forever.
2. Merge when CI is green.
3. On `main`:
   ```bash
   git pull origin main
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```
4. `release-desktop.yml` builds on Linux, macOS and Windows and uploads each
   installer plus `latest*.yml` into a **draft** release, then publishes it once
   all three are done. Nothing reaches the updater while it is a draft, so a
   half-uploaded release is never offered to anybody.
5. Write the notes on the published release.

**A release is made by a tag, never by hand.** Running the workflow manually
(Actions → Release desktop app → Run workflow) builds all three platforms and
attaches the installers to the run as artifacts — it creates no release and
touches no existing one. That is deliberate: it used to publish, which left a
**draft** release behind, and a draft is invisible to every installed copy
because `newestRelease()` skips drafts. The app appeared to have no update
available while a complete set of installers sat in the repository.

If you ever see a draft desktop release, that is the bug, not the state: either
publish it or delete it and re-push the tag. The tagged run now fails if the
release is still a draft or has no `latest.yml` when it finishes.

SECURITY: the Windows and macOS builds are not code-signed, so the only
integrity check on a downloaded update is the SHA-512 in `latest.yml`, served
over HTTPS from the same release. Say so in the notes; do not describe the
update as verified.

The universal macOS `.dmg` carries an ad-hoc signature only
(`apps/desktop/scripts/after-pack.cjs`), which is free and keeps Apple silicon
from calling the app "damaged", but is not a Developer ID and is not notarised.
Squirrel.Mac will not install updates on such a build, so macOS copies do not
auto-update: they show a "new version" notice that opens the release page
(`apps/desktop/src/main-update-offer.ts`). Put the first-launch steps from
[`docs/using/desktop.md`](../using/desktop.md#installing-on-a-mac) in the notes.

## Python SDK (`py-vX.Y.Z`)

1. PR: bump `__version__` in `python/weaveforge/__init__.py` to whatever the
   SDK's own changes call for, and add the entry under `### Python SDK` in
   [`../CHANGELOG.md`](../../CHANGELOG.md). Do not touch the app's versions.
2. On `main`:
   ```bash
   git pull origin main
   git tag py-vX.Y.Z
   git push origin py-vX.Y.Z
   ```
3. `publish-python.yml` checks the tag against `python/weaveforge/__init__.py`,
   builds, and publishes. Confirm at https://pypi.org/project/weaveforge/ .

Do not re-use a PyPI version — it cannot be replaced or deleted and re-uploaded.
Prefer Trusted Publishing; `PYPI_API_TOKEN` is the fallback.

## Android (`android-vX.Y.Z`)

One file: `WeaveForge-<version>-Android.apk`, the native app in
[`apps/android`](../../apps/android/README.md) (`org.weaveforge.ink`), signed
with the release keystore. The Bubblewrap TWA in `apps/web/twa` is no longer
built or released.

1. PR: bump `versionName` (the app version) and `versionCode` (must only ever
   go up, or Android refuses the update) in `apps/android/app/build.gradle.kts`.
2. Merge, then on `main`:
   ```bash
   git pull origin main
   git tag android-vX.Y.Z      # match versionName
   git push origin android-vX.Y.Z
   ```
3. `android.yml` builds and signs the APK, prints its certificate SHA-256, and
   attaches it to the GitHub Release (creating it if needed).

Manual rebuild without a tag: **Actions → Build Android → Run workflow** (the
APK lands on the run as an artifact, no release).

## iOS (`ios-vX.Y.Z`)

One file: `WeaveForge-<version>-iOS.ipa`, the WKWebView shell in
[`apps/ios`](../../apps/ios/README.md). It is **unsigned**: there is no Apple
developer account behind the project, so it installs only through a sideloading
tool that re-signs it with the user's own Apple ID (AltStore, Sideloadly).

1. PR: bump `MARKETING_VERSION` and `CURRENT_PROJECT_VERSION` in
   `apps/ios/project.yml`.
2. Merge, then tag `ios-vX.Y.Z` on `main` and push it.
3. `ios.yml` generates the Xcode project, builds on macOS, and attaches the ipa
   to the GitHub Release.

## Web app (no product tag)

Merge to `main` → deploy. Document breaking schema changes in `supabase/migrations/`, and add user-visible changes to [`../CHANGELOG.md`](../../CHANGELOG.md) under `[Unreleased]`.

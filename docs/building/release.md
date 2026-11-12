# Releasing WeaveForge

This monorepo ships **four release tracks**, one tag prefix each. Do not mix them.

| | **Desktop app** | **Python SDK** | **Android** | **iOS** |
|---|---|---|---|---|
| Tag | `vX.Y.Z` | `py-vX.Y.Z` | `android-vX.Y.Z` | `ios-vX.Y.Z` |
| Covers | Tauri shell (`apps/shell`) + the offline web build and local Postgres inside it | The `weaveforge` SDK on PyPI | Native app (`apps/android`) | WKWebView shell (`apps/ios`) |
| Artifact | Windows x64 MSI and NSIS installers | PyPI wheel + sdist | `WeaveForge-<v>-Android.apk` | `WeaveForge-<v>-iOS.ipa` (unsigned) |
| Workflow | None yet. Publishing is manual, see below | `publish-python.yml` | `android.yml` | `ios.yml` |
| Changelog | [`../../CHANGELOG.md`](../../CHANGELOG.md) | Same | Same | Same |

## Overview

The desktop app is a Tauri shell. It ships a web export, a local sidecar and a
pinned Postgres build inside the installer. CI builds the Windows installers on
every run of the `shell-bundle-windows` job in `.github/workflows/ci.yml`, but
no workflow publishes them. Releasing the desktop app is a manual step today.

Only Windows x64 is built for the desktop app. macOS and Linux are not built.

The sidecar is kept in 0.9 only so that old PGlite data can be imported. It
will be removed in the next release.

## Versioning

**Each track carries its own version number.** They are cut separately and
they move separately: the desktop app going to 0.7.0 does not oblige the SDK to
follow, and an SDK patch does not reissue the app. What a track's number means
is what changed *in that track*.

| Track | Version lives in | Free to move |
| --- | --- | --- |
| Desktop app | `apps/shell/tauri.conf.json` `version` | independently |
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

## Desktop (Windows) build

The desktop installers are built from the `shell-bundle-windows` job in
`.github/workflows/ci.yml`. Run the same steps locally on Windows. Run them from
the repository root unless a step says otherwise.

Prerequisites: Node 24.14.1, .NET SDK 9 (for the ink recogniser), the Rust
toolchain pinned by the repo (`rustup show` installs it), and PowerShell.

1. Install dependencies and build core (repo root):

   ```powershell
   npm ci
   npm run build:core
   ```

2. Build the web export. The script refuses to run without these three
   variables. Use the same values as CI's secrets (`SUPABASE_URL`,
   `SUPABASE_ANON_KEY`) or your own dev project:

   ```powershell
   $env:NEXT_PUBLIC_SUPABASE_URL = "<supabase url>"
   $env:NEXT_PUBLIC_SUPABASE_ANON_KEY = "<supabase anon key>"
   $env:NEXT_PUBLIC_BACKEND_PROVIDER = "postgrest"
   cd apps/shell
   node scripts/build-web.mjs
   cd ../..
   ```

3. Stage the sidecar (repo root). `stage.mjs` refuses a non-empty folder, so
   remove the old stage first:

   ```powershell
   if (Test-Path apps/shell/target/stage) { Remove-Item apps/shell/target/stage -Recurse -Force }
   node apps/shell/sidecar/scripts/stage.mjs apps/shell/target/stage --node (Get-Command node).Source
   ```

4. Stage Postgres (repo root). This downloads the pinned archive from
   `theseus-rs/postgresql-binaries` (PostgreSQL 18.6.1) and checks its SHA-256
   before unpacking:

   ```powershell
   $name = "postgresql-18.6.1-x86_64-pc-windows-msvc"
   $tar = Join-Path $env:TEMP "$name.tar.gz"
   Invoke-WebRequest -Uri "https://github.com/theseus-rs/postgresql-binaries/releases/download/18.6.1/$name.tar.gz" -OutFile $tar
   $hash = (Get-FileHash $tar -Algorithm SHA256).Hash
   if ($hash -ne "0C0C845626ED77C605D716051C9E8DF3368D07FBBD9F61EA39A4C5C0536FDE7E") { throw "Postgres archive hash mismatch: $hash" }
   tar -xzf $tar -C $env:TEMP
   node apps/shell/scripts/stage-postgres.mjs (Join-Path $env:TEMP $name) apps/shell/target/stage
   ```

5. Build the Windows ink recogniser (repo root). It is staged into
   `apps/shell/target/stage/native/` and ships under `native/`. The stage step
   fails if the exe is missing:

   ```powershell
   node apps/shell/scripts/build-ink-recogniser.mjs --arch=x64
   node apps/shell/scripts/stage-ink-recogniser.mjs apps/shell/target/stage --arch=x64
   ```

6. Build the installers (from `apps/shell`):

   ```powershell
   cd apps/shell
   npm run tauri -- build --bundles msi,nsis --config tauri.bundle.json
   cd ../..
   ```

   The output is in `apps/shell/target/release/bundle/` (`msi` and `nsis`
   folders). The MSI is `*.msi`; the NSIS installer is `*-setup.exe`.

7. Delete `apps/shell/target/stage` when done. It holds 100+ MB of sidecar
   files and CI deletes it before the cache save.

Bundle resources are set in `apps/shell/tauri.bundle.json`: the sidecar, the
Postgres build, the ink recogniser (`native/`) and the web export.

## Python SDK (`py-vX.Y.Z`)

1. PR: bump `__version__` in `python/weaveforge/__init__.py` to whatever the
   SDK's own changes call for, and add the entry under `### Python SDK` in
   [`../../CHANGELOG.md`](../../CHANGELOG.md). Do not touch the app's versions.
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
3. `android.yml` (trigger: tag `android-v*`, or manual run) builds and signs the
   APK and attaches it to the GitHub Release.

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
3. `ios.yml` (trigger: tag `ios-v*`, or manual run) generates the Xcode project,
   builds on macOS, and attaches the ipa to the GitHub Release.

## Nightly

`nightly.yml` runs property tests (`wf-core`, 10k cases, plus a fresh seed) and
fuzzes the sync parsers for 20 minutes. Its schedule is commented out, so it
runs only when started by hand (**Actions → Nightly → Run workflow**). Failing
inputs are kept as artifacts (`proptest-regressions`, `fuzz-artifacts`).

## Publishing a release

### Desktop app (`vX.Y.Z`)

There is no release-publishing workflow for the desktop app. Publishing is
manual today.

1. PR: bump `version` in `apps/shell/tauri.conf.json`. It still says 0.1.0; set
   it to the real release version. Add the entry under
   `### Desktop` in [`../../CHANGELOG.md`](../../CHANGELOG.md). Leave
   `python/weaveforge/__init__.py` alone unless the SDK itself changed.
2. Merge when CI is green.
3. On `main`:
   ```bash
   git pull origin main
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```
4. Build the installers with the steps in
   [Desktop (Windows) build](#desktop-windows-build). The CI job does not
   upload its installers. Build them locally with those steps.
5. Create the GitHub release and attach the MSI and NSIS files:
   ```bash
   gh release create vX.Y.Z "apps/shell/target/release/bundle/msi/<file>.msi" "apps/shell/target/release/bundle/nsis/<file>-setup.exe" --title "WeaveForge vX.Y.Z" --notes-file <notes.md>
   ```
6. Write the notes on the release.

The installers are **not code-signed**. Windows will warn on first run. There is
no updater signing and no updater config in `apps/shell/tauri.conf.json` or
`apps/shell/tauri.bundle.json`. Signing and updater setup are **not set up yet**.
Do not describe the installers as verified.

## Web app (no product tag)

Merge to `main` → deploy. Document breaking schema changes in `db/migrations/`, and add user-visible changes to [`../../CHANGELOG.md`](../../CHANGELOG.md) under `[Unreleased]`.

## Checklist

- [ ] Version bumped in the track's version file (see [Versioning](#versioning)).
- [ ] CHANGELOG entry added under the track's heading.
- [ ] PR merged to `main` with CI green.
- [ ] Tag matches the version file exactly (`vX.Y.Z`, `py-vX.Y.Z`, `android-vX.Y.Z`, `ios-vX.Y.Z`).
- [ ] Tag pushed from `main` after `git pull`.
- [ ] Desktop: installers built, attached to a GitHub release, notes written.
- [ ] Python: `publish-python.yml` run passed; PyPI version confirmed.
- [ ] Android and iOS: artifact attached to the release.
- [ ] No PyPI version reused.

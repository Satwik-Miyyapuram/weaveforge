# Releasing WeaveForge

This monorepo ships **three release tracks**, one tag prefix each. Do not mix them.

| | **Desktop app** | **Python SDK** | **Android TWA** |
|---|---|---|---|
| Tag | `vX.Y.Z` (e.g. `v0.6.0`) | `py-vX.Y.Z` (e.g. `py-v0.6.0`) | `android-vN` (e.g. `android-v4`) |
| Covers | Electron shell + the offline web build inside it | The `weaveforge` SDK on PyPI | APK + AAB |
| Artifact | GitHub Release: installers per platform, plus the `latest*.yml` the in-app updater reads | PyPI wheel + sdist | Signed Android bundle on the GitHub Release |
| Workflow | `release-desktop.yml` | `publish-python.yml` | `android-twa.yml` |
| Changelog | [`../CHANGELOG.md`](../../CHANGELOG.md) | Same | Same |
| Web app | Deploys continuously on `main` (Vercel); the tag marks the version | — | Same host; Digital Asset Links must match the signing key |

**Why the desktop keeps the bare `vX.Y.Z`.** Copies already installed look for
`v*` releases (`apps/desktop/src/update-check.ts`), so moving that track to
another prefix would strand every one of them on the version they have. The SDK
moved instead — which is also what stops a desktop release publishing to PyPI,
where a version cannot be taken back.

**One version line still covers the whole repository.** The tracks are cut
separately, but the numbers stay in step: `py-v0.6.0` and `v0.6.0` are the same
commit's SDK and app. Releases before 0.5.0 kept a separate SDK history,
archived in
[`changelog-sdk-legacy.md`](../internal/reports/changelog-sdk-legacy.md).

All changes still land on `main` via pull request (branch protection). Tags are cut **from `main` after merge**.

## Desktop app (`vX.Y.Z`)

1. PR: bump **every** version in step, and update [`../CHANGELOG.md`](../../CHANGELOG.md).

   ```
   package.json                        "version"
   apps/web/package.json               "version"
   apps/desktop/package.json           "version"
   packages/core/package.json          "version"
   python/weaveforge/__init__.py   __version__
   ```

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

SECURITY: the Windows and macOS builds are not code-signed, so the only
integrity check on a downloaded update is the SHA-512 in `latest.yml`, served
over HTTPS from the same release. Say so in the notes; do not describe the
update as verified.

## Python SDK (`py-vX.Y.Z`)

1. Same version bump as above — the SDK is not versioned separately.
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

## Android TWA (`android-vN`)

1. PR: bump `appVersion` / `appVersionName` / `appVersionCode` in `apps/web/twa/twa-manifest.json` (and regenerate Bubblewrap project files if you change icons/name/host).
2. Confirm `apps/web/public/.well-known/assetlinks.json` lists the **current** keystore SHA-256:
   ```bash
   gh workflow run android-fingerprint.yml
   gh run watch
   # copy SHA-256 from the job summary into assetlinks.json, PR + deploy web
   ```
   Mismatch = Chrome URL bar comes back.
3. Merge, then on `main`:
   ```bash
   git pull origin main
   git tag android-v3
   git push origin android-v3
   ```
4. `android-twa.yml` builds, uploads artifacts, and attaches APK/AAB to the GitHub Release (creates the release if needed).

Manual rebuild without a tag: **Actions → Build Android TWA → Run workflow**.

### URL bar / Digital Asset Links

Deployed file must serve the signing cert fingerprint:

`https://app.weaveforge.org/.well-known/assetlinks.json`

- Sideload / self-signed builds → fingerprint of `android-keystore.jks` (alias `weaveforge`).
- Play App Signing → **also** add Google Play’s app-signing cert SHA-256 from Play Console.

Tester: https://developers.google.com/digital-asset-links/tools/generator  

Package id: `app.weaveforge.twa`.

## Web app (no product tag)

Merge to `main` → deploy. Document breaking schema changes in `supabase/migrations/`, and add user-visible changes to [`../CHANGELOG.md`](../../CHANGELOG.md) under `[Unreleased]`.

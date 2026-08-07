# Releasing WeaveForge

This monorepo ships **two release tracks**. Do not mix their tags.

| | **Project release** | **Android TWA** |
|---|---------------------|-----------------|
| Tag | `vX.Y.Z` (semver, e.g. `v0.5.0`) | `android-vN` (e.g. `android-v3`) |
| Covers | Web app, `@weaveforge/core`, schema, and the `weaveforge` SDK | APK + AAB on the GitHub Release |
| Artifact | GitHub Release + PyPI wheel/sdist | Signed Android bundle |
| Workflow | `publish-python.yml` | `android-twa.yml` |
| Changelog | [`../CHANGELOG.md`](../CHANGELOG.md) | Same |
| Web app | Deploys continuously on `main` (Vercel); the tag marks the version | Same host; Digital Asset Links must match the signing key |

**One version line covers the whole repository.** The SDK is not versioned
separately — it ships from the same tag, so its version must match. Releases
before 0.5.0 kept a separate SDK history, archived in
[`changelog-sdk-legacy.md`](changelog-sdk-legacy.md).

All changes still land on `main` via pull request (branch protection). Tags are cut **from `main` after merge**.

## Project release (`vX.Y.Z`)

1. PR: bump **every** version in step, and update [`../CHANGELOG.md`](../CHANGELOG.md).

   ```
   package.json                        "version"
   apps/web/package.json               "version"
   packages/core/package.json          "version"
   python/weaveforge/__init__.py   __version__
   ```

   All four must match the tag. Missing the Python one is not caught by CI —
   the publish only fails later, at PyPI, with `File already exists`, because
   hatch read a version that had already been published.
2. Merge when CI is green.
3. On `main`:
   ```bash
   git pull origin main
   git tag vX.Y.Z
   git push origin vX.Y.Z
   gh release create vX.Y.Z --title "WeaveForge vX.Y.Z" --notes-file .github/release_template.md
   ```
4. `publish-python.yml` publishes to PyPI. Confirm at https://pypi.org/project/weaveforge/ .

Do not re-use a PyPI version. Prefer Trusted Publishing; `PYPI_API_TOKEN` is the fallback.

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

`https://my-weaveforge-web.vercel.app/.well-known/assetlinks.json`

- Sideload / self-signed builds → fingerprint of `android-keystore.jks` (alias `weaveforge`).
- Play App Signing → **also** add Google Play’s app-signing cert SHA-256 from Play Console.

Tester: https://developers.google.com/digital-asset-links/tools/generator  

Package id: `app.weaveforge.twa`.

## Web app (no product tag)

Merge to `main` → deploy. Document breaking schema changes in `supabase/migrations/`, and add user-visible changes to [`../CHANGELOG.md`](../CHANGELOG.md) under `[Unreleased]`.

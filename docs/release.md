# Releasing WeaveForge

This monorepo ships **two release tracks**. Do not mix their tags.

| | **Python SDK** (`thesis-tracker`) | **Android TWA** |
|---|-----------------------------------|-----------------|
| Tag | `vX.Y.Z` (semver, e.g. `v1.2.3`) | `android-vN` (e.g. `android-v3`) |
| Artifact | PyPI wheel/sdist | APK + AAB on the GitHub Release |
| Workflow | `publish-python.yml` | `android-twa.yml` |
| Version source | `python/thesis_tracker/__init__.py` | `apps/web/twa/twa-manifest.json` (`appVersion` / `appVersionCode`) |
| Web app | Continuous on `main` (Vercel) — no release tag | Same host; Digital Asset Links must match the signing key |

All changes still land on `main` via pull request (branch protection). Tags are cut **from `main` after merge**.

## Python SDK (`vX.Y.Z`)

1. PR: bump `python/thesis_tracker/__init__.py`, update `docs/CHANGELOG.md`.
2. Merge when CI is green.
3. On `main`:
   ```bash
   git pull origin main
   git tag vX.Y.Z
   git push origin vX.Y.Z
   gh release create vX.Y.Z --title "SDK vX.Y.Z" --notes-file .github/release_template.md
   ```
4. `publish-python.yml` publishes to PyPI. Confirm at https://pypi.org/project/thesis-tracker/ .

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

`https://my-thesis-tracker-web.vercel.app/.well-known/assetlinks.json`

- Sideload / self-signed builds → fingerprint of `android-keystore.jks` (alias `weaveforge`).
- Play App Signing → **also** add Google Play’s app-signing cert SHA-256 from Play Console.

Tester: https://developers.google.com/digital-asset-links/tools/generator  

Package id: `app.weaveforge.twa`.

## Web app (no product tag)

Merge to `main` → deploy. Document breaking schema changes in `supabase/migrations/`. Optional notes under `CHANGELOG.md` → `[Unreleased]` → **Web**.

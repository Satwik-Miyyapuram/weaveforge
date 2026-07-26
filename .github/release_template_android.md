## WeaveForge Android android-vN

Signed TWA build for `app.weaveforge.twa` → `https://my-thesis-tracker-web.vercel.app`.

### Install
- **APK** (sideload): download `app-release-signed.apk` from this release
- **Play**: upload `app-release-bundle.aab` to Play Console

### Checklist
- [ ] `assetlinks.json` SHA-256 matches this keystore (and Play signing cert if applicable)
- [ ] `appVersion` / `appVersionCode` bumped in `twa-manifest.json`
- [ ] URL bar hidden after reinstall (Digital Asset Links OK)

See [docs/release.md](../docs/release.md).

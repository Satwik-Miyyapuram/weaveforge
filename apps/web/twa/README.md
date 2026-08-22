# WeaveForge — Android TWA (Trusted Web Activity)

Wraps the deployed PWA (`https://app.weaveforge.org`) into an
installable Android APK/AAB. Same web code — the APK is a thin Chrome wrapper.
Once the domain is verified via Digital Asset Links, the URL bar is hidden.

## Releases

Android ships on **`android-v*`** tags (e.g. `android-v3`). Python SDK uses
**`vX.Y.Z`**. See [docs/release.md](../../../docs/release.md).

```bash
# after bumping appVersion* in twa-manifest.json and merging to main:
git tag android-v3
git push origin android-v3
```

## Prerequisites (local machine, one time)

- JDK 17+ (`java -version`)
- Android SDK / command-line tools (Bubblewrap can fetch these on first run)
- Bubblewrap CLI: `npm i -g @bubblewrap/cli`
- Repo secrets: `ANDROID_KEYSTORE_B64`, `ANDROID_KEYSTORE_PASSWORD`,
  `ANDROID_KEY_PASSWORD`, `ANDROID_KEY_ALIAS` (see `.github/workflows/android-twa.yml`)

## Init / local build

```bash
# From apps/web/twa
bubblewrap init --manifest ../public/manifest.webmanifest
# creates android-keystore.jks — SAVE THE PASSWORD; never commit *.jks

bubblewrap fingerprint   # SHA-256 for assetlinks.json
bubblewrap build         # → app-release-signed.apk + app-release-bundle.aab
```

## Digital Asset Links (fixes the Chrome URL bar)

1. Get the signing SHA-256 (local or CI):
   ```bash
   gh workflow run android-fingerprint.yml
   ```
   Or: `keytool -list -v -keystore android-keystore.jks -alias weaveforge`
2. Put it in `../public/.well-known/assetlinks.json` under
   `sha256_cert_fingerprints` (package `app.weaveforge.twa`).
3. Deploy the web app so  
   `https://app.weaveforge.org/.well-known/assetlinks.json`  
   serves the new value.
4. If you use **Play App Signing**, add Play’s app-signing cert SHA-256 too.

Reinstall the app after assetlinks propagates (sometimes needs a few minutes +
clearing Chrome’s Digital Asset Links cache / reinstall).

## Notes

- `android-keystore.jks` is gitignored — losing it means you cannot update the
  same app identity.
- Package id: `app.weaveforge.twa`. Changing it = a different app.
- Bump `appVersion` / `appVersionName` / `appVersionCode` in `twa-manifest.json`
  for each Android release.

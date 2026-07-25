# WeaveForge — Android TWA (Trusted Web Activity)

Wraps the deployed PWA (`https://my-thesis-tracker-web.vercel.app`) into an
installable Android APK/AAB. Same web code — the APK is a thin Chrome wrapper.
Once the domain is verified via Digital Asset Links, the URL bar is hidden and
Android treats the app's storage as durable (no eviction on close).

## Prerequisites (local machine, one time)
- JDK 17+  (`java -version`)
- Android SDK / command-line tools (Bubblewrap can fetch these on first run)
- Bubblewrap CLI:  `npm i -g @bubblewrap/cli`

## Build
Run from this directory (`apps/web/twa`):

```bash
# 1. Initialize from the config (generates the Android project + a signing keystore).
#    Uses twa-manifest.json in this folder. It will create android-keystore.jks
#    and prompt for a keystore password — SAVE THAT PASSWORD, it signs every release.
bubblewrap init --manifest ../public/manifest.webmanifest

# (If init asks, accept the values already in twa-manifest.json.)

# 2. Print the signing-key SHA256 fingerprint.
bubblewrap fingerprint

# 3. Paste that SHA256 into ../public/.well-known/assetlinks.json
#    (replace REPLACE_WITH_SHA256_FROM_BUBBLEWRAP_FINGERPRINT), commit, and
#    redeploy so https://my-thesis-tracker-web.vercel.app/.well-known/assetlinks.json
#    serves the real fingerprint.

# 4. Build the signed APK (for sideload testing) and AAB (for Play Store).
bubblewrap build
# → app-release-signed.apk  and  app-release-bundle.aab
```

## Verify domain linking
- Deployed file must be reachable:
  `https://my-thesis-tracker-web.vercel.app/.well-known/assetlinks.json`
- Check with Google's tester:
  https://developers.google.com/digital-asset-links/tools/generator
- If the fingerprint is wrong/missing, the app still runs but shows the Chrome
  URL bar and storage is not marked durable.

## Install & test
```bash
adb install app-release-signed.apk
```
Confirm: no URL bar, app opens standalone, data persists after force-close.

## Notes
- `android-keystore.jks` and any `*.keystore` are gitignored — NEVER commit the
  signing key. Back it up securely; losing it means you can't ship updates under
  the same app identity.
- Package id: `app.weaveforge.twa`. Changing it later = a different app.
- If you use Play App Signing, add Google's signing SHA256 to assetlinks.json
  too (Play re-signs your upload), else installs from the Store fail verification.
- Bump `appVersion` + `appVersionCode` in twa-manifest.json for each release.

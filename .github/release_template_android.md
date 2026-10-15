## WeaveForge Android android-vX.Y.Z

Native app `org.weaveforge.ink` (ink overlay + deadlines widget).

### Install
- Download `WeaveForge-<version>-Android.apk` from this release and open it on your device.
- **Allow unknown apps**: If prompted that your browser or file manager cannot install unknown apps, tap **Settings**, turn on **Allow from this source**, go back, and tap **Install**.
- **Play Protect**: If Google Play Protect warns that the developer is unrecognized, tap **More details** (or the drop-down arrow) → **Install anyway**.
- **Via ADB**: `adb install -r WeaveForge-<version>-Android.apk` (see [`docs/using/desktop.md`](../docs/using/desktop.md#installing-on-android)).

### Checklist
- [ ] `versionName` / `versionCode` bumped in `apps/android/app/build.gradle.kts`
- [ ] Certificate SHA-256 printed by the workflow matches the previous release (else Android refuses the update)

See [docs/building/release.md](../docs/building/release.md).

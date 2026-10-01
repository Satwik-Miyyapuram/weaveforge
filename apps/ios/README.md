# WeaveForge for iOS

A WKWebView shell around `https://app.weaveforge.org/`, with the same host
allow-list as the Android app; other links open in Safari.

## Build

On a Mac with Xcode and [XcodeGen](https://github.com/yonaskolb/XcodeGen):

```bash
cd apps/ios
xcodegen generate
open WeaveForge.xcodeproj
```

Pick your team under Signing to run it on a device.

## Release

Bump `MARKETING_VERSION` (and `CURRENT_PROJECT_VERSION`) in `project.yml`, then
push tag `ios-vX.Y.Z`. `.github/workflows/ios.yml` builds an unsigned
`WeaveForge-<version>-iOS.ipa` and attaches it to the release.

There is no Apple developer account behind the build, so the ipa is unsigned:
install it with AltStore or Sideloadly, which sign it with your own Apple ID
(free IDs must re-sign every 7 days).

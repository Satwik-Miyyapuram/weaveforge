# WeaveForge for Android — the inking shell

The web app in a `WebView`, with one thing over it: a transparent,
front-buffered stylus surface (`InkingOverlayView`) that draws the wet stroke
at the digitiser's rate and refuses the palm before the nib lands. Design:
[`docs/internal/design/ink-native-bridges.md`](../../docs/internal/design/ink-native-bridges.md) §2.

This is not the TWA in `apps/web/twa` — a Trusted Web Activity runs in Chrome
Custom Tabs, which allow no native view on top. Both can be installed side by
side (`app.weaveforge.twa` vs `org.weaveforge.ink`).

## What is native

- `MainActivity.kt` — loads `APP_URL`, installs `window.AndroidInkingBridge`
  (`setViewport`, `clearViewport`, `setTool`, `setPenOnly`, `setHandedness`,
  `clearOverlay`), and calls `window.onNativeStrokeComplete([x, y, p, t, …])`
  on pen lift.
- `InkingOverlayView.kt` — `CanvasFrontBufferedRenderer` overlay; ink rect
  gating (stylus outside the page goes to the web view); hover-lock palm
  rejection in tiers (pen near → driver flag → contact area → pen-only →
  multi-touch pass-through).

Everything else is the web app: the stroke is fed through the same capture
session as a browser pointer, so filtering, indexing, recognition and saving
are identical. The web side is `apps/web/src/features/ink/application/native-bridge.ts`.

## Build

```powershell
.\build-apk.ps1                 # debug, loads https://app.weaveforge.org/
.\build-apk.ps1 -Url http://192.168.1.10:3000   # a laptop's dev server
```

The script copies the project out of the checkout first: Google Drive and
OneDrive put a `desktop.ini` into every synced folder, and the Android
resource merger refuses them. Needs JDK 17–24 and the Android SDK
(`ANDROID_HOME`, default `%LOCALAPPDATA%\Android\Sdk`).

Install: `adb install -r weaveforge-ink-debug.apk`, or copy the APK to the
tablet and open it (allow the source once).

## Not done

- Release signing (no `signingConfig`; a release build is unsigned).
- Handedness only records the side; a rest-zone heuristic is not wired.
- iOS (`§3` of the design note) is out of scope.

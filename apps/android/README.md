# WeaveForge for Android — the inking shell

The web app in a `WebView`, with one thing over it: a transparent,
front-buffered stylus surface (`InkingOverlayView`) that draws the wet stroke
at the digitiser's rate and refuses the palm before the nib lands. Design:
[`docs/internal/design/ink-native-bridges.md`](../../docs/internal/design/ink-native-bridges.md) §2.

**This is a developer tool, not the shipped Android app.** Releases come from the
Bubblewrap Trusted Web Activity in [`apps/web/twa`](../web/twa/README.md), which
ships on `android-v*` tags with signing and R8 already configured. A TWA runs in
Chrome Custom Tabs, which allow no native view on top — which is the whole reason
this module exists separately. Both can be installed side by side
(`app.weaveforge.twa` vs `org.weaveforge.ink`).

Because this module is debug-only, its release configuration is deliberately not
production-shaped: `isMinifyEnabled = false` and no `signingConfig`. Adding R8 here
would strip the reflection-called `@JavascriptInterface` methods unless a keep rule
held them, and inking would then fail **in release only** — a bad trade for an
artifact nobody installs. See *Not done* below.

## What is native

- `MainActivity.kt` — loads `APP_URL`, installs `window.AndroidInkingBridge`
  (`setToolMode`, `setViewport`, `clearViewport`, `setTool`, `setPenOnly`,
  `setHandedness`, `clearOverlay`), and calls
  `window.onNativeStrokeComplete([x, y, p, t, …])` on pen lift. It also owns the
  WebView's origin allow-list and its teardown.
- `InkGestureView.kt` — the layout's root, and the **only** place that decides who
  owns a touch stream, through `onInterceptTouchEvent`. It has to be a parent for
  that: siblings in a `FrameLayout` cannot revise an ownership decision, so an
  overlay that "passes one finger through but rejects a palm arriving later" cannot
  be written without one.
- `InkGestureRouter.kt` — the gesture rules, as a **pure function** over a flat
  `GestureEvent` rather than a `MotionEvent`, so they are a JVM test with no device:
  `app/src/test/kotlin/.../InkGestureRouterTest.kt`.

  | Contact | Pen / Highlighter selected | No ink tool |
  | --- | --- | --- |
  | pen | writes | — |
  | one finger | moves the paper | moves the paper |
  | two fingers | move and zoom | move and zoom |
  | three or more | rejected | rejected |
  | palm | rejected | rejected |

  With no ink tool selected the container claims nothing, so a mouse and a trackpad
  behave exactly as they would without this module.
- `InkingOverlayView.kt` — `CanvasFrontBufferedRenderer` overlay, ink-rect gating
  (a stylus outside the page goes to the web view), the latched pen pointer id, and
  a bounded stroke buffer.

Everything else is the web app: the stroke is fed through the same capture
session as a browser pointer, so filtering, indexing, recognition and saving
are identical. The web side is `apps/web/src/features/ink/application/native-bridge.ts`.

Picking the pen up selects a pen mode; see `toolOnPenApproach` in
`apps/web/src/features/ink/ui/use-ink-prefs.ts`.

## Build

```powershell
.\build-apk.ps1                 # debug, loads https://app.weaveforge.org/
.\build-apk.ps1 -Url http://192.168.1.10:3000   # a laptop's dev server
```

The script copies the project out of the checkout first: Google Drive and
OneDrive put a `desktop.ini` into every synced folder, and the Android
resource merger refuses them. Needs JDK 17–21 and the Android SDK
(`ANDROID_HOME`, default `%LOCALAPPDATA%\Android\Sdk`).

JDK 22 and later will not work: the pinned Android Gradle Plugin (8.7.3) fails
before Kotlin runs, with `IllegalArgumentException: <version>` — the failure is in
AGP's version parsing, not in this module's code.

The gesture rules can be tested without a device or an emulator:

```powershell
.\gradlew.bat :app:testDebugUnitTest
```

Install: `adb install -r weaveforge-ink-debug.apk`, or copy the APK to the
tablet and open it (allow the source once).

## Permissions

The module holds `INTERNET` and nothing else, and `scripts/check-android-permissions.mjs`
(run by `npm run check:boundaries`) fails the build if that changes. The reason is
in the script: with an accessibility service or a device administrator enabled for
some app, banking and UPI apps refuse to open or refuse to draw their PIN pad — and
that symptom has been attributed to this app before. It is not this app, and the
gate is what keeps it that way.

## Not done

- Release signing, and R8 shrinking: see the note at the top — this is a debug
  tool, and releases are the TWA's job.
- Handedness only records the side; a rest-zone heuristic is not wired.
- Hover before contact is not bridged: a pen that hovers and then touches down
  selects a pen mode on the touch, but a pen that only hovers does not.
- iOS (`§3` of the design note) is out of scope.


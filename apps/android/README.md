# WeaveForge for Android — the inking shell

The web app in a `WebView`, with one thing over it: a transparent,
front-buffered stylus surface (`InkingOverlayView`) that draws the wet stroke
at the digitiser's rate and refuses the palm before the nib lands. Design:
[`docs/internal/design/ink-native-bridges.md`](../../docs/internal/design/ink-native-bridges.md) §2.

**This shell is not the TWA, and it is not a developer toy either.** The stylus
overlay is the reason it exists: a Trusted Web Activity runs in Chrome Custom Tabs,
which allow no native view on top. So if you want ink, you install this — which makes
it a real deliverable, and it has a real release path (signing config and R8, below).
The Bubblewrap TWA in [`apps/web/twa`](../web/twa/README.md) is the *other* app, for
people who want the web app alone; it ships on `android-v*` tags. Both install side by
side (`app.weaveforge.twa` vs `org.weaveforge.ink`).

## Release configuration, and the one rule it depends on

`isMinifyEnabled = true`, `isShrinkResources = true`, and a `signingConfig` taken
from the environment (absent it, the release variant is simply unsigned). Measured
on this machine: **8.68 MB debug → 1.71 MB release**, an 80 % reduction.

R8 is safe here for exactly one reason, and it is worth knowing which:
`app/proguard-rules.pro` keeps `MainActivity$NativeBridge` and its
`@JavascriptInterface` methods. R8 cannot see those calls — the WebView resolves
them by name through reflection — so without the rule it strips the class and the app
ships with `window.AndroidInkingBridge` undefined. The web side guards for the
object's absence, so nothing crashes; inking just stops, silently, in release only.

That was checked rather than assumed: after `assembleRelease` the DEX still contains
`NativeBridge`, `setToolMode`, `setViewport`, `clearOverlay`, `setHandedness`,
`setPenOnly` and `setTool` as plain names. If a future change to the rule or the
bridge removes them, that check is what to repeat.

## Signing

Read from the same four environment variables the TWA's release workflow uses, so one
set of secrets covers both apps:

| Variable | What |
| --- | --- |
| `ANDROID_KEYSTORE_FILE` | path to the `.jks` |
| `ANDROID_KEYSTORE_PASSWORD` | keystore password |
| `ANDROID_KEY_ALIAS` | key alias |
| `ANDROID_KEY_PASSWORD` | key password |

Not committed, and not read from `local.properties`: a keystore is an identity, and
identities do not belong in a repository.

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
.\build-apk.ps1                                 # debug, loads https://app.weaveforge.org/
.\build-apk.ps1 -Url http://192.168.1.10:3000   # a laptop's dev server
.\build-apk.ps1 -Release                        # release; signed when the four
                                                # ANDROID_KEYSTORE_* variables are set
```

The script copies the project to `%LOCALAPPDATA%\weaveforge-android-build` first, and
that is not tidiness: a checkout under a cloud-synced folder (Documents, OneDrive)
fails the build at `generateDebugBuildConfig` with
`java.nio.file.AccessDeniedException`, because the sync client holds the generated
tree. Building the copy is the workaround, and the copy is also where
`local.properties` can live without being committed.

Needs **JDK 17–21** and the Android SDK (`ANDROID_HOME`, default
`%LOCALAPPDATA%\Android\Sdk`). `build-apk.ps1` finds a JDK 17/21 under
`~/.jdks` on its own; if only a newer JDK is on `PATH`, set `JAVA_HOME`.

JDK 22 and later will not work: the pinned Android Gradle Plugin (8.7.3) fails before
Kotlin runs, with `IllegalArgumentException: <version>` — that is AGP's version
parsing, not this module's code.

Verified on JDK 21.0.12: `:app:compileDebugKotlin`, `:app:assembleDebug`,
`:app:assembleRelease` and `:app:testDebugUnitTest` all succeed.

The gesture rules run without a device or an emulator, which is deliberate — see
*What is native* above:

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

- The release APK has never been installed on a device. R8 is configured and the
  keep rule is verified in the DEX, but "inked correctly in release" is a claim only
  a tablet can settle — a stripped bridge method or an optimised-away callback would
  look exactly like a working build here.
- Handedness only records the side; a rest-zone heuristic is not wired.
- Hover before contact is not bridged: a pen that hovers and then touches down
  selects a pen mode on the touch, but a pen that only hovers does not. Closing it
  means a second `window.onNative…` global beside `onNativeStrokeComplete`.
- iOS (`§3` of the design note) is out of scope.


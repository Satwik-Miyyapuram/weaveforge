# Phase 4: phones on Tauri 2

Plan §7 phase 4. This note fixes the shape before any code, as
`phase-2-desktop.md` did for the desktop.

## Where we start

- **Android** is `apps/android`: a Kotlin app that opens
  `https://app.weaveforge.org/` in a `WebView`. Its native parts are the ink
  overlay (`InkingOverlayView`, `InkGestureView`, `InkGestureRouter`), the
  `window.AndroidInkingBridge` JS interface with `window.onNativeStrokeComplete`,
  the host allow-list, Google sign-in through the account picker, and the
  deadlines widget. It needs the network for everything.
- **iOS** has no app.
- **Desktop** (phase 2) is `apps/shell`: Tauri 2.12.5 serving the static web
  export on the `app` scheme, with a Node sidecar for the database and the local
  API, and native commands for the vault, git, TeX, relays and embeddings.

## Decisions

1. **One shell crate.** `apps/shell` gains the Android and iOS targets
   (`tauri android init`, `tauri ios init`). Desktop-only modules (sidecar,
   TeX, local API, Overleaf git, vault watcher, Zotero, Mattermost window,
   menu, update check) build only under `cfg(desktop)`; their crates move to
   `[target.'cfg(not(any(target_os = "android", target_os = "ios")))'.dependencies]`.
   The phone build keeps the `app` scheme, the route table, the relays and the
   shim. A second crate would copy that code.
2. **The ink overlay becomes a Tauri plugin** (`apps/shell/plugins/ink`, plugin
   name `ink`). The Kotlin files move into it unchanged
   (`InkingOverlayView.kt`, `InkGestureView.kt`, `InkGestureRouter.kt` and its
   JVM test). The plugin's `load(webView)` hook wraps the WebView in
   `InkGestureView` and adds the overlay above it, as `MainActivity.onCreate`
   does today.
3. **The page API stays.** The web side keeps `window.AndroidInkingBridge`
   and `window.onNativeStrokeComplete` (`native-bridge.ts`), so no web change
   is needed. The plugin installs the same `NativeBridge` with
   `addJavascriptInterface` and calls back with `evaluateJavascript`, so a
   finished stroke takes the same path as today and latency cannot get worse.
   If the interface does not appear on the first page (see spike question 2),
   the shim maps the same seven methods onto `invoke("plugin:ink|…")` instead.
4. **The UI is bundled.** Phones load the static export from the `app` scheme,
   as the desktop does, so the app opens offline. Data offline is the web
   build's own browser store (no Node on phones, so no sidecar). Sync is the
   phase 3 Rust engine where the desktop uses it, and the web code elsewhere.
5. **Sign-in uses a deep link**, not the desktop loopback port: phones cannot
   rely on a listening socket. Google sign-in on Android keeps the account
   picker.
6. **The widget and its config activity stay Kotlin**, in the plugin, with
   their JVM tests. They are not part of the WebView.
7. **The old Kotlin app stays** until the Tauri APK has inked on a tablet. It
   is the fallback release (plan §8, as Electron is for the desktop).

## Spike first (4.2)

The plan calls out two things the Tauri docs do not cover. The spike answers
them before the rest is built:

1. **Z-order and touches.** Does an overlay added in `load` sit above Tauri's
   WebView, and does `InkGestureView.onInterceptTouchEvent` still get every
   touch first when it becomes the WebView's parent?
2. **Timing.** Is the WebView's first page loaded after `load` runs, so an
   interface added there is visible to that page?

Both need a device or an emulator. The build machine has neither (no device,
no emulator package), so the spike builds the APK and records the questions as
**blocked on hardware**; everything that a JVM test or a build can prove goes
ahead.

## Steps

| Step | What | Proof without a device |
| --- | --- | --- |
| 4.1 | This note | review |
| 4.2 | `tauri android init`; desktop-only modules behind `cfg(desktop)`; the APK builds | `cargo check --target aarch64-linux-android`; `assembleDebug` |
| 4.3 | Ink plugin: Kotlin files moved, `load` wraps the WebView, `NativeBridge` installed | JVM tests (router, bridge argument parsing); APK builds |
| 4.4 | Widget, config activity, host allow-list and account picker in the plugin | their JVM tests; permissions gate (`check-android-permissions.mjs`) |
| 4.5 | Deep-link sign-in | Rust tests of the link parser; web test of the handler |
| 4.6 | CI: Android build job | green job |
| 4.7 | iOS target, offline open, edit and sync | **blocked: needs a Mac** |
| 4.8 | On-device checks: spike questions, ink latency against today's overlay | **blocked: needs a tablet or emulator** |

## Done when (plan §7)

- the phones have the same feature list as desktop: the features that need
  only the page and the relays. Features that need a local process (TeX,
  local API, MCP, Overleaf git, Zotero desktop) are desktop-only, as they are
  today; listed for the user to confirm.
- ink latency is at most today's overlay (4.8);
- offline open, edit and sync work on iOS (4.7).

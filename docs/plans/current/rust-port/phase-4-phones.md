# Phase 4: phones on Tauri 2

Plan §7 phase 4. This note fixes the shape before any code, as
`phase-2-desktop.md` did for the desktop.

## Where we start

- **Android** is `apps/android`: a Kotlin app that opens
  `https://app.weaveforge.org/` in a `WebView`. Its native parts are:
  - the ink overlay (`InkingOverlayView`, `InkGestureView`, `InkGestureRouter`);
  - the `window.AndroidInkingBridge` JS interface, which calls back through
    `window.onNativeStrokeComplete`;
  - a navigation policy that keeps that interface safe
    (`MainActivity.kt:30-45`, `:118-163`): a host allow-list, sub-resource
    blocking, and Safe Browsing set to back-to-safety;
  - WebView settings (`MainActivity.kt:76-112`): no file or content access,
    Safe Browsing on, no geolocation or zoom, and a user agent without `; wv`
    and `Version/`, which Google OAuth otherwise refuses
    (`disallowed_useragent`);
  - lifecycle code: `onDestroy` breaks the overlay, bridge and WebView leak
    cycle; back button; `saveState`/`restoreState`; `onResume`/`onPause`
    forwarded to the account picker; `configChanges`, so rotation does not
    recreate the activity;
  - Google sign-in through the account picker;
  - the plan widget, which opens the app with `EXTRA_ROUTE=plan`.

  It needs the network for everything.
- **iOS** has no app.
- **Desktop** (phase 2) is `apps/shell`: Tauri 2.12.5 serving the static web
  export on the `app` scheme, with a Node sidecar for the database and the local
  API, and native commands for the vault, git, TeX, relays and embeddings.

## Decisions

1. **One shell crate.** `apps/shell` gains the Android and iOS targets
   (`tauri android init`, `tauri ios init`). A second crate would copy the
   scheme handler, the route table, the relays and the shim.
   - **Gate dependencies first, modules second.** `commands.rs` ties most
     modules together, so splitting modules is a big change. Where code
     builds on a phone, it stays in and fails at run time with a clear error.
     Only code that cannot build moves behind `cfg(desktop)`.
   - **No OpenSSL on phones.** Vendored OpenSSL needs perl and make to
     cross-build, and the build machine has neither. In `Cargo.toml`, git2
     and reqwest move to target tables:
     - desktop (`cfg(not(any(target_os = "android", target_os = "ios")))`)
       keeps today's features;
     - phones get git2 with `vendored-libgit2` only (no https, so no Overleaf
       git) and reqwest with `rustls-no-provider` plus rustls on `ring`
       (`ring` builds with the NDK's clang; aws-lc-rs needs cmake).

     `cfg(desktop)` is a tauri-build alias, valid in code but not in
     `Cargo.toml`, so the tables use `target_os`.
   - **The Tauri config splits.** These become desktop-only, through
     `tauri.{windows,macos,linux}.conf.json` or a `tauri.android.conf.json`
     override:
     - `bundle.externalBin` (the Node sidecar);
     - the desktop plugins;
     - the menu and window config.

     Capability files set `"platforms"`. `cargo check` does not catch a
     bundle error; only `tauri android build` does.
2. **The ink overlay becomes a Tauri plugin** (`apps/shell/plugins/ink`, plugin
   name `ink`).
   - The Kotlin drawing and routing code moves in unchanged:
     `InkingOverlayView.kt`, `InkGestureRouter.kt` and its JVM test.
   - `InkGestureView` gets a small wiring change. Today it finds the overlay
     by layout id (`R.id.inkOverlay`), and the plugin has no layout, so it
     takes the overlay as a constructor argument.
   - The plugin's `load(webView)` does on the UI thread what the layout and
     `MainActivity.onCreate` do today:
     1. take the WebView out of its parent;
     2. put an `InkGestureView` at the same index with the same
        `LayoutParams`;
     3. put the WebView inside it, with the overlay above.

     A Robolectric test pins the view tree this produces.
   - The plugin overrides `onDestroy`, `onResume`, `onPause` and
     `onNewIntent` for the lifecycle code above. A test covers the leak fix.
     A build check confirms the generated manifest keeps `configChanges`.
3. **The page API stays, behind a navigation policy.**
   - The web side keeps `window.AndroidInkingBridge` and
     `window.onNativeStrokeComplete` (`native-bridge.ts`), so no web change
     is needed.
   - The plugin installs the same `NativeBridge` with
     `addJavascriptInterface` and calls back with `evaluateJavascript`. A
     finished stroke takes the same path as today, so latency cannot get
     worse.
   - `addJavascriptInterface` takes effect at the next page load. So when
     `load` runs after the first page has started (`webView.url != null`),
     the plugin calls `reload()`.
   - Wry owns the `WebViewClient`, because it serves the app scheme, so the
     old client cannot come along. Its policy moves:
     - navigation goes through Tauri's `on_navigation` in Rust: the app
       origin is allowed, everything else opens in the system browser;
     - sub-resource blocking becomes a strict CSP (`connect-src`,
       `img-src`);
     - Safe Browsing and the other WebView settings are set again in
       `load`, each one pinned by a test.
4. **The UI is bundled.**
   - Phones load the static export through the Tauri scheme, so the app
     opens offline.
   - On Android, Tauri serves that scheme as `http(s)://<scheme>.localhost`,
     not `app://`. The 4.2 build confirms the exact origin, and
     `useHttpsScheme` is set.
   - That origin goes into the CSP, the host checks and the auth redirect
     list. The auth redirect list is a production change, so the user is
     asked first.
   - Offline data is the web build's own browser store, because phones have
     no Node and so no sidecar.
   - Sync uses the phase 3 Rust engine where the desktop uses it, and the web
     code elsewhere.
5. **Moving from the old app loses its browser data.**
   - Its IndexedDB, local storage and session live under
     `https://app.weaveforge.org`; the new app's origin is different.
   - Before the switch, the old app shows a "sync everything first" prompt,
     and sign-in is needed again after it.
   - The new app keeps the old `applicationId` and signing key, so it
     upgrades in place rather than installing a second app. This needs the
     user's release key, so it is listed as an approval.
6. **Sign-in uses App Links with PKCE**, not the desktop loopback port.
   - Phones cannot rely on a listening socket.
   - A custom scheme can be claimed by any app, so it is not used.
   - App Links need `/.well-known/assetlinks.json` on the domain and an
     `autoVerify` intent filter; iOS needs Universal Links.
   - The hosting and the Supabase redirect URLs are production changes that
     need the user's approval.
   - Google sign-in on Android keeps the account picker.
7. **The widget and its config activity stay Kotlin**, in the plugin, with
   their JVM tests.
   - The widget's `EXTRA_ROUTE=plan` is handled in the plugin's
     `onNewIntent` and at start.
   - Routes stay a fixed list, so no intent can carry a URL.
8. **The old Kotlin app stays** until the Tauri APK has inked on a tablet. It
   is the fallback release (plan §8, as Electron is for the desktop).

## Spike first (4.2)

The spike answers these questions before the rest is built. The Tauri docs do
not cover them.

1. **Z-order and touches.**
   - Does an overlay added in `load` sit above Tauri's WebView?
   - Does `InkGestureView.onInterceptTouchEvent` still get every touch first
     once it becomes the WebView's parent?
2. **Bridge reach.**
   - Does the interface reach the first page after the reload?
   - Is it unreachable from any other origin once the navigation policy is in
     place?
3. **TLS roots.** reqwest's rustls uses `rustls-platform-verifier`, which
   must be set up through JNI on Android.
   - Does Tauri do that set-up?
   - If not, the relays use bundled roots (`tls_certs_only`) on phones.
4. **Origin.** What is the exact origin of the bundled UI?

Questions 1, 2 and 4 need a running app. The build machine has no device and no
emulator package, and installing one costs gigabytes, so these questions are
recorded as **blocked on hardware**. Two other routes exist:

- A CI emulator (`reactivecircus/android-emulator-runner`) with instrumented
  tests can answer 2, 4 and most of 1. It can inject stylus `MotionEvent`s.
  Actions minutes are used up for now.
- Only the latency check truly needs a tablet.

## Steps

| Step | What | Proof without a device |
| --- | --- | --- |
| 4.1 | This note | review |
| 4.2 | Dependency target tables; config split; `tauri android init`; APK builds | `cargo check --target aarch64-linux-android`; `tauri android build --debug` |
| 4.3a | Ink plugin: Kotlin moved, `InkGestureView` wiring, `load` reparents | JVM router tests; Robolectric view-tree test |
| 4.3b | Bridge and reload; WebView settings; `on_navigation` policy and CSP | JVM test of settings and bridge arguments; Rust test of the navigation rule |
| 4.3c | Lifecycle: destroy, resume, pause, new intent; `configChanges` kept | JVM leak test; merged-manifest check |
| 4.4 | Widget, config activity and account picker in the plugin; widget route | their JVM tests; `check-android-permissions.mjs` pointed at the merged manifest from `assembleDebug` |
| 4.5 | App Links sign-in with PKCE | Rust tests of the link parser and PKCE; web test of the handler; hosting and redirect URLs **wait for approval** |
| 4.6 | CI: Android build job (and the emulator job, when minutes allow) | green job |
| 4.7 | iOS target, offline open, edit and sync | **blocked: needs a Mac** |
| 4.8 | On-device checks: spike questions, ink latency against today's overlay | **blocked: needs a tablet or emulator** |

## Done when (plan §7)

- **The phones have the same feature list as the desktop.** That means the
  features that need only the page and the relays. These are desktop-only, as
  they are today, and are listed for the user to confirm:
  - features that need a local process: TeX, the local API, MCP, Overleaf
    git, Zotero desktop;
  - the ink overlay on iOS: Apple Pencil goes through web pointer events
    there, and a PencilKit plugin would be new work;
  - the account picker, which is Android only: iOS signs in through the link.
- **Ink latency is at most today's overlay** (4.8, Android).
- **Offline open, edit and sync work on iOS** (4.7).

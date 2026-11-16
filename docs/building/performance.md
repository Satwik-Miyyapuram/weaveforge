# Performance

How the desktop app stays quick to switch and light on memory, and how to
measure it. Every number below is read from the code or a script, not promised.

## Keep-alive screens

`KeepAliveProvider` and `KeepAliveRoute` (`apps/web/src/app/keep-alive.tsx`)
keep a heavy screen mounted when you leave it, so coming back costs no
unmount and mount (the comment in the file cites about 110 ms for Papers).

- A route page wraps its screen in `<KeepAliveRoute path="/papers" scope="Papers">`
  (`apps/web/src/app/papers/page.tsx`).
  Today only Papers does. The provider sits in `app-shell.tsx`.
- Each path has one entry. `scope` names the error boundary, `KeptBoundary`,
  which stands in for the route's `error.tsx`.
- A screen that is not shown gets `display: none`, `inert`, and
  `ScreenActiveContext` false. `data-shown` marks the shown one.
  `useScreenActive` reads the context, so a screen can pause work while hidden.
  `useWhileShown(value)` holds the value as of the last render while shown.
- A project switch drops every kept screen. The phone layout turns keep-alive
  off (`enabled` is false when the breakpoint is mobile), so a screen renders in
  place there.

## Boot snapshot

A cold start waits for the Rust core, the session and the local database. The
boot snapshot paints the last screens as a picture meanwhile.

- `lib/boot-snapshot.ts` stores the markup through the device snapshot store
  (name `boot`, key `weaveforge.snapshot.boot`, `VERSION = 1`). Up to 3 screens
  are kept, each at most `MAX_SNAPSHOT_HTML` (150,000 characters). A bigger screen
  is not kept.
- It is kept for one user, one project and one build of the stylesheets
  (`styleBuildKey`, a hash over the stylesheet hrefs). Anything else reads as a
  miss, as does any doubt. Desktop only. Sign-out clears it with the other
  `weaveforge.` keys.
- `app/boot-snapshot.tsx` shows it inert, hidden from assistive tech and
  taking no input. Dialogs, menus, canvases, media and hidden kept screens are left
  out of the saved markup, and it is read back through DOMPurify. It goes when
  the live screen is up, on a click or key press, when the session is someone
  else's, on a navigation away, or after 10 seconds.
- `lib/screen-shown.ts` marks `wf:screen:<name>:shown` with a measure from the
  last navigation start (`wf:nav:start`), through `useScreenShown`. The snapshot
  uses the same mark to know the live screen is up.

## Memory

- `useReleasedWhileHidden` (`lib/hooks/use-released-while-hidden.ts`) is true
  once a screen has been hidden for `HIDDEN_RELEASE_MS` (60 seconds). Heavy
  parts that can be rebuilt, such as painted pages and caches, free themselves
  then and repaint on return. It is false again as soon as the screen is shown.
- While the window is minimized, the shell asks WebView2 for a Low memory target
  and goes back to Normal on restore (`apps/shell/src/idle_memory.rs`, Windows,
  WebView2 runtime 1.0.1774 or newer). The page keeps running, so sync and
  timers go on. Other platforms do nothing.

## Measuring

- `node scripts/perf/memory.mjs [--json] [--dump]` reads WeaveForge Dev over
  CDP (port 9223, or `CDP_PORT`) and prints the JS heap, wasm memory, DOM,
  canvases, images, workers and the working set of every WebView2 process by
  type, plus the shell and its local Postgres. `--dump` adds Chromium's own
  split and takes about 5 seconds. It is read-only.
- `node scripts/perf/db-start.mjs --bin <postgres bin dir> [--runs 5] [--json]`
  times the phases of the local database start on a scratch cluster: initdb,
  spawn until it answers, connect, migrate and the local user. It never touches
  an app's data.
- `npm run bundle:budget` (`scripts/check-bundle-budget.mjs`) sums the gzipped
  JS each route loads from the build manifest and compares the largest against
  a budget. It is a ratchet: the default is 340 KB, a few routes have a higher
  allowance that may only come down. Run it after `npm run build`.

## Related

- [Developer guide](dev.md)
- [How WeaveForge is put together](architecture-map.md)

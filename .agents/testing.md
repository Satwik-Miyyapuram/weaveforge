# Testing, for agents

Every change is proven before it is reported: a test that fails without it, or
numbers and a screenshot from the running app. A claim without evidence is a
guess.

## 0. Tiers: run the cheap gates first

Only the tiers that compile Rust or run a full suite wait for the build lock
(`%TEMP%\wf-build-lock\owner.txt`). Run them in this order and fix every
failure from one tier in one batch before you move on.

| Tier | What | Lock | Command |
| --- | --- | --- | --- |
| 0 | eslint, tsgo typecheck, every `check:boundaries` gate (one by one), `check:docs`, `cargo fmt --check` | no | `npm run preflight` (~70 s, 3 at a time; `WF_PREFLIGHT_JOBS=1` uses less RAM) |
| 1 | unit tests scoped to the feature | no | `node ./scripts/run-tests.mjs src/features/<name>` in `apps/web`; `cargo test -p <crate> -j1` |
| 2 | clippy, cargo build, the full suite, `git push` (pre-push hook) | yes | `npm run check:pre-push`, `npm run check:rust -- --local` |
| 3 | WeaveForge Dev refresh + desktop e2e suite (§3–4) | yes | once per batch, after all its code is in |

- The typecheck is tsgo (`@typescript/native-preview`): it is about 5× faster
  than tsc and reports the same errors. Do not add tsc back.
- `run-tests.mjs` runs one test file at a time (`WF_TEST_CONCURRENCY`
  overrides) to stay within the 1 GB RAM rule. A directory argument runs
  only the tests under it. Never leave a test run behind; kill it if you stop.
- The pre-push hook still runs everything. Push only after tier 0 is green.

## 1. Unit tests and typecheck

The Rust bindings, the WASM package (`packages/wf-wasm/pkg`) and the docs map
are generated, not committed. A fresh clone or worktree runs
`npm ci && npm run generate` first; the web `predev`, `prebuild` and `pretest`
hooks rerun the bindings and WASM steps. The shell's `build.rs` bundles the
bridge with esbuild, so `npm ci` also comes before any shell `cargo` command.

From the repo root (Git Bash or PowerShell):

| Area | Test | Typecheck |
| --- | --- | --- |
| `packages/core` | `npm run test:core` | `npm run typecheck --workspace @weaveforge/core` |
| `apps/web` | `npm run test:web` | `npm run typecheck --workspace @weaveforge/web` |
| everything | — | `npm run typecheck` |

One file or one test, faster:

```bash
cd apps/shell && cargo test --lib launch::
cd packages/core && node --import tsx --test test/features/reader/references.test.ts
npm run test:web -- --test-name-pattern "find overlay"
```

- Tests mirror source: `packages/core/test/` follows `packages/core/src/`;
  web tests sit in a `test/` folder beside the feature.
- A bug fix adds the test that would have caught it, and that test is run
  once against the old code to see it fail.
- New repositories get the shared contract suite (see `CONTRIBUTING.md`).
- Web integration and e2e (`test:integration:web`, `test:e2e`) need
  credentials or a browser install; run them only when the change touches
  that layer.

## 2. Web previews

`.claude/launch.json` names the dev servers (`web`, `web-desktop-mode`,
`web-prod`, `web-worktree`, `pitch-export`). Start one with the preview tool,
never from the shell. Good for layout and CSS; anything that depends on the
desktop shell (file system, app:// routes) is checked in the
desktop app below.

## 3. Desktop: the WeaveForge Dev build

The person's installed **WeaveForge** holds their real workspace. Never kill,
reinstall or drive it. Test in a side-by-side **WeaveForge Dev** build that has
its own app id, user-data folder and workspace pointer.

### What keeps Dev apart

- Its own app id, user-data folder and workspace pointer (see the build below).
- Open a new or demo project in Dev. Never point it at the person's
  workspace: two apps writing one workspace's files race each other.
- Sign-in loopback port 53682 is shared, so Dev logs `EADDRINUSE` while the
  main app runs. Harmless for local-only checks.

### Build

The Tauri shell becomes the Dev build only through the `tauri.dev.json`
overlay (productName `WeaveForge Dev`, identifier
`dev.weaveforge.desktop.dev`). It then migrates from the Electron Dev profile
and leaves editor MCP configs alone. Never run a Tauri build without it on
this machine: it would migrate from the installed app's data.

```powershell
cd apps\shell; node scripts/build-web.mjs; cd ..\..
cd apps\shell; npm run tauri -- build --no-bundle --config tauri.dev.json
```

A release exe reads its MCP bridge from `<out>\app`, laid out as
`tauri.bundle.json` maps it:
`plugins\weaveforge-research\mcp-server\index.mjs` to
`app\weaveforge-mcp.mjs`. A debug build reads it from the repo instead when
`WF_DEV_REPO` names the repo root. 0.9.8 bundles no Postgres and no
migrations.

Copy `target\release\weaveforge-shell.exe` into `<out>`, and
`apps\shell\dist\web` to `<out>\web`. Run the exe from `<out>` unbundled, so
it registers no URL scheme. For CDP set
`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223`; the page
origin is `https://app.localhost`.

### Refresh only what changed

After the first full build, never rebuild everything. `scripts/dev-refresh.mjs`
reads which files changed since the last refresh and rebuilds only those parts:

```powershell
node scripts/dev-refresh.mjs --out <dev folder>            # auto: picks web, shell or both
node scripts/dev-refresh.mjs --out <dev folder> --dry-run  # shows what it would build
node scripts/dev-refresh.mjs --out <dev folder> --web      # force one part (or --shell)
```

- A web-only change is a Next rebuild that reuses its cache
  (`apps/web/.next-desktop`) and a copy into `<out>\web`: no cargo.
- A shell change is an incremental release cargo build of the shell only,
  always with `--config tauri.dev.json`. Close Dev first: the exe is locked
  while it runs.
- It stamps `<out>\.dev-refresh.json` with the commit, reloads Dev over CDP
  when the web part ran, and refuses the installed app's folder.

### Desktop end-to-end suite

`apps/web/e2e-desktop` is a Playwright suite that attaches to the running
WeaveForge Dev over CDP (port 9223) and drives the real app with its real
folder. It never launches a browser or the installed app.

```powershell
cd apps\web; npm run test:e2e:desktop
```

- The suite is the tester: `sweep.spec.ts` walks every route, explorer item
  kind, theme, window size and safe control, and reports what is wrong
  (console and page errors, error text, stray scrollbars in thin strips, page
  overflow, broken images, long tasks). Report in
  `test-results/desktop-sweep.json`. It never presses a control whose name
  writes, sends, syncs or closes (`DENY` in the spec). Knobs:
  `WF_SWEEP_ROUTES`, `WF_SWEEP_PER_KIND`, `WF_SWEEP_MAX_CLICKS`,
  `WF_SWEEP_LONG_MS`, `WF_SWEEP_CLICKS=0`.
- When the person finds a bug the sweep missed, first teach the sweep the
  class of bug (a new check in `sweep-checks.ts`), not only that one case.
- Flow specs: `startup` (projects load; shell-call budget), `notes`, `ink`,
  `projects`. `dev-app.ts` holds the fixtures and `countShellCalls`.
- Budgets for one start: `WF_E2E_READ_BUDGET` (800), `WF_E2E_LIST_BUDGET`
  (150), `WF_E2E_STAT_BUDGET` (300). Before the 0.9.8 read cache one start
  made 3944 reads.
- The web e2e suite (`apps/web/e2e`) never runs the desktop app, so it
  missed the bugs the person hit in it.
- Run it once per batch, after `dev-refresh`, not after each change.

## 4. Drive it over CDP

`http://127.0.0.1:9223/json` lists targets; the one with `type === "page"` is
the window. A small helper (Node 22 has `WebSocket` and `fetch`):

```js
// cdp.mjs
import { writeFileSync } from "node:fs";
const port = process.env.CDP_PORT ?? "9223";
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = list.find((p) => p.type === "page" && !p.url.startsWith("devtools"));
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0;
const pending = new Map();
ws.addEventListener("message", (ev) => {
  const d = JSON.parse(ev.data);
  if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
});
export const send = (method, params = {}) =>
  new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
export const run = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? "eval failed");
  return r.result.result.value;
};
export const shot = async (file, clip) => {
  const r = await send("Page.captureScreenshot", { format: "png", ...(clip && { clip: { scale: 1, ...clip } }) });
  writeFileSync(file, Buffer.from(r.result.data, "base64"));
};
export const close = () => ws.close();
```

A check script imports it and prints what the page reports:

```js
import { run, shot, close } from "./cdp.mjs";
await run(`location.href = "app://weaveforge/reader/?paper=<id>"`);
await run(`new Promise(r => setTimeout(r, 3000))`);
console.log(await run(String.raw`[...document.querySelectorAll(".pdf-reader-ref-link")].map(a => a.textContent)`));
await shot("reader.png");
close();
```

Keep these scripts in the session scratchpad, not the repo.

Two measuring scripts do live in the repo, in `scripts/perf/`:

- `node scripts/perf/memory.mjs` (Dev running, read-only over CDP) prints
  memory per part: JS heap, wasm, DOM, canvases, workers, and the working set
  of every WebView2 process and the shell.
- `node scripts/perf/budget.mjs [--idle]` (Dev running) checks the layer and memory budgets in `ui-layers.md` and exits 1 when one is broken.

Conventions:

- Wrap `run()` bodies in `String.raw` so regexes and backslashes survive.
- Navigate with `location.href = "app://weaveforge/<route>/?..."`; the app is
  a static export, so routes end in `/`.
- Widths: `Emulation.setDeviceMetricsOverride` (`width`, `height`,
  `deviceScaleFactor: 1`, `mobile: false`), then
  `Emulation.clearDeviceMetricsOverride` when done.
- Layout claims come with numbers from `getBoundingClientRect()` and
  `getComputedStyle()`, not just a screenshot.
- Offline, the reader shows a "Load PDF…" button: click it, then wait for
  `.pdf-reader-page`.
- Drags (pen strokes, region select) use `Input.dispatchMouseEvent`
  (`mousePressed`, `mouseMoved` with `buttons: 1`, `mouseReleased`) in CSS
  pixels. Synthetic `PointerEvent`s cannot `setPointerCapture`.
- Keyboard: `Input.dispatchKeyEvent`, `modifiers: 2` for Ctrl.
- Screenshots come back at the window's DPR unless emulation sets it.
- React state the DOM does not show: walk `__reactFiber$*` up to the
  component's `memoizedProps`.
- Console noise to ignore: two `Uncaught (in promise)` from the collab
  provider's `destroy()` when leaving Edit mode offline.

## 5. Report

Paste what the scripts printed (counts, rects, link texts, before/after) and
attach the screenshot. Say which checks ran and which were skipped.

# Testing, for agents

Every change is proven before it is reported: a test that fails without it, or
numbers and a screenshot from the running app. A claim without evidence is a
guess.

## 1. Unit tests and typecheck

From the repo root (Git Bash or PowerShell):

| Area | Test | Typecheck |
| --- | --- | --- |
| `packages/core` | `npm run test:core` | `npm run typecheck --workspace @weaveforge/core` |
| `apps/web` | `npm run test:web` | `npm run typecheck --workspace @weaveforge/web` |
| everything | — | `npm run typecheck` |

One file or one test, faster:

```bash
node --import tsx --test apps/shell/sidecar/test/home-config.test.ts
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
desktop shell (local DB, file system, app:// routes) is checked in the
desktop app below.

## 3. Desktop: the WeaveForge Dev build

The person's installed **WeaveForge** holds their real workspace. Never kill,
reinstall or drive it. Test in a side-by-side **WeaveForge Dev** build that has
its own app id, user-data folder and workspace pointer.

### What keeps Dev apart

- Its own app id, user-data folder and local DB (see the build below).
- Open a new or demo project in Dev. Never point it at the person's
  workspace: two apps on one local DB hit EPERM and the reset path can move
  the DB aside.
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
node apps/shell/sidecar/scripts/stage.mjs <out> --node (Get-Command node).Source
node apps/shell/scripts/stage-postgres.mjs <extracted postgres dist> <out>
cd apps\shell; npm run tauri -- build --no-bundle --config tauri.dev.json
```

`stage.mjs` copies the `LICENSE` beside `node.exe`. If that install has none,
pass `--node-license <Node's LICENSE>`, never the repo's own `LICENSE`.

`stage-postgres.mjs` takes the extracted
`postgresql-18.6.1-x86_64-pc-windows-msvc` release of
theseus-rs/postgresql-binaries (the one CI pins) and writes `<out>\postgres`,
where the native local database looks for it.

Copy `target\release\weaveforge-shell.exe` into `<out>`, and
`apps\shell\dist\web` to `<out>\web`. Run the exe from `<out>` unbundled, so
it registers no URL scheme. For CDP set
`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223`; the page
origin is `https://app.localhost`.

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
- Local DB from the page: `window.weaveforge.queryLocalDb(sql, params)`.
- React state the DOM does not show: walk `__reactFiber$*` up to the
  component's `memoizedProps`.
- Console noise to ignore: two `Uncaught (in promise)` from the collab
  provider's `destroy()` when leaving Edit mode offline.

## 5. Report

Paste what the scripts printed (counts, rects, link texts, before/after) and
attach the screenshot. Say which checks ran and which were skipped.

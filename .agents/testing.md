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
| `apps/desktop` | `npm run test:desktop` | `npm run typecheck --workspace @weaveforge/desktop` |
| everything | — | `npm run typecheck` |

One file or one test, faster:

```bash
cd apps/desktop && node --import tsx --test test/home-config.test.ts
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
Electron shell (local DB, file system, app:// routes) is checked in the
desktop app below.

## 3. Desktop: the WeaveForge Dev build

The person's installed **WeaveForge** holds their real workspace. Never kill,
reinstall or drive it. Test in a side-by-side **WeaveForge Dev** build that has
its own app id, user-data folder and workspace pointer.

### Build (~5 min; run in the background and poll the log)

From `apps/desktop`. Both build scripts are required: `build.mjs` wipes
`dist/`, so without `build-web.mjs` after it the app falls back to
`http://localhost:3000`.

```bash
node scripts/build.mjs && node scripts/build-web.mjs && ls dist/web && npx electron-builder --win --arm64 --dir --publish never -c.appId=dev.weaveforge.desktop.dev -c.productName="WeaveForge Dev" -c.extraMetadata.name=weaveforge-dev -c.extraMetadata.productName="WeaveForge Dev"
```

Prove the bundle carries the change before installing:

```bash
grep -rl "<unique string from the change>" dist/web/_next/static/chunks
```

`git status` afterwards: `build-web.mjs` must not have deleted route files.

### Install, launch, stop (PowerShell)

```powershell
Get-Process | ? { $_.Path -like "$env:LOCALAPPDATA\Programs\WeaveForge Dev\*" } | Stop-Process -Force
Copy-Item -Recurse -Force "apps\desktop\release\win-arm64-unpacked\*" "$env:LOCALAPPDATA\Programs\WeaveForge Dev"
& "$env:LOCALAPPDATA\Programs\WeaveForge Dev\WeaveForge Dev.exe" --remote-debugging-port=9223
```

Stop it only by path, as in the first line. Never `taskkill /IM WeaveForge.exe`.

### What keeps Dev apart

- User data: `%APPDATA%\WeaveForge Dev\` (its own `preferences.json` and local DB).
- Workspace pointer: `~/.weaveforge/desktop-dev.json`, not `desktop.json`
  (`home-config.ts`, chosen in `main.ts` when `app.getName()` is
  `WeaveForge Dev`).
- Debug port 9223; the main app uses 9222 when launched for testing.
- Open a new or demo project in Dev. Never point it at the person's
  workspace: two apps on one local DB hit EPERM and the reset path can move
  the DB aside.
- Sign-in loopback port 53682 is shared, so Dev logs `EADDRINUSE` while the
  main app runs. Harmless for local-only checks.

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

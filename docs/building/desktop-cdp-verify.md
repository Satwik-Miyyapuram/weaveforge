# Verifying the desktop app over CDP

How a change is checked in the *installed* Electron build rather than a dev
server: build, install, launch with the DevTools protocol open, then drive the
renderer from a Node script. No device or hand-testing needed.

## 1. Build and install

From `apps/desktop` (Git Bash; ~5 min, so run it in the background and poll
the log — a foreground `sleep` is not allowed in the agent shell):

```bash
(node scripts/build.mjs && node scripts/build-web.mjs && npx electron-builder --win nsis --arm64; echo "exit=$?") > .scratch/build.out 2>&1 &
```

Before installing, prove the bundle carries the change:

```bash
grep -rl "<some unique string from the change>" apps/desktop/dist/web/_next/static/chunks
```

Then quit the running app and install silently:

```bash
taskkill //F //IM WeaveForge.exe
powershell -NoProfile -Command "Start-Process 'release\WeaveForge Setup 0.6.0.exe' -ArgumentList '/S' -Wait"
```

`git status` after a build: `build-web.mjs` must not have deleted route files.

## 2. Launch with the debug port

```bash
"$LOCALAPPDATA/Programs/WeaveForge/WeaveForge.exe" --remote-debugging-port=9222 &
```

`http://127.0.0.1:9222/json` then lists the renderer targets; the one with
`type === "page"` is the app window.

## 3. Drive it from Node

A ~15-line helper is enough (Node 22 has `WebSocket` and `fetch` built in):

```js
// cdp.mjs
import { writeFileSync } from "node:fs";
const list = await (await fetch("http://127.0.0.1:9222/json")).json();
const page = list.find((p) => p.type === "page");
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
export const shot = async (file) => {
  const r = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(file, Buffer.from(r.result.data, "base64"));
};
export const close = () => ws.close();
```

A check script imports it and asserts on what the page reports:

```js
import { run, shot, close } from "./cdp.mjs";
await run(`location.href = "app://weaveforge/reader/?paper=<id>&pen=1"`);
await run(`new Promise(r => setTimeout(r, 3000))`);
console.log(await run(String.raw`[...document.querySelectorAll(".pdf-reader-ref-link")].map(a => a.textContent)`));
await shot("reader.png");
close();
```

Conventions that save time:

- Wrap `run()` bodies in `String.raw` so regexes and backslashes survive.
- Navigate with `location.href = "app://weaveforge/<route>/?..."`; the app is
  a static export, so routes end in `/`.
- Offline, the reader shows a "Load PDF…" button — click it first
  (`document.querySelector('button')` by text), then wait for `.pdf-reader-page`.
- Drags (pen strokes, region select) go through
  `Input.dispatchMouseEvent` — `mousePressed`, `mouseMoved` with `buttons: 1`,
  `mouseReleased` — in CSS pixels. Synthetic `PointerEvent`s cannot
  `setPointerCapture`, so they do not work.
- Keyboard: `Input.dispatchKeyEvent` with `modifiers: 2` for Ctrl.
- Screenshots come back at the window's DPR (1.25× here: 1426×838 inner).
- Local DB from the page: `window.weaveforge.queryLocalDb(sql, params)`.
- React state when the DOM does not say enough: walk `__reactFiber$*` up
  from a node to the component's `memoizedProps`.
- Console noise to ignore: two `Uncaught (in promise)` from the collab
  provider's `destroy()` when leaving Edit mode offline.

## 4. Report with evidence

Paste the numbers the script printed (link texts found, annotation counts
before and after undo, …) and the screenshot. A claim without them is a
guess; the build is there so that it need not be.

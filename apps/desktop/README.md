# WeaveForge Desktop

An Electron window around the WeaveForge web app. It is not a second client:
the window loads the same Next.js app a browser loads, and this package adds
only the things a browser genuinely cannot do.

Three files, about two hundred lines between them:

| File | What it is |
| --- | --- |
| `src/main.ts` | The window, the navigation rules, and the IPC handlers. |
| `src/preload.ts` | The one object the page can see, typed as the web app's `DesktopBridge`. |
| `src/channels.ts` | The channel names and payload shapes, so both sides agree. |

## Running it

```sh
npm run dev --workspace @weaveforge/web     # the app, on :3000
npm start --workspace @weaveforge/desktop   # a window pointed at it
```

`WEAVEFORGE_URL` chooses what the window loads; it defaults to
`http://localhost:3000`. Point it at your deployment to run against production:

```sh
WEAVEFORGE_URL=https://weaveforge.example npm start --workspace @weaveforge/desktop
```

`npm run package --workspace @weaveforge/desktop` produces an installer through
electron-builder, which is a devDependency you will need to add when you first
want one — nothing in the day-to-day loop requires it.

## Why a URL and not a bundled copy of the site

WeaveForge's data lives behind an API. A window with the site bundled inside it
would still need that server for every screen it draws, so bundling buys no
offline capability — it only adds a second artefact to build, sign and keep in
step with the server it talks to. Loading the deployment means the desktop app
is never a version behind, and a fix ships to it the moment it ships at all.

## How a capability gets added without writing it twice

This is the part worth copying. Every desktop-only ability follows the same
three steps, and the app never branches on "are we in Electron" outside them:

1. **Declare it** in `apps/web/src/lib/desktop-bridge.ts`. That interface is the
   whole contract. `src/preload.ts` is typed against it, so adding a method
   there breaks this package's build until it is implemented — the two cannot
   drift.
2. **Give it a browser answer too.** `apps/web/src/lib/outbound-fetch.ts` is the
   pattern: one interface, a `viaServer` implementation and a `viaDesktop` one,
   and `outboundFetch()` picks. Callers never learn which they got, so no
   feature is desktop-only and no screen grows a second code path.
3. **Implement the desktop half by importing the web app's module.** The two
   handlers in `src/main.ts` call `fetchPageTitle` and `fetchRemoteImage` from
   `apps/web/src/backend/net/fetch-for-paste` — the same functions the API route
   calls. The build resolves `@/…` to `apps/web/src`, so this is a real import,
   not a copy.

What that buys today: pasting a link reads its title, and pasting an image
address downloads the picture, without a server round trip and without CORS in
the way. Same address guard, same size caps, same refusals as the browser build
— because it is the same code.

## Testing

```sh
npm test --workspace @weaveforge/desktop            # the handlers, no Electron needed
npm run smoke --workspace @weaveforge/desktop       # the real app, needs a display
```

The unit tests cover the shaping the handlers do — a refusal crossing as data, a
non-string argument turned away before anything leaves the machine, the bytes
handed over being the picture's and not the pool's. What may be fetched at all
is `fetch-for-paste`'s decision and is tested with the web app.

The smoke run starts the actual app against a local page and asks it what it can
see: whether the preload attached, exactly which members the bridge exposes,
whether anything from the preload's world leaked into the page's, and whether
loopback and cloud-metadata addresses are refused in a real Electron process. It
needs a display — `xvfb-run -a npm run smoke --workspace @weaveforge/desktop`
works headlessly — so it is not part of `check:all`; run it after touching
`main.ts` or `preload.ts`.

The paste behaviour on the other side of the bridge is covered in
`apps/web/e2e/editor-paste.spec.ts`, which drives the editor through a stand-in
bridge of this exact shape.

## Security notes

- The renderer runs with `contextIsolation: true`, `nodeIntegration: false` and
  `sandbox: true`. It gets three functions and nothing else.
- Sign-in comes back over a loopback listener on `127.0.0.1:53682`, bound to the
  loopback interface explicitly and answering on one path. What arrives is
  untrusted — anything on the machine can reach that port — so only its shape is
  checked and the authorization code inside is never read here. The code is
  worthless without the PKCE verifier, which is generated in the renderer and
  never leaves it, so a forged callback costs one failed exchange.
- The redirect is loopback rather than a `weaveforge://` link because that is
  what RFC 8252 asks a desktop app to use, and because the custom-scheme version
  did not work in practice: browsers refuse to launch another program when no
  click is behind the navigation, and refuse silently.
- Failures cross as data rather than as thrown errors: an exception raised
  inside `ipcMain.handle` reaches the renderer with Electron's own prefix
  stapled to the message, and that message is shown to a person.
- Navigation away from the app's origin is refused and handed to the real
  browser, both for in-window links and for `window.open`. Otherwise a page
  could navigate the shell itself somewhere else, and that somewhere else would
  inherit the preload.
- `shell.openExternal` is only ever called on a URL that passes `checkUrlShape`,
  so a `file:` path or a registered protocol handler cannot be smuggled through
  it. The page cannot ask for it directly: opening a link is something the
  window decides when a navigation leaves the origin, not a channel the
  renderer can call.
- The fetch handlers are unauthenticated, unlike `/api/fetch-url` — they do not
  need a session because they are already inside it, running as the person at
  the keyboard. The address guard is what stops them being useful for anything
  else, and it is the same guard.

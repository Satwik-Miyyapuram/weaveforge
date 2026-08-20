import http from "node:http";
import { AUTH_LOOPBACK_PORT, signInCallbackQuery } from "./handlers";

/**
 * Where a provider sign-in comes back to.
 *
 * The window cannot host the sign-in itself: off-origin navigations are handed
 * to the reader's real browser, and providers refuse an embedded window in any
 * case. So the flow finishes in the browser, and this is how it gets back.
 *
 * It is a loopback listener rather than a `weaveforge://` link because that is
 * what RFC 8252 asks a desktop app to use, and because the custom-scheme
 * version does not actually work: launching another program out of a web page
 * needs the browser's permission, browsers refuse it silently when nothing was
 * clicked, and the version with a button asked the reader to finish a sign-in
 * by hand. An `http://127.0.0.1` address is an ordinary web address — the
 * browser simply follows the redirect, and the app has the answer before the
 * reader has read the page.
 *
 * The listener is bound to `127.0.0.1` explicitly, not to every interface: on
 * `0.0.0.0` this port would be an open door on whatever network the machine is
 * attached to.
 */
export function startAuthLoopback(onSignIn: (query: string) => void): http.Server {
  const server = http.createServer((request, response) => {
    const query = signInCallbackQuery(request.url);
    if (!query) {
      response.writeHead(404, { "content-type": "text/plain" });
      response.end("Not found");
      return;
    }
    // Answer first, hand over second. The reader is looking at this tab, and
    // the app taking focus while the page is still loading reads as a hang.
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      // Nothing here is worth keeping, and this URL carries a code in it.
      "cache-control": "no-store",
    });
    response.end(DONE_PAGE);
    onSignIn(query);
  });

  server.on("error", (error) => {
    // A busy port is the one failure worth surviving: it means a second copy of
    // the app, or something else on 53682. Sign-in will not complete, but the
    // window is still a working app, so this is reported and not fatal.
    console.error("[weaveforge] sign-in listener could not start:", error);
  });

  server.listen(AUTH_LOOPBACK_PORT, "127.0.0.1");
  return server;
}

/**
 * What the browser tab is left showing.
 *
 * Deliberately one self-contained file with no request of its own: this is
 * served from a bare Node listener with no assets behind it, and a tab that
 * spends its last second fetching a stylesheet that will never arrive looks
 * broken at exactly the wrong moment.
 */
const DONE_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Signed in — WeaveForge</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center;
    font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
    background: #101014; color: #e9e9ee;
  }
  main { text-align: center; padding: 24px; }
  h1 { font-size: 1.35rem; margin: 0 0 8px; }
  p { margin: 0; opacity: 0.7; }
</style>
</head>
<body>
  <main>
    <h1>You're signed in.</h1>
    <p>WeaveForge has the rest. You can close this tab.</p>
  </main>
</body>
</html>`;

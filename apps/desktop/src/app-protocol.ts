import path from "node:path";

/**
 * Serving the bundled app to the window.
 *
 * The desktop build carries the site as static files (`scripts/build-web.mjs`,
 * plan D8), and the obvious way to show them — `file://` — is the wrong one. A
 * `file://` document has an opaque origin, so IndexedDB and `localStorage`
 * throw, `fetch` of a sibling file is cross-origin, and service workers are
 * refused outright. The local database (D9) needs all three. A custom scheme
 * declared `standard` and `secure` is a real origin with none of those holes,
 * so the same page behaves the way it does on a server.
 *
 * This module is the part worth testing: turning a request path into a file
 * inside the bundle, and refusing everything that is not one.
 */

/** The origin the window runs at. A host is required for a standard scheme. */
export const APP_SCHEME = "app";
export const APP_HOST = "weaveforge";
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;

/**
 * The file a request path asks for, or null if it asks for nothing we have.
 *
 * `isFile` is passed in rather than read from `fs` so the rules can be tested
 * against a made-up bundle. It must answer for files only: `/reader` names the
 * `reader/` folder before it names `reader/index.html`, and a folder handed to
 * the fetch that serves the answer throws instead of 404ing. The candidates
 * follow the export's own shape: it is built with `trailingSlash`, so a
 * directory holds an `index.html`, and older links without the slash should
 * still land rather than 404.
 */
export function resolveAppFile(
  root: string,
  requestUrl: string,
  isFile: (file: string) => boolean,
): string | null {
  let pathname: string;
  try {
    ({ pathname } = new URL(requestUrl));
  } catch {
    return null;
  }

  let relative: string;
  try {
    relative = decodeURIComponent(pathname);
  } catch {
    // A malformed escape is not a path we have; treat it as a miss rather than
    // letting the decoder throw out of the protocol handler.
    return null;
  }

  // `path.join` normalises `..` away, but only once the traversal is already
  // inside the string — so the check is on the result, not on the input, and it
  // is a containment check rather than a search for a pattern.
  const joined = path.join(root, relative);
  const contained = joined === root || joined.startsWith(root + path.sep);
  if (!contained) return null;

  const candidates = relative.endsWith("/")
    ? [path.join(joined, "index.html")]
    : [joined, `${joined}.html`, path.join(joined, "index.html")];

  return candidates.find((file) => isFile(file)) ?? null;
}

/**
 * Whether a missed request was for a page rather than an asset.
 *
 * A page the offline build does not carry (`/org`, `/supervision`: other
 * people's accounts, which need the server) used to answer an empty 404, and
 * the window showed a blank screen with no way back. A page miss is answered
 * with the bundle's own not-found page instead, which has navigation; an asset
 * miss stays a bare 404 so a missing chunk still fails loudly.
 */
export function isPageRequest(requestUrl: string): boolean {
  let pathname: string;
  try {
    ({ pathname } = new URL(requestUrl));
  } catch {
    return false;
  }
  const last = pathname.split("/").filter(Boolean).at(-1) ?? "";
  return !last.includes(".") || last.endsWith(".html");
}

/**
 * The headers the bundle is served with.
 *
 * On the web these come from `next.config.mjs`, which an export cannot carry —
 * a static file has no server to add them. They are the same set, minus the
 * ones that only mean something over HTTP, because the window is still a
 * browser running our HTML and the reasons for them did not go away.
 */
export function appHeaders(contentType: string): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": contentType,
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
  };
  if (contentType.startsWith("text/html")) headers["content-security-policy"] = APP_CSP;
  return headers;
}

/**
 * The web build's policy, plus what only the desktop reaches: the weights host,
 * the Cache API, local model servers on loopback, and workers built from blobs.
 *
 * Two entries here exist because of the same mistake made twice, and both cost a
 * long detour to find — so they are written down together.
 *
 * **`app:`** — `'self'` is `app://weaveforge`, and the encoder's weights are
 * served from `app://models`, which is a *different origin*. Without this the
 * page cannot fetch a single model file, and the failure surfaces as
 * transformers.js's `Bad gateway error occurred while trying to load file:
 * "app://models/…/config.json"` — a message that names this app's own proxy and
 * so points at the handler rather than at the policy. `apps/web/next.config.mjs`
 * carries `app://models` for the same reason and is the place to look for how the
 * web half words it; the browser build never reaches this host, which is why the
 * scheme only appears in this file.
 *
 * **`cache:`** — Electron's Cache API, which Transformers.js uses to store model
 * files. A Cache API lookup is subject to `connect-src`, and a refused one
 * *rejects* rather than returning a miss, so the library received a rejection
 * where it expected a `Response`.
 *
 * Both are schemes rather than wildcards: `app:` still confines this to the app's
 * own protocol, and `cache:` is the whole of what the Cache API needs.
 */
const APP_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' app: cache: https: wss: http://localhost:* http://127.0.0.1:*",
  "worker-src 'self' blob:",
  "media-src 'self' blob: https:",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

/** The content type for a file, by extension. Unknown means bytes. */
export function contentTypeFor(file: string): string {
  return TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
  ".map": "application/json; charset=utf-8",
};

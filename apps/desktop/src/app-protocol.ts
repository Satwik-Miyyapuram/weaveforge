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
 * `exists` is passed in rather than read from `fs` so the rules can be tested
 * against a made-up bundle. The candidates follow the export's own shape: it is
 * built with `trailingSlash`, so a directory holds an `index.html`, and older
 * links without the slash should still land rather than 404.
 */
export function resolveAppFile(
  root: string,
  requestUrl: string,
  exists: (file: string) => boolean,
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

  return candidates.find((file) => exists(file)) ?? null;
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
  return {
    "content-type": contentType,
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
  };
}

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

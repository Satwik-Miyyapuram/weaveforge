import path from "node:path";
import { rust } from "@weaveforge/core";

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
 * The protocol rules (candidate files, canonical URLs, page-or-asset, content
 * types, headers and the CSP) are Rust `app_protocol`, reached through `rust()`.
 * This file keeps the disk check. The CSP and why each entry is there are in
 * docs/building/core/app-protocol.md.
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
 * the fetch that serves the answer throws instead of 404ing. Rust gives the
 * candidates in try order; `root` must have no trailing separator.
 */
export function resolveAppFile(
  root: string,
  requestUrl: string,
  isFile: (file: string) => boolean,
): string | null {
  const candidates = rust().appFileCandidates(root, requestUrl, path.sep) as string[] | null;
  return candidates?.find((file) => isFile(file)) ?? null;
}

/**
 * The same URL with repeated slashes in its path collapsed, or `null` when the
 * path is already clean (E01). The redirect keeps a malformed deep link working.
 */
export function canonicalAppUrl(requestUrl: string): string | null {
  return rust().appCanonicalUrl(requestUrl) as string | null;
}

/**
 * Whether a missed request was for a page rather than an asset. A page miss is
 * answered with the bundle's own not-found page; an asset miss stays a bare 404.
 */
export function isPageRequest(requestUrl: string): boolean {
  return rust().appIsPageRequest(requestUrl);
}

/** The headers the bundle is served with. The CSP is added only to HTML. */
export function appHeaders(contentType: string): Record<string, string> {
  return rust().appHeaders(contentType) as Record<string, string>;
}

/** The content type for a file, by extension. Unknown means bytes. */
export function contentTypeFor(file: string): string {
  return rust().appContentTypeFor(file);
}

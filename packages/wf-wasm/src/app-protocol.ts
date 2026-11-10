/**
 * `app://` protocol rules (Rust `app_protocol`): candidate files inside the
 * bundle, canonical URLs, page-or-asset classification, content types and
 * response headers. Asking the disk and the protocol handler stay in
 * `apps/shell/sidecar/src/app-protocol.ts`.
 */
import {
  appCanonicalUrl as rawAppCanonicalUrl,
  appContentTypeFor as rawAppContentTypeFor,
  appFileCandidates as rawAppFileCandidates,
  appHeaders as rawAppHeaders,
  appIsPageRequest as rawAppIsPageRequest,
} from "../pkg/wf_wasm.js";

/**
 * Files a request may be served from, in try order, or `null` when the request
 * is not a path inside `root`. `root` must have no trailing separator.
 */
export function appFileCandidates(root: string, requestUrl: string, sep: string): string[] | null {
  return rawAppFileCandidates(root, requestUrl, sep) as string[] | null;
}

/** The URL with repeated path slashes collapsed, or `null` when no redirect is needed. */
export function appCanonicalUrl(requestUrl: string): string | null {
  return rawAppCanonicalUrl(requestUrl) as string | null;
}

/** Whether a missed request was for a page rather than an asset. */
export function appIsPageRequest(requestUrl: string): boolean {
  return rawAppIsPageRequest(requestUrl);
}

/** The headers a response carries. The policy is added only to HTML. */
export function appHeaders(contentType: string): Record<string, string> {
  return rawAppHeaders(contentType) as Record<string, string>;
}

/** The content type for a file, by extension. Unknown means `application/octet-stream`. */
export function appContentTypeFor(file: string): string {
  return rawAppContentTypeFor(file);
}

/**
 * Private-host and public-https checks (Rust `net::private_host`), re-exported from index.ts.
 * Each function keeps the signature of apps/desktop/src/proxy-shared.ts.
 */
import {
  isPrivateHost as rawIsPrivateHost,
  isPublicHttpsUrl as rawIsPublicHttpsUrl,
} from "../pkg/wf_wasm.js";

/** True when a host is this machine or its private network (literal addresses and `localhost`). */
export function isPrivateHost(hostname: string): boolean {
  return rawIsPrivateHost(hostname);
}

/** An https address without credentials on a public host. False for text that does not parse. */
export function isPublicHttpsUrl(raw: string): boolean {
  return rawIsPublicHttpsUrl(raw);
}

import type { UrlRejection } from "@weaveforge/core";

/**
 * What to say to the person who pasted the URL.
 *
 * Presentation, and it used to live in `packages/core`'s URL policy — a module
 * whose whole design is that it holds no I/O and no prose, so the same rules
 * apply on the server, in the Electron main process and in a test. The reason
 * codes are the domain contract; the sentences are ours, and a copy tweak should
 * not re-ship the domain package.
 *
 * A `Record` rather than a `switch`: a new `UrlRejection` becomes a compile
 * error here, where the `switch` version would have returned `undefined` for it.
 */
const REJECTION_COPY: Record<UrlRejection, string> = {
  "not-a-url": "That is not a web address.",
  scheme: "Only http and https addresses can be fetched.",
  credentials: "Addresses carrying a username or password are not fetched.",
  port: "That port is not one WeaveForge will fetch from.",
  "private-address": "That address is on a private network, so it is not fetched.",
  hostname: "That host is not reachable from the public internet.",
};

export function describeRejection(reason: UrlRejection): string {
  return REJECTION_COPY[reason];
}

/** Everything this module can explain, for the test that checks it explains all of it. */
export function describedRejections(): readonly UrlRejection[] {
  return Object.keys(REJECTION_COPY) as UrlRejection[];
}

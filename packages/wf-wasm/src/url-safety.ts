/**
 * Outbound URL and address checks (Rust `url_safety`), re-exported from index.ts.
 * Each function keeps the signature of UrlSafetyFns in packages/core/src/shared/core-contract.ts.
 * URL parsing stays here (WHATWG `URL`); only the pure checks run in Rust.
 */
import {
  checkUrlShape as rawCheckUrlShape,
  expandIpv6 as rawExpandIpv6,
} from "../pkg/wf_wasm.js";
import type {
  UrlCheck,
} from "./bindings.js";

export {
  describeUrlRejection,
  fetchLimits,
  isIpAddress,
  isPublicAddress,
  looksLikeImageUrl,
} from "../pkg/wf_wasm.js";

/**
 * Parses a URL, accepting a scheme-less host the way a person would type it.
 */
export function parseUserUrl(input: string): URL | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
}

/** Decides from the URL alone whether it may be fetched. */
export function checkUrlShape(input: string | URL): UrlCheck {
  const url = typeof input === "string" ? parseUserUrl(input) : input;
  if (!url) return { ok: false, reason: "not-a-url" };
  return rawCheckUrlShape(
    url.protocol,
    Boolean(url.username || url.password),
    url.port,
    url.hostname,
  ) as UrlCheck;
}

/** Expands an IPv6 address to its eight groups, or null when it is not one. */
export function expandIpv6(value: string): number[] | null {
  return (rawExpandIpv6(value) as number[] | undefined) ?? null;
}

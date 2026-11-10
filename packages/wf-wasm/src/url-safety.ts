/**
 * Outbound URL and address checks (Rust `url_safety`), re-exported from index.ts.
 * Each function keeps the signature of UrlSafetyFns in packages/core/src/shared/core-contract.ts.
 * URL parsing stays here (WHATWG `URL`); only the pure checks run in Rust.
 */
import {
  checkUrlShape as rawCheckUrlShape,
  describeUrlRejection as rawDescribeUrlRejection,
  expandIpv6 as rawExpandIpv6,
  fetchLimits as rawFetchLimits,
  isIpAddress as rawIsIpAddress,
  isPublicAddress as rawIsPublicAddress,
  looksLikeImageUrl as rawLooksLikeImageUrl,
} from "../pkg/wf_wasm.js";
import type { OutboundFetchLimits, UrlCheck, UrlRejection } from "./bindings.js";

/** The caps on an outbound fetch (Rust `DEFAULT_FETCH_LIMITS`), read at call time. */
export function fetchLimits(): OutboundFetchLimits {
  return rawFetchLimits() as OutboundFetchLimits;
}

/** The person-facing sentence for a refused URL (Rust `rejection_copy`). */
export function describeUrlRejection(reason: UrlRejection): string {
  return rawDescribeUrlRejection(reason);
}

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

export function isIpAddress(value: string): boolean {
  return rawIsIpAddress(value);
}

/** True when an address is one the internet can route to somebody else. */
export function isPublicAddress(address: string): boolean {
  return rawIsPublicAddress(address);
}

/** True when the URL's own path names a picture (Rust `looks_like_image_url`). */
export function looksLikeImageUrl(url: string): boolean {
  return rawLooksLikeImageUrl(url);
}

/** Expands an IPv6 address to its eight groups, or null when it is not one. */
export function expandIpv6(value: string): number[] | null {
  return (rawExpandIpv6(value) as number[] | undefined) ?? null;
}

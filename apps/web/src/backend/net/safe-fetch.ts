import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { Readable } from "node:stream";
import {
  checkUrlShape,
  isPublicAddress,
  DEFAULT_FETCH_LIMITS,
  type OutboundFetchLimits,
} from "@weaveforge/core";
import { describeRejection } from "./rejection-copy";

/**
 * Fetching a URL a visitor chose, from the server, without becoming a way into
 * the network.
 *
 * The policy lives in `@weaveforge/core` and holds no I/O, so the same rules
 * apply here, in the Electron main process, and in a test. This file is the
 * part that has to touch the network: resolve the name, check every address it
 * resolved to, **dial the address that was checked**, and do all of it again for
 * every redirect — because a redirect is a second URL the visitor did not show
 * you, and following one blind undoes the check on the first.
 *
 * Dialling the checked address is the part that was missing. Checking a name and
 * then handing the *name* to `fetch` leaves a second DNS answer between the two
 * (DNS rebinding: a public address when the guard looks, `169.254.169.254` when
 * the socket connects). `pinnedRequest` below connects to the vetted IP while
 * presenting the original hostname for SNI, for the `Host` header and for
 * certificate verification, so the name is used for naming and the address for
 * dialling — and there is no second resolution to subvert.
 */

export type SafeFetchFailure =
  | { ok: false; kind: "refused"; status: 400; message: string }
  | { ok: false; kind: "unreachable"; status: 502 | 504; message: string }
  | { ok: false; kind: "upstream"; status: number; message: string }
  | { ok: false; kind: "too-large"; status: 413; message: string };

interface SafeFetchSuccess {
  ok: true;
  /** Where the redirects actually ended up. */
  url: string;
  status: number;
  contentType: string;
  body: Uint8Array;
}

export type SafeFetchResult = SafeFetchSuccess | SafeFetchFailure;

/** One request, aimed at an address that has already been vetted. */
export interface PinnedRequestInput {
  url: URL;
  /** The address the guard approved. This is what gets dialled. */
  address: string;
  family: 4 | 6;
  headers: Record<string, string>;
  timeoutMs: number;
  /**
   * Defaults to `GET`.
   *
   * Present because one caller files a GitHub issue, which is a `POST` carrying a
   * token. The alternative was sending that through plain `fetch`, off the pinned
   * path — the exception this module exists to avoid.
   */
  method?: string;
  /** The body, for the methods that carry one. `content-length` is derived from it. */
  body?: string;
}

export interface SafeFetchOptions extends Partial<OutboundFetchLimits> {
  /** Sent as Accept. Defaults to anything. */
  accept?: string;
  /**
   * How a hostname becomes addresses. Injected rather than reached for, so the
   * guard is testable without a network and so the Electron main process can
   * supply its own resolver.
   */
  resolve?: (hostname: string) => Promise<string[]>;
  /**
   * How the vetted address is dialled. Injected for the same reason as
   * `resolve`, and because it is the seam that makes the pinning testable: a
   * test supplies this and asserts the address it was handed.
   */
  request?: (input: PinnedRequestInput) => Promise<Response>;
  /**
   * A real browser's, because a great many publishers answer a bot-like agent
   * with a 403 and the person who pasted the link cannot tell why.
   */
  userAgent?: string;
}

const BROWSER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/** Every address the name resolves to, so one bad answer is enough to refuse. */
async function resolveHost(hostname: string): Promise<string[]> {
  const host = hostname.replace(/^\[|\]$/g, "");
  const results = await lookup(host, { all: true, verbatim: true });
  return results.map((entry) => entry.address);
}

/** Whether an address is v4, for the socket's `family`. */
function familyOf(address: string): 4 | 6 {
  return address.includes(":") ? 6 : 4;
}

/**
 * The transport every outbound fetch uses, and the way a test replaces it.
 *
 * A module-level value rather than a parameter everywhere, because the callers
 * are two routes and a use case that have no place to thread it — and because
 * replacing it is exactly what a test needs: `globalThis.fetch` used to be the
 * stub point, and it can no longer prove the thing that matters, that the
 * address the guard approved is the address dialled. A test that installs its
 * own transport is handed the pinned address and can assert on it.
 *
 * `pinnedRequest` is the product behaviour; nothing in the app sets this.
 */
let transport: (input: PinnedRequestInput) => Promise<Response> = pinnedRequest;

export function setOutboundTransport(next: (input: PinnedRequestInput) => Promise<Response>): void {
  transport = next;
}

export function resetOutboundTransport(): void {
  transport = pinnedRequest;
}

/**
 * One pinned request, through the seam above.
 *
 * Call this rather than `pinnedRequest` directly. `pinnedRequest` is the
 * *implementation* — what `transport` starts out pointing at — so a caller that
 * reaches for it skips the seam, and a test that stubs the transport silently
 * stops covering that caller. Not theoretical: the issue-filing path called
 * `pinnedRequest` directly, and its test reached the **real** api.github.com and
 * got a `401` for a fake token instead of the stubbed `201` it expected. The same
 * shape of mistake as the three url-meta tests that were passing against live
 * Crossref and arXiv responses.
 */
export function pinnedFetch(input: PinnedRequestInput): Promise<Response> {
  return transport(input);
}

/**
 * Connect to `address`, while telling the server (and the certificate) that we
 * meant `url.hostname`.
 *
 * Three things carry the name, and all three matter:
 *
 *   * `servername` is the TLS SNI value *and* what Node checks the certificate
 *     against, so a valid certificate for the real host is still required and a
 *     certificate for the IP is not enough;
 *   * the `Host` header, so a virtual host answers as itself;
 *   * the path and query, unchanged.
 *
 * `hostname` is an IP literal, so Node does not resolve anything — there is no
 * second DNS answer to subvert. `lookup` is supplied as well, for the case where
 * something downstream re-resolves anyway; it returns the same pinned address.
 */
export async function pinnedRequest(input: PinnedRequestInput): Promise<Response> {
  const { url, address, family, headers, timeoutMs } = input;
  const transport = url.protocol === "https:" ? httpsRequest : httpRequest;
  const method = input.method ?? "GET";
  // `content-length` is set from the bytes actually written rather than trusted
  // from the caller: a mismatch is a request the server waits on, and this is the
  // one place that knows both numbers.
  const bodyHeaders =
    input.body === undefined ? {} : { "content-length": String(Buffer.byteLength(input.body)) };

  return new Promise<Response>((resolve, reject) => {
    const req = transport(
      {
        hostname: address,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method,
        headers: { ...headers, ...bodyHeaders, Host: url.host },
        servername: url.hostname,
        lookup: (_hostname, _options, callback) => callback(null, address, family),
      },
      (res) => {
        const responseHeaders = new Headers();
        for (const [key, value] of Object.entries(res.headers)) {
          if (Array.isArray(value)) for (const one of value) responseHeaders.append(key, one);
          else if (value !== undefined) responseHeaders.set(key, value);
        }
        resolve(
          new Response(Readable.toWeb(res) as ReadableStream, {
            status: res.statusCode ?? 502,
            headers: responseHeaders,
          }),
        );
      },
    );

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error("That site took too long to answer."));
    });
    req.on("error", reject);
    if (input.body !== undefined) req.write(input.body);
    req.end();
  });
}

/**
 * Checks one URL completely: its shape, then every address behind its name.
 *
 * A name with several addresses is refused if *any* of them is private. An
 * attacker controls the DNS answer, so "one of them was public" says nothing
 * about which one a later connection will use.
 *
 * On success it returns the address to dial, so the caller does not resolve
 * again — see `pinnedRequest`.
 */
export async function checkUrlReachable(
  url: URL,
  resolve: (hostname: string) => Promise<string[]> = resolveHost,
): Promise<{ ok: true; address: string; family: 4 | 6 } | SafeFetchFailure> {
  const shape = checkUrlShape(url);
  if (!shape.ok) {
    return { ok: false, kind: "refused", status: 400, message: describeRejection(shape.reason!) };
  }

  let addresses: string[];
  try {
    addresses = await resolve(url.hostname);
  } catch {
    return { ok: false, kind: "unreachable", status: 502, message: "That host could not be resolved." };
  }

  if (addresses.length === 0) {
    return { ok: false, kind: "unreachable", status: 502, message: "That host could not be resolved." };
  }
  if (!addresses.every(isPublicAddress)) {
    return {
      ok: false,
      kind: "refused",
      status: 400,
      message: describeRejection("private-address"),
    };
  }
  const address = addresses[0]!;
  return { ok: true, address, family: familyOf(address) };
}

/**
 * Reads a response body up to `maxBytes`, abandoning it rather than buffering
 * more.
 *
 * One buffer, grown as needed. It used to collect every chunk into an array and
 * then allocate a second buffer of exactly `total` and copy them in, so an image
 * at the 12 MB cap held 24 MB at the moment of the copy — on a route whose whole
 * purpose is bounding what one paste can cost.
 *
 * The declared `content-length` is used only to *refuse* an oversized body
 * early, never to size the buffer: it is the encoded length, and the runtime
 * decompresses `content-encoding` transparently, so it can be smaller than what
 * actually arrives. Growing on demand keeps that from being a correctness
 * dependency.
 */
async function readCapped(response: Response, maxBytes: number): Promise<Uint8Array | null> {
  const declared = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) return null;

  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();

  let body = new Uint8Array(Math.min(64 * 1024, maxBytes));
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    if (total + value.byteLength > maxBytes) {
      // Cancelling matters: without it the connection stays open pulling bytes
      // nobody will read.
      await reader.cancel().catch(() => {});
      return null;
    }
    if (total + value.byteLength > body.byteLength) {
      // Double, capped at the limit, so a large body costs O(log n) copies
      // rather than one copy of everything.
      const grown = new Uint8Array(Math.min(maxBytes, Math.max(body.byteLength * 2, total + value.byteLength)));
      grown.set(body.subarray(0, total));
      body = grown;
    }
    body.set(value, total);
    total += value.byteLength;
  }
  return body.subarray(0, total);
}

/**
 * Fetches a URL on a visitor's behalf, following redirects one at a time and
 * re-checking each one.
 *
 * `redirect: "manual"` is the whole point. `follow` hands the decision to the
 * runtime, which will happily chase a 302 to `http://169.254.169.254/` — and
 * the guard on the first URL then guards nothing.
 */
export async function safeFetch(input: string, options: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const limits = { ...DEFAULT_FETCH_LIMITS, ...options };
  const started = Date.now();

  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(input.trim()) ? input.trim() : `https://${input.trim()}`);
  } catch {
    return { ok: false, kind: "refused", status: 400, message: describeRejection("not-a-url") };
  }

  for (let hop = 0; hop <= limits.maxRedirects; hop++) {
    const remaining = limits.timeoutMs - (Date.now() - started);
    if (remaining <= 0) {
      return { ok: false, kind: "unreachable", status: 504, message: "That site took too long to answer." };
    }

    const reachable = await checkUrlReachable(url, options.resolve);
    if (!reachable.ok) return reachable;

    let response: Response;
    try {
      // Both the resolution and the connection are this file's, and the address
      // checked above is the address dialled. `redirect: "manual"` is not needed
      // here as it is with `fetch`: this is a single request, and a 3xx comes
      // back as a response for the loop to inspect.
      const send = options.request ?? transport;
      response = await send({
        url,
        address: reachable.address,
        family: reachable.family,
        timeoutMs: remaining,
        headers: {
          "User-Agent": options.userAgent ?? BROWSER_AGENT,
          Accept: options.accept ?? "*/*",
          "Accept-Language": "en-US,en;q=0.9",
        },
      });
    } catch {
      return { ok: false, kind: "unreachable", status: 502, message: "That site could not be reached." };
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        return { ok: false, kind: "upstream", status: 502, message: "That site redirected to nowhere." };
      }
      // Cancel the redirect's own body; nothing here will read it.
      await response.body?.cancel().catch(() => {});
      try {
        url = new URL(location, url);
      } catch {
        return { ok: false, kind: "upstream", status: 502, message: "That site redirected somewhere unreadable." };
      }
      continue;
    }

    if (!response.ok) {
      // Same reason as the redirect path above: nothing here will read this
      // body, and leaving it unread holds a socket open for every 403, 404 and
      // 5xx until the pool or the garbage collector gets to it.
      await response.body?.cancel().catch(() => {});
      const hint =
        response.status === 403
          ? "the site blocked automated access"
          : response.status === 404
            ? "the page was not found"
            : `it answered ${response.status}`;
      return { ok: false, kind: "upstream", status: response.status, message: `Could not read that page: ${hint}.` };
    }

    const body = await readCapped(response, limits.maxBytes).catch(() => null);
    if (!body) {
      return {
        ok: false,
        kind: "too-large",
        status: 413,
        message: `That file is over the ${Math.round(limits.maxBytes / 1024 / 1024)} MB limit.`,
      };
    }

    return {
      ok: true,
      url: url.toString(),
      status: response.status,
      contentType: response.headers.get("content-type") ?? "",
      body,
    };
  }

  return { ok: false, kind: "upstream", status: 502, message: "That address redirected too many times." };
}

import { lookup } from "node:dns/promises";
import {
  checkUrlShape,
  describeRejection,
  isPublicAddress,
  DEFAULT_FETCH_LIMITS,
  type OutboundFetchLimits,
} from "@weaveforge/core";

/**
 * Fetching a URL a visitor chose, from the server, without becoming a way into
 * the network.
 *
 * The policy lives in `@weaveforge/core` and holds no I/O, so the same rules
 * apply here, in the Electron main process, and in a test. This file is the
 * part that has to touch the network: resolve the name, check every address it
 * resolved to, and do it again for every redirect — because a redirect is a
 * second URL the visitor did not show you, and following one blind undoes the
 * check on the first.
 *
 * What this cannot fully close is the gap between the check and the connect: a
 * name can resolve to a public address for the check and a private one for the
 * request. Closing that needs a custom agent that dials the address already
 * validated, which is worth doing and is written up under "Outbound fetches on
 * a user's behalf" in `docs/SECURITY.md` rather than half-done here. The window
 * is small, every hop is re-checked, and the response is capped, which together
 * make it a much poorer target than the unguarded fetch this replaces.
 */

export type SafeFetchFailure =
  | { ok: false; kind: "refused"; status: 400; message: string }
  | { ok: false; kind: "unreachable"; status: 502 | 504; message: string }
  | { ok: false; kind: "upstream"; status: number; message: string }
  | { ok: false; kind: "too-large"; status: 413; message: string };

export interface SafeFetchSuccess {
  ok: true;
  /** Where the redirects actually ended up. */
  url: string;
  status: number;
  contentType: string;
  body: Uint8Array;
}

export type SafeFetchResult = SafeFetchSuccess | SafeFetchFailure;

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

/**
 * Checks one URL completely: its shape, then every address behind its name.
 *
 * A name with several addresses is refused if *any* of them is private. An
 * attacker controls the DNS answer, so "one of them was public" says nothing
 * about which one a later connection will use.
 */
export async function checkUrlReachable(
  url: URL,
  resolve: (hostname: string) => Promise<string[]> = resolveHost,
): Promise<{ ok: true } | SafeFetchFailure> {
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
  return { ok: true };
}

/** Reads a response body up to `maxBytes`, abandoning it rather than buffering more. */
async function readCapped(response: Response, maxBytes: number): Promise<Uint8Array | null> {
  const declared = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) return null;

  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();

  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      // Cancelling matters: without it the connection stays open pulling bytes
      // nobody will read.
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
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
      response = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(remaining),
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

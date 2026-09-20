import { resetOutboundTransport, setOutboundTransport } from "@/backend/net/safe-fetch";

/**
 * Replace the **outbound transport** for one test, and put it back.
 *
 * The counterpart of `stubFetch` for `safe-fetch.ts`, and it exists because
 * stubbing `globalThis.fetch` stopped being able to prove the thing that
 * matters: the guard resolves a name, checks every address it got back, and then
 * dials *that address*. A stub on `fetch` only ever saw the URL again, so the
 * pinning was untestable — which is how it went unverified while the guard's own
 * doc called it the next thing to do.
 */
export function stubOutboundFetch(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
): {
  /** Every request, with the address the guard pinned for it. */
  calls: { url: string; address: string; method?: string; body?: string }[];
  restore: () => void;
} {
  const calls: { url: string; address: string; method?: string; body?: string }[] = [];
  setOutboundTransport(async ({ url, address, headers, method, body }) => {
    // Method and body are recorded when present and omitted when not: adding
    // `method: undefined` to every entry changes the shape existing callers
    // compare, and one of them compares whole entries.
    const call: { url: string; address: string; method?: string; body?: string } = {
      url: url.href,
      address,
    };
    if (method !== undefined) call.method = method;
    if (body !== undefined) call.body = body;
    calls.push(call);

    // Passed through, not dropped: a caller that sends a POST with a JSON body is
    // exactly what a stub on the *transport* has to be able to see, because real
    // `fetch` would.
    const response = await handler(url.href, { method, headers, body });
    // `Response.url` is empty unless it came off the network; code that reads
    // where it ended up after redirects needs it, as with `stubFetch`.
    if (!response.url) Object.defineProperty(response, "url", { value: url.href, configurable: true });
    return response;
  });
  return { calls, restore: resetOutboundTransport };
}

/**
 * Replace `globalThis.fetch` for one test, and put it back.
 *
 * Four suites had grown their own copy, each slightly different: one recorded
 * the URLs it was called with, one passed `init` through, one set `response.url`
 * so redirect-aware code could read it. A stub that does all three is right for
 * every caller — real `fetch` does all three — so this is the only one now.
 *
 * Still the right tool for code that *does* call `fetch` (the storage providers,
 * the integration clients). `safe-fetch.ts` no longer does: it dials the vetted
 * address itself, so its tests use `stubOutboundFetch`.
 */
export function stubFetch(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
): { calls: string[]; restore: () => void } {
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    const res = await handler(url, init);
    // `Response.url` is empty unless the response came off the network. Code
    // that checks where it ended up after redirects reads it, so fill it in.
    if (!res.url) Object.defineProperty(res, "url", { value: url, configurable: true });
    return res;
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

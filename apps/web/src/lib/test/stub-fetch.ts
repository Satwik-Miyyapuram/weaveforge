/**
 * Replace `globalThis.fetch` for one test, and put it back.
 *
 * Four suites had grown their own copy, each slightly different: one recorded
 * the URLs it was called with, one passed `init` through, one set `response.url`
 * so redirect-aware code could read it. A stub that does all three is right for
 * every caller — real `fetch` does all three — so this is the only one now.
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

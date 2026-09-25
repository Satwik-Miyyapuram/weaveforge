"use client";

import { reportFailedRequest } from "./app-log";

/**
 * The record of requests, kept from the one place every request goes through.
 *
 * `window.fetch` is wrapped once, at startup, rather than each call site being
 * asked to report its own failures. There are hundreds of call sites — the
 * PostgREST client, the blob uploader, the metadata resolvers, every screen that
 * reads a route handler — and the ones that fail are precisely the ones nobody
 * wrote an error path for. Wrapping the global is the only way to catch the
 * request nobody thought about.
 *
 * Three things keep it from being a nuisance:
 *
 *   * **Nothing is read that the caller might need.** A failed response's body
 *     is read from a `clone()`, so the caller's own `res.text()` or `res.json()`
 *     still works. Without the clone this would break every error path in the
 *     app, which is a much worse bug than the one it fixes.
 *   * **A body read cannot wedge.** The clone is read under a short timeout and
 *     a byte cap, and its reader is cancelled when either stops it; a server
 *     that opens a response and never finishes it must not leave a logging call
 *     pending forever.
 *   * **A logging failure is swallowed.** Anything thrown in here is caught and
 *     dropped, and the original response or error is passed through untouched —
 *     the caller's behaviour is identical whether or not this file works.
 *
 * What it does *not* do is worth stating too: a 404 a screen deliberately probes
 * for lands in the log like any other failure. That is the right trade — the
 * alternative is a list of blessed endpoints, which is a second and quieter
 * answer to which requests matter — but it is why the panel calls the file a
 * record rather than a list of bugs.
 *
 * The `console` capture in `log-buffer.ts` already sees the errors; this adds
 * the request *with its URL and status*, which the console line usually omits.
 */

/** How long the body of a failed response is waited for, in milliseconds. */
export const BODY_READ_TIMEOUT_MS = 1_500;
/** How much of a failed response body is kept. */
export const MAX_BODY_CHARS = 2_000;

/**
 * Addresses whose failures are not worth a log line.
 *
 * Two things are ignored, and both by substring rather than by prefix, because
 * the prefix is exactly what varies: the app's own static assets — served from
 * `/_next/...` on the web, and from `app://weaveforge/_next/...` in the
 * installed app — and the dev-time hot-reload poll, which fails several times a
 * second while a build is running.
 *
 * The first version of this matched only the *relative* form, `^/_next/`, so
 * every failed chunk in the desktop build — where the URL is absolute — was
 * logged. That is the noise this list exists to keep out: a missing chunk is
 * already reported by the recovery path, and the log is for the failures
 * nothing else explains.
 */
const IGNORED = ["/_next/", "/__nextjs", "webpack-hmr", ".hot-update."];

/** What each install replaced, so a test can put it back. See the reset below. */
const originals = new WeakMap<typeof fetch, typeof fetch>();

function isNoise(url: string): boolean {
  return IGNORED.some((needle) => url.includes(needle));
}

/** One request's URL, however it was passed. */
function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function methodOf(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) return init.method;
  if (typeof input === "object" && input !== null && "method" in input) {
    return (input as Request).method;
  }
  return "GET";
}

/**
 * Start recording failures. Idempotent, and safe to call before anything else
 * has run: the wrapper only defers to the original.
 */
export function installRequestLog(): void {
  if (typeof window === "undefined") return;
  const current = window.fetch;
  // A second install would see the first as "the original" and report every
  // failure twice, so the flag rides the function itself rather than a module
  // boolean — a bundle loaded twice still installs once.
  if ((current as { __weaveforgeLogged?: boolean }).__weaveforgeLogged) return;

  const wrapped: typeof fetch = async (input, init) => {
    const url = urlOf(input as RequestInfo | URL);
    const method = methodOf(input as RequestInfo | URL, init);
    const noise = isNoise(url);
    let response: Response;
    try {
      response = await current(input, init);
    } catch (error) {
      if (!noise) reportFailedRequest({ method, url, error });
      throw error;
    }
    if (response.ok || noise) return response;

    // The clone is taken before anything reads the original, and the read is
    // bounded, so a caller that never reads the body still gets its response
    // back with the body intact.
    //
    // `clone()` is called *inside* the promise rather than outside it, and that
    // is not tidiness: it throws on a body that is already disturbed or on a
    // stream the runtime will not tee, and a throw from here would escape both
    // the `.then` and the `.catch` — leaving the failure unreported, which is
    // the one outcome this whole file exists to prevent. A test in
    // `src/test/request-log.test.ts` covers exactly that case.
    void Promise.resolve()
      .then(() => readBounded(response.clone()))
      .catch(() => "")
      .then((body) => {
        reportFailedRequest({
          method,
          url,
          status: response.status,
          statusText: response.statusText,
          body,
        });
      });
    return response;
  };
  (wrapped as { __weaveforgeLogged?: boolean }).__weaveforgeLogged = true;
  originals.set(wrapped, current);
  window.fetch = wrapped;
}

/**
 * Put `window.fetch` back, for tests.
 *
 * The same reason `log-buffer.ts` has one: `node:test` shares a process across
 * the files in a run, so an install left behind in one test file would wrap the
 * next one's stub and report another file's requests. The map rather than a
 * property on the function keeps this from being a field a caller could
 * overwrite, and it holds no reference to a request of its own.
 */
export function resetRequestLogForTest(): void {
  const target = globalThis as { window?: { fetch?: typeof fetch } };
  const current = target.window?.fetch;
  const original = current ? originals.get(current) : undefined;
  if (target.window && original) target.window.fetch = original;
}

/**
 * The head of a body, within a byte cap and a time bound.
 *
 * The timeout races the read rather than aborting it: there is no way to
 * interrupt a `Response` clone from here, so cancelling the *wait* is what is
 * actually available — the read is left to settle on its own and its result
 * discarded. That is the honest bound, and what matters is that no failure path
 * in the app is left holding a promise a silent server can keep open forever.
 */
async function readBounded(response: Response): Promise<string> {
  const short = (async () => {
    const reader = response.body?.getReader();
    if (!reader) return (await response.text()).slice(0, MAX_BODY_CHARS);
    let text = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        text += new TextDecoder().decode(value, { stream: true });
        // The cap stops the read. It is a `break` rather than a `return` only so
        // the `finally` still runs; see below for why the cancel is not awaited.
        if (text.length >= MAX_BODY_CHARS) break;
      }
    } finally {
      // *Not awaited*, and that is the whole point of this comment. A `Response`
      // that was cloned is a tee, and cancelling one branch of a tee while the
      // other still holds unread data does not settle — undici leaves the
      // promise pending until the sibling is drained, and the caller may never
      // drain it. Awaiting this hung `readBounded` forever, so the report that
      // follows it in the chain was never sent: a failed request with a large
      // error page produced no log line at all. The timeout above cannot save
      // that, because it bounds the *wait*, and the wait was already over.
      //
      // Dropping the await costs nothing: the reader is a clone the caller
      // never sees, and both branches are collected with the response.
      void reader.cancel().catch(() => {});
    }
    return text.slice(0, MAX_BODY_CHARS);
  })().catch(() => "");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<string>((resolve) => {
    timer = setTimeout(() => resolve(""), BODY_READ_TIMEOUT_MS);
  });
  try {
    return await Promise.race([short, expiry]);
  } finally {
    // The loser of the race is otherwise a timer that fires a second and a half
    // after the body already arrived, once per failed request.
    if (timer) clearTimeout(timer);
  }
}
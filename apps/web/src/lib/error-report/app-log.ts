"use client";

import { desktop } from "@/lib/desktop/desktop-bridge";

/**
 * The one way the page writes to the application log.
 *
 * The log itself is the desktop shell's: a file in the app's data directory,
 * written by the main process so it outlives the window. This is the page's end
 * of it, and it stays this small on purpose — a logging call must never be the
 * reason a feature fails, so every path here swallows its own error.
 *
 * In a browser there is no file and nothing to do: `desktop()` answers null, the
 * in-memory console buffer the error report already carries is the whole record,
 * and a page that is not the desktop app has no business inventing a second one.
 */

export interface AppLogInput {
  level: "error" | "warn" | "info";
  /** Where it came from. `request`, `uncaught`, `screen` — free-form, short. */
  source: string;
  message: string;
  /** The context: a URL, a status, the head of a body. */
  detail?: string;
}

/** Post one line. Silent, and never a promise: callers must not await a log. */
export function logToApp(input: AppLogInput): void {
  try {
    desktop()?.reportAppLog?.(input);
  } catch {
    // A bridge that predates the method, or one that threw as it tore down.
    // Neither is worth failing the caller for.
  }
}

/**
 * Note a request that did not succeed, with everything needed to diagnose it.
 *
 * Called from the fetch wrapper for every non-ok response and every network
 * failure, which is why the detail is assembled here rather than by each caller:
 * "GET https://api.weaveforge.org/rest/v1/papers returned 403" plus the head of
 * the body is the whole diagnosis for most of what goes wrong in this app, and
 * two sessions were spent reconstructing exactly that by hand.
 */
export function reportFailedRequest(input: {
  method: string;
  url: string;
  status?: number;
  statusText?: string;
  body?: string;
  error?: unknown;
}): void {
  const { method, url, status, statusText, body, error } = input;
  const line = `${method.toUpperCase()} ${url} — ${
    status === undefined ? "no response" : `${status}${statusText ? ` ${statusText}` : ""}`
  }`;
  const detail = [
    error instanceof Error ? (error.stack ?? `${error.name}: ${error.message}`) : error ? String(error) : "",
    body ? body.slice(0, 2_000) : "",
  ]
    .filter(Boolean)
    .join("\n");
  logToApp({
    level: "error",
    source: "request",
    message: line,
    detail: detail || undefined,
  });
}

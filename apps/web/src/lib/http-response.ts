/**
 * Fetch-response helpers. Each reads the `Response` and hands its facts to the Rust core
 * (`wf_core::error_report::format`); no message wording is built here.
 */
import { readyCore } from "@/lib/rust-core";
import { isSessionLost } from "./parts";

/** The page origin (or `null` with no window) and the sign-in state: what the Rust formatters read. */
export function pageEnv(): [string | null, boolean] {
  const origin = typeof window === "undefined" ? null : window.location?.origin || null;
  return [origin, isSessionLost()];
}

/** "(HTTP 502 Bad Gateway from /api/x)": the status line and the URL's path, never its query. */
export function httpContext(res: Response): string {
  return readyCore().httpContext(res.url, res.status, res.statusText);
}

/** An Error for a non-ok response: the server's words (or `fallback`) plus status and path. */
export function responseError(res: Response, serverMessage: unknown, fallback: string): Error {
  const [origin, sessionLost] = pageEnv();
  return new Error(readyCore().responseErrorText(serverMessage, fallback, httpContext(res), origin, sessionLost));
}

/** Parse a fetch response body; empty or invalid JSON becomes a safe object. */
export async function readJsonBody(res: Response): Promise<Record<string, unknown>> {
  return readyCore().parseJsonBody(await res.text(), httpContext(res)) as Record<string, unknown>;
}

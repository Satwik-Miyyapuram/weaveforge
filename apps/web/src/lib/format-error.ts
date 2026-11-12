/**
 * Error text for the UI and the API routes. The wording lives in Rust
 * (`wf_core::error_report::format`); this module keeps the import paths the
 * callers use and passes the page state across. Formatting needs the wasm core.
 */
import { readyCore, type RustCore } from "@/lib/rust-core";
import { pageEnv } from "./http-response";

export { httpContext, readJsonBody, responseError } from "./http-response";

/** Shown for an empty or unusable error value. Duplicates the Rust `GENERIC_ERROR`; keep them equal. */
export const GENERIC_ERROR = "Something went wrong.";

/** The core, or null before it loads: error paths must still show something when the wasm load is what failed. */
function loadedCore(): RustCore | null {
  try {
    return readyCore();
  } catch {
    return null;
  }
}

/** Plain wording for `value` before the core loads. */
function rawMessage(value: unknown): string {
  return value instanceof Error ? value.message || GENERIC_ERROR : String(value ?? GENERIC_ERROR);
}

/** Whether `err` is a request that never reached a server (a `TypeError`, or the plain object supabase-js returns). */
export function isNetworkFailure(err: unknown): boolean {
  return readyCore().isNetworkFailureValue(err);
}

/** A rejection reason for the log: the error's name and message, or its JSON. */
export function describeRejection(reason: unknown): string {
  const core = loadedCore();
  if (!core) return rawMessage(reason);
  const [origin, sessionLost] = pageEnv();
  return core.describeRejection(reason, origin, sessionLost);
}

/** The message to show for a thrown value. */
export function formatError(err: unknown): string {
  const core = loadedCore();
  if (!core) return rawMessage(err);
  const [origin, sessionLost] = pageEnv();
  return core.formatError(err, origin, sessionLost);
}

/** "Invalid JSON body: <reason>" for a body that failed to parse. */
export function jsonBodyError(err: unknown): string {
  return readyCore().jsonBodyError(err);
}

/** The message a route may put in a response body; the full error is logged, not returned. */
export function formatErrorForResponse(err: unknown, context = "api"): string {
  const [origin, sessionLost] = pageEnv();
  const { message, log } = readyCore().formatErrorForResponse(err, context, origin, sessionLost);
  if (log !== undefined) console.error(log);
  return message;
}

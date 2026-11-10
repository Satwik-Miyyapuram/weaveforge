/**
 * URL metadata rules (Rust `papers::url_meta`), re-exported from modules.ts.
 * Each function keeps the behaviour of apps/web/src/features/papers/infrastructure/url-metadata-source.ts.
 */
import {
  urlMetaReadFailureMessage as rawReadFailureMessage,
  urlMetaShellTarget as rawShellTarget,
} from "../pkg/wf_wasm.js";

/** The address the desktop relay fetches for a typed value: kept when it has a scheme, else `https://` is added. */
export function urlMetaShellTarget(value: string): string {
  return rawShellTarget(value);
}

/** The message shown when the relay refuses a page, from its HTTP status and its trimmed `error` text. */
export function urlMetaReadFailureMessage(status: number, detail: string): string {
  return rawReadFailureMessage(status, detail);
}

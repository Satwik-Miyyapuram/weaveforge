/**
 * Overleaf error text redaction (Rust `overleaf::error_redact`), re-exported from index.ts. The
 * caller formats the thrown value first; this removes the token and URL credentials and caps the
 * length at 500 UTF-16 units.
 */
import { redactOverleafErrorText as rawRedactOverleafErrorText } from "../pkg/wf_wasm.js";

/** The text with `token` replaced by `[redacted]` and URL credentials removed, at most 500 units. */
export function redactOverleafErrorText(raw: string, token?: string): string {
  return rawRedactOverleafErrorText(raw, token || undefined);
}

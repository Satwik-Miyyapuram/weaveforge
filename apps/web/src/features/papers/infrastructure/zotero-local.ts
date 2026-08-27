import type { DesktopBridge } from "@/lib/desktop/desktop-bridge";
import { ZoteroAnnotations } from "./zotero-annotations";

/**
 * The Zotero on this computer, read through the desktop shell.
 *
 * Zotero 7 serves a read-only copy of the Web API on loopback. It speaks the
 * same JSON, so none of the parsing below this line is new: the pager, the
 * attachment-to-paper join and the annotation parser are the Web API's, given
 * a different origin and a fetch that goes over IPC instead of the network.
 *
 * Read-only is not a limitation we imposed. Zotero's local API answers GETs
 * and nothing else, so annotations come in and nothing goes back out — see
 * `docs/integrations/zotero.md`.
 */

export const ZOTERO_LOCAL_API = "http://127.0.0.1:23119/api";
export const ZOTERO_LOCAL_LIBRARY = "users/0";

/** Zotero's local API wants no key. One is supplied because the shared header
 * builder requires it, and the local server ignores it. */
const UNUSED_KEY = "local";

export const ZOTERO_NOT_RUNNING =
  "Zotero is not answering on this computer. Open Zotero, then try again.";

/**
 * A `fetch` that reaches only the local Zotero, via the shell.
 *
 * The reply is rebuilt into a real `Response` so everything downstream keeps
 * reading `res.ok`, `res.json()` and `res.headers.get("Total-Results")` — the
 * pager's backoff handling included — without knowing where it came from.
 */
export function zoteroLocalFetch(bridge: DesktopBridge): typeof fetch {
  return async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const reply = await bridge.zoteroLocal(url).catch(() => {
      throw new Error(ZOTERO_NOT_RUNNING);
    });
    return new Response(reply.body, { status: reply.status, headers: reply.headers });
  };
}

/** Annotations from the local library, ready to pull. */
export function localZoteroAnnotations(bridge: DesktopBridge): ZoteroAnnotations {
  return new ZoteroAnnotations(
    async () => ({ apiKey: UNUSED_KEY, library: ZOTERO_LOCAL_LIBRARY }),
    zoteroLocalFetch(bridge),
    ZOTERO_LOCAL_API,
  );
}

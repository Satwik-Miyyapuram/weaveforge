import type { DesktopBridge } from "@/lib/desktop/desktop-bridge";
import { ZoteroAnnotations } from "./zotero-annotations";
import { ZoteroSync, type ZoteroSyncDeps } from "./zotero-sync";

/**
 * The Zotero on this computer, read through the desktop shell.
 *
 * Zotero 7 serves a read-only copy of the Web API on loopback. It speaks the
 * same JSON, so none of the parsing below this line is new: the pager, the
 * attachment-to-paper join and the annotation parser are the Web API's, given
 * a different origin and a fetch that goes over IPC instead of the network.
 *
 * Read-only is not a limitation we imposed. Zotero's local API answers GETs
 * and nothing else, so papers and annotations come in and nothing goes back
 * out — see `docs/using/integrations.md`.
 */

export const ZOTERO_LOCAL_API = "http://127.0.0.1:23119/api";
export const ZOTERO_LOCAL_LIBRARY = "users/0";

/** Zotero's local API wants no key. One is supplied because the shared header
 * builder requires it, and the local server ignores it. */
const UNUSED_KEY = "local";

/** What the local library hands the shared readers: the fixed origin, no key. */
const localCredentials = async (collection?: string) => ({
  apiKey: UNUSED_KEY,
  library: ZOTERO_LOCAL_LIBRARY,
  collection,
});

export const ZOTERO_NOT_RUNNING =
  "Zotero is not answering on this computer. Open Zotero, then try again.";

/**
 * What a 403 from the local API actually means, in full.
 *
 * Zotero 7 serves the local API only when a hidden preference says so, and a
 * copy of Zotero that has never had it switched on answers *every* local path
 * with 403 while `GET /connector/ping` keeps returning 200. So the symptom is
 * "the server is running and it refuses me", which reads like a permissions
 * problem on our side and is not one.
 *
 * The old message was "Local API is not enabled", which named the condition and
 * left the reader nowhere to go. This names the preference to flip, where it
 * lives, and the restart it needs — because the preference is read once at
 * startup, so setting it in a running Zotero changes nothing until it is
 * restarted, and a reader who tries it without the restart will conclude the
 * instruction is wrong.
 */
export const ZOTERO_LOCAL_API_OFF =
  `Zotero is running but its local API is switched off (it answered 403). ` +
  `In Zotero open Settings → Advanced → Config Editor and set ` +
  `extensions.zotero.httpServer.localAPI.enabled to true, then restart Zotero. ` +
  `The setting is read only at startup, so it does nothing until Zotero restarts.`;

/** The reader-facing message for a status the local API answered with. */
export function zoteroLocalStatusMessage(status: number): string | null {
  if (status === 403) return ZOTERO_LOCAL_API_OFF;
  return null;
}

/**
 * A `fetch` that reaches only the local Zotero, via the shell.
 *
 * The reply is rebuilt into a real `Response` so everything downstream keeps
 * reading `res.ok`, `res.json()` and `res.headers.get("Total-Results")` — the
 * pager's backoff handling included — without knowing where it came from.
 *
 * Two things are done to the reply rather than handed on as they arrived:
 *
 *   * **The 403 becomes a sentence.** Every caller's next move with a non-ok
 *     response is to write `fetch failed (403)` and show it, which is the
 *     message this file exists to replace, and there are four callers — the item
 *     pager, the collections reader, the annotation reader and the write-back —
 *     so doing it here is one answer instead of four.
 *   * **A status the `Response` constructor refuses is translated.** The
 *     constructor takes only 200–599 and refuses 204, 205 and 304 outright, and
 *     the shell forwards Zotero's raw status. Zotero's Web API answers 304 to a
 *     conditional read, so a perfectly good answer used to arrive as
 *     `TypeError: Invalid response status code 304` from a line the caller had
 *     no reason to suspect. The wire status is kept beside it, so the message a
 *     caller composes still names what actually came back.
 */
export function zoteroLocalFetch(bridge: DesktopBridge): typeof fetch {
  return async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const reply = await bridge.zoteroLocal(url).catch((cause: unknown) => {
      // The bridge's own reason is kept. It used to be replaced wholesale with
      // "Zotero is not answering", which sent the reader to check a running
      // Zotero when the real cause was a shell too old to have the channel, a
      // refused origin, or a URL the guard rejected.
      const why = cause instanceof Error ? cause.message : String(cause);
      throw new Error(`${ZOTERO_NOT_RUNNING} (${why})`);
    });
    const refused = zoteroLocalStatusMessage(reply.status);
    if (refused) throw new Error(refused);
    const status = usableStatus(reply.status);
    const headers = { ...reply.headers, ...(status === reply.status ? {} : { "x-weaveforge-status": String(reply.status) }) };
    return new Response(reply.body, { status, headers });
  };
}

/**
 * A status a `Response` can be built with.
 *
 * `Response` accepts 200–599 and refuses 204, 205 and 304 by name — checked
 * against Node's own implementation rather than assumed. Anything else is
 * reported as a 500 with the real code in a header, because a response object
 * cannot carry it and a thrown constructor error is worse than a status nobody
 * expected: the callers all treat a non-ok response as a failed read, and the
 * header is there for the message.
 */
export function usableStatus(status: number): number {
  const constructible = Number.isInteger(status) && status >= 200 && status <= 599;
  if (!constructible) return 500;
  if (status === 204 || status === 205 || status === 304) return 500;
  return status;
}

/**
 * The local library's papers, ready to pull.
 *
 * Only `pull()` is meaningful here: a push is a POST the local API refuses,
 * and a delete-propagation against a library that may be a subset of the
 * cloud one would remove papers that are merely elsewhere.
 */
export function localZoteroLibrary(
  bridge: DesktopBridge,
  deps: Pick<ZoteroSyncDeps, "listPapers" | "addPaper" | "onItemTags">,
  collection?: () => Promise<string | undefined>,
): ZoteroSync {
  return new ZoteroSync({
    ...deps,
    credentials: async () => localCredentials(await collection?.()),
    fetchFn: zoteroLocalFetch(bridge),
    baseUrl: ZOTERO_LOCAL_API,
  });
}

/** Annotations from the local library, ready to pull. */
export function localZoteroAnnotations(
  bridge: DesktopBridge,
  collection?: () => Promise<string | undefined>,
): ZoteroAnnotations {
  return new ZoteroAnnotations(
    async () => localCredentials(await collection?.()),
    zoteroLocalFetch(bridge),
    ZOTERO_LOCAL_API,
  );
}

import { checkUrlShape } from "@weaveforge/core";
import { fetchPageTitle, fetchRemoteImage } from "@/backend/net/fetch-for-paste";
import type { ImagePayload, IpcResult, TitlePayload } from "./channels";

/**
 * What the two fetch channels actually do, with no Electron in sight.
 *
 * Separated from `main.ts` so it can be run in a test: `ipcMain.handle` needs a
 * live app, and the part worth checking is not the registration but the
 * shaping — that a refusal comes back as a message rather than as a thrown
 * error, that a non-string argument is refused before anything is requested,
 * and that the bytes handed to the renderer are exactly the bytes read.
 *
 * Neither function decides anything about *what* may be fetched. That is
 * `fetch-for-paste`, imported from the web app, which is the same module its
 * API route uses.
 */

const BAD_ARGUMENT = "That address could not be read.";

export async function handleFetchTitle(url: unknown): Promise<IpcResult<TitlePayload>> {
  if (typeof url !== "string") return { ok: false, message: BAD_ARGUMENT };
  const result = await fetchPageTitle(url);
  if (!result.ok) return { ok: false, message: result.message };
  return { ok: true, value: { title: result.title, url: result.url } };
}

export async function handleFetchImage(url: unknown): Promise<IpcResult<ImagePayload>> {
  if (typeof url !== "string") return { ok: false, message: BAD_ARGUMENT };
  const result = await fetchRemoteImage(url);
  if (!result.ok) return { ok: false, message: result.message };
  return {
    ok: true,
    value: {
      bytes: exactBytes(result.body),
      contentType: result.contentType,
      url: result.url,
    },
  };
}

/**
 * The picture's bytes and nothing else.
 *
 * A `Uint8Array` is a view, and Node hands back views into pooled buffers as a
 * matter of course. Sending `body.buffer` would send whatever else happens to
 * share that pool — other responses, most likely — straight into the renderer.
 */
export function exactBytes(body: Uint8Array): ArrayBuffer {
  return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer;
}

/**
 * Whether a URL may be handed to the operating system.
 *
 * `shell.openExternal` will run a `file:` path or any registered protocol
 * handler, so a page that chooses the string chooses what the machine opens.
 * This is the same scheme, port and credential check the fetch guard starts
 * with — reused rather than restated, so there is one answer to "is this a web
 * address" in the whole codebase.
 */
export function mayOpenExternally(url: string): boolean {
  return checkUrlShape(url).ok;
}

/**
 * The port the sign-in redirect comes back to.
 *
 * Fixed rather than chosen at random, which is the one place this departs from
 * the usual loopback recipe. RFC 8252 lets a native app take any free port
 * because the authorization server is required to ignore the port when it
 * matches a loopback redirect. Supabase does not: it matches the redirect
 * against a literal allow list, so the port has to be a number somebody can put
 * on that list. Picked from the IANA dynamic range and unlikely to collide.
 */
export const AUTH_LOOPBACK_PORT = 53682;

/** The one path the loopback listener answers on. */
export const AUTH_LOOPBACK_PATH = "/auth/callback";

/**
 * The query string a sign-in came back with, or null if this is not that.
 *
 * A loopback listener is reachable by anything else running on the machine, so
 * what arrives here is untrusted and only its shape is trusted: the path has to
 * match, and there has to be a query to hand on. Nothing is parsed or believed
 * beyond that — the authorization code inside is worthless without the PKCE
 * verifier, which never leaves the renderer that started the flow, so a forged
 * request costs a failed exchange and nothing else.
 */
export function signInCallbackQuery(requestUrl: string | undefined): string | null {
  if (!requestUrl) return null;
  let parsed: URL;
  try {
    parsed = new URL(requestUrl, "http://127.0.0.1");
  } catch {
    return null;
  }
  if (parsed.pathname !== AUTH_LOOPBACK_PATH) return null;
  if (!parsed.search) return null;
  return parsed.search;
}

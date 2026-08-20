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

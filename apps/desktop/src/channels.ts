/**
 * The IPC channels, named once.
 *
 * Both sides of an Electron app talk over strings, and a typo in one of them is
 * a handler that silently never fires. They are declared here, with the shapes
 * that cross, so the main process and the preload script are checked against
 * the same definition rather than against each other's memory.
 *
 * What crosses is deliberately plain: strings, numbers and an `ArrayBuffer`.
 * Electron structured-clones IPC payloads, so a `Uint8Array` view over a larger
 * buffer, a `Blob` or an `Error` would each arrive as something else — or not
 * at all.
 */

export const CHANNELS = {
  fetchTitle: "weaveforge:fetch-title",
  fetchImage: "weaveforge:fetch-image",
  openExternal: "weaveforge:open-external",
} as const;

/**
 * What a handler answers with.
 *
 * A failure is a value, not a thrown error: an exception thrown inside
 * `ipcMain.handle` reaches the renderer as an `Error` with Electron's own
 * prefix stapled to the front of the message, and the paste code shows that
 * message to a person. So the reason travels as data and the preload turns it
 * back into an error on the far side.
 */
export type IpcResult<T> = { ok: true; value: T } | { ok: false; message: string };

export interface TitlePayload {
  title: string;
  url: string;
}

export interface ImagePayload {
  bytes: ArrayBuffer;
  contentType: string;
  url: string;
}

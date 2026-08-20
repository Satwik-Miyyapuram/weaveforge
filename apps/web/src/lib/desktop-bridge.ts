"use client";

/**
 * What the desktop build adds, and how the web build asks whether it is there.
 *
 * This file is the entire contract between the two. `apps/desktop` implements
 * it in the Electron main process and exposes it on `window.weaveforge` through
 * a preload script; every feature that can take advantage of it does so through
 * a capability interface with a browser implementation beside it, so nothing in
 * the app is desktop-only and nothing is written twice.
 *
 * Keeping the surface this small is deliberate. Each entry is something a
 * browser genuinely cannot do — not a faster path to something it can — because
 * every entry is also a hole in the sandbox that separates the renderer from
 * the machine, and one that has to be reviewed on both sides forever.
 */

export interface DesktopImage {
  /**
   * The picture's bytes. An `ArrayBuffer` rather than a typed array because
   * that is what survives Electron's structured clone unambiguously, and the
   * renderer wraps it in a `Blob` at the one place that needs one.
   */
  bytes: ArrayBuffer;
  contentType: string;
  /** Where the redirects ended up. */
  url: string;
}

export interface DesktopBridge {
  /** Version of the desktop shell, so a mismatch can be reported rather than crash. */
  readonly version: string;
  /** The platform, for the few places a keyboard hint differs. */
  readonly platform: "darwin" | "win32" | "linux";

  /**
   * Reads a page's title without a server round trip.
   *
   * The same guard as the API route — the main process imports the same module
   * — so a desktop build is not a way around the address checks. What it avoids
   * is the round trip and the CORS barrier, neither of which exists here.
   */
  fetchTitle(url: string): Promise<{ title: string; url: string }>;

  /** Downloads a picture, under the same guard and the same size cap. */
  fetchImage(url: string): Promise<DesktopImage>;

  /**
   * Calls back when a provider sign-in returns, with the callback's query
   * string, and answers with the way to stop listening.
   *
   * The sign-in itself happens in the reader's real browser — a provider will
   * not run inside an embedded window, and this window sends off-origin
   * navigations out to the browser anyway. The browser is then redirected to a
   * loopback address the desktop shell is listening on, which is the shape
   * RFC 8252 asks a native app to use, and the shell forwards what arrived.
   *
   * A browser has no equivalent and needs none: there the provider redirects
   * back to the page itself.
   */
  onSignIn(cb: (query: string) => void): () => void;
}

declare global {
  interface Window {
    weaveforge?: DesktopBridge;
  }
}

/**
 * The bridge, or null in a browser.
 *
 * Read through a function rather than exported as a value because the preload
 * script runs before the bundle and a module-level read would be evaluated
 * during the server render, where `window` does not exist.
 */
export function desktop(): DesktopBridge | null {
  if (typeof window === "undefined") return null;
  const bridge = window.weaveforge;
  // Checked by shape rather than by presence: a page in a browser can have
  // anything on `window`, and a half-initialised bridge should read as absent.
  if (!bridge || typeof bridge.fetchTitle !== "function") return null;
  return bridge;
}

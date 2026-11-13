"use client";

import { desktop } from "@/lib/desktop/desktop-bridge";

/**
 * Where a sign-in that started in the desktop app has to come back to.
 *
 * A provider sign-in cannot happen inside the app window: the window sends
 * off-origin navigations to the real browser, and providers refuse embedded
 * ones anyway. So the flow finishes in the reader's browser — and then has to
 * reach a different program.
 *
 * It reaches it over loopback. The browser is redirected to `127.0.0.1` on a
 * port the desktop shell is listening on, which is an ordinary web address, so
 * the browser simply follows it: nothing to click, nothing to permit. This is
 * what RFC 8252 asks a native app on a desktop operating system to do, and it
 * is what replaced a `weaveforge://` link here — a custom scheme needs the
 * browser's permission to launch another program, browsers withhold it when no
 * click is behind the navigation, and they withhold it silently.
 *
 * The port is fixed because Supabase matches redirect URLs against a literal
 * allow list; it is repeated rather than imported because `apps/shell` is not
 * a dependency of `apps/web`, and the desktop test asserts the two agree.
 */
const AUTH_LOOPBACK_PORT = 53682;

export const AUTH_LOOPBACK_URL = `http://127.0.0.1:${AUTH_LOOPBACK_PORT}/auth/callback`;

/**
 * Where a sign-in returns on a phone. Phones cannot rely on a listening port,
 * so the browser returns to an https link the app owns (an Android App Link or
 * iOS Universal Link), and the OS hands it to the app. The shell repeats this
 * in `apps/shell/src/auth_link.rs`.
 */
export const AUTH_LINK_URL = "https://app.weaveforge.org/auth/app-callback";

/**
 * The address a provider should return to.
 *
 * In a browser that is the origin itself, which is what it has always been. In
 * the desktop app it is the loopback listener, because the browser finishing
 * the flow is a different program from the one that started it — landing back
 * on the origin would sign the browser in and leave the app as it was.
 *
 * On a phone it is the app's sign-in link (`AUTH_LINK_URL`).
 */
/**
 * The callback query in an address the reader pasted, or null when it is not
 * the loopback callback. Used when another program holds the loopback port, so
 * the browser's redirect never reaches this app: the reader copies the address
 * the browser was sent to and pastes it in.
 */
export function pastedSignInQuery(text: string): string | null {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return null;
  }
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if (url.protocol !== "http:" || !loopback || url.port !== String(AUTH_LOOPBACK_PORT)) return null;
  if (url.pathname !== "/auth/callback") return null;
  const params = url.searchParams;
  return params.has("code") || params.has("error") ? url.search : null;
}

export function appOrigin(): string | undefined {
  return typeof window === "undefined" ? undefined : window.location.origin;
}

export function authRedirectTo(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const bridge = desktop();
  if (!bridge) return window.location.origin;
  return bridge.platform === "android" || bridge.platform === "ios" ? AUTH_LINK_URL : AUTH_LOOPBACK_URL;
}

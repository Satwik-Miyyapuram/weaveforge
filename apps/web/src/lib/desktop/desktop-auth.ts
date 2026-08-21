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
 * allow list; it is repeated rather than imported because `apps/desktop` is not
 * a dependency of `apps/web`, and the desktop test asserts the two agree.
 */
const AUTH_LOOPBACK_PORT = 53682;

export const AUTH_LOOPBACK_URL = `http://127.0.0.1:${AUTH_LOOPBACK_PORT}/auth/callback`;

/**
 * The address a provider should return to.
 *
 * In a browser that is the origin itself, which is what it has always been. In
 * the desktop app it is the loopback listener, because the browser finishing
 * the flow is a different program from the one that started it — landing back
 * on the origin would sign the browser in and leave the app as it was.
 */
export function appOrigin(): string | undefined {
  return typeof window === "undefined" ? undefined : window.location.origin;
}

export function authRedirectTo(): string | undefined {
  if (typeof window === "undefined") return undefined;
  return desktop() ? AUTH_LOOPBACK_URL : window.location.origin;
}

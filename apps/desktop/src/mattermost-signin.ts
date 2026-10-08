/**
 * Mattermost sign-in in a window of its own.
 *
 * The reader signs in on the server's own login page (LDAP/NetID, MFA, or
 * whatever the server offers), so the app never sees a password. Mattermost
 * sets its session token in the `MMAUTHTOKEN` cookie; the window runs in a
 * fresh in-memory session, so the only cookie it can see is the one this
 * sign-in set. That token is checked against `/api/v4/users/me` and returned.
 */

import { randomUUID } from "node:crypto";
import { BrowserWindow, session, shell, type Cookie } from "electron";
import { CHANNELS } from "./channels";
import type { IpcSurface } from "./ipc-guard";

export const SESSION_COOKIE = "MMAUTHTOKEN";
const GIVE_UP_MS = 10 * 60_000;

/** The server's origin, or null when it is not an http(s) URL. */
export function mattermostOrigin(serverUrl: unknown): string | null {
  if (typeof serverUrl !== "string") return null;
  try {
    const url = new URL(serverUrl.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch {
    return null;
  }
}

/** The session token in a cookie the server just set, or null for any other cookie. */
export function sessionTokenFrom(cookie: Pick<Cookie, "name" | "value" | "domain">, origin: string, removed: boolean): string | null {
  if (removed || cookie.name !== SESSION_COOKIE || !cookie.value) return null;
  const host = new URL(origin).hostname;
  const domain = (cookie.domain ?? "").replace(/^\./, "");
  return domain === host || host.endsWith(`.${domain}`) ? cookie.value : null;
}

/** True when the token signs in as a user, so a stale or half-set cookie is not saved. */
export async function tokenWorks(origin: string, token: string, fetchFn: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetchFn(`${origin}/api/v4/users/me`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
    await res.body?.cancel().catch(() => {});
    return res.ok;
  } catch {
    return false;
  }
}

/** Opens the server's login page; resolves with the token, or null when the window is closed. */
export function signInToMattermost(origin: string, parent: BrowserWindow | null): Promise<string | null> {
  const ses = session.fromPartition(`mattermost-signin-${randomUUID()}`);
  const window = new BrowserWindow({
    parent: parent ?? undefined,
    modal: false,
    width: 520,
    height: 760,
    title: "Sign in to Mattermost",
    autoHideMenuBar: true,
    webPreferences: { session: ses, contextIsolation: true, nodeIntegration: false, sandbox: true, webviewTag: false },
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });

  return new Promise((resolve) => {
    let done = false;
    const finish = (token: string | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      ses.cookies.removeListener("changed", onCookie);
      if (!window.isDestroyed()) window.close();
      void ses.clearStorageData().catch(() => {});
      resolve(token);
    };
    const onCookie = (_e: unknown, cookie: Cookie, _cause: string, removed: boolean) => {
      const token = sessionTokenFrom(cookie, origin, removed);
      if (token) void tokenWorks(origin, token).then((ok) => ok && finish(token));
    };
    const timer = setTimeout(() => finish(null), GIVE_UP_MS);
    ses.cookies.on("changed", onCookie);
    window.on("closed", () => finish(null));
    void window.loadURL(`${origin}/login`).catch(() => {});
  });
}

export function registerMattermostSignIn(deps: { ipc: IpcSurface; mainWindow: () => BrowserWindow | null }): void {
  let open: Promise<string | null> | null = null;
  deps.ipc.handle(CHANNELS.mattermostSignIn, async (_event, serverUrl: unknown) => {
    const origin = mattermostOrigin(serverUrl);
    if (!origin) return { ok: false, message: "Mattermost server URL must be a valid http(s) URL." };
    // One window at a time; a second click joins the open one.
    open ??= signInToMattermost(origin, deps.mainWindow()).finally(() => { open = null; });
    return { ok: true, value: await open };
  });
}

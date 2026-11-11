import { nativeTheme, type BrowserWindow } from "electron";
import { execFile } from "node:child_process";
import path from "node:path";
import { isArxivProxyRequest, proxyArxiv } from "./arxiv-proxy";
import { isBlobProxyRequest, proxyBlob, relayToHostedApp } from "./blob-proxy";
import { isHtmlProxyRequest, proxyHtml } from "./html-proxy";
import { isPdfProxyRequest, proxyPdf } from "./pdf-proxy";
import { refuse } from "./proxy-shared";
import type { ProxyFetch } from "./proxy-shared";
import { isSemanticScholarProxyRequest, proxySemanticScholar } from "./semantic-scholar-proxy";

// --- taskbar-icon ---
const PERSONALIZE = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize";

/** Taskbar follows the Windows *system* theme, which Electron 33 cannot see apart from the app theme. */
function systemUsesLightTheme(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile("reg", ["query", PERSONALIZE, "/v", "SystemUsesLightTheme"], { windowsHide: true }, (err, out) => {
      // Missing key means pre-1903 Windows, whose taskbar is dark.
      resolve(!err && /SystemUsesLightTheme\s+REG_DWORD\s+0x1\b/.test(out));
    });
  });
}

/** Windows only: cream mark on a dark taskbar; the outlined default reads on either. */
export function followTaskbarTheme(window: BrowserWindow): void {
  if (process.platform !== "win32") return;
  const apply = async () => {
    const light = await systemUsesLightTheme();
    if (window.isDestroyed()) return;
    window.setIcon(path.join(__dirname, light ? "icon.png" : "icon-dark.png"));
  };
  void apply();
  // `updated` tracks the app theme; focus catches a taskbar-only switch.
  nativeTheme.on("updated", apply);
  window.on("focus", apply);
  window.on("closed", () => nativeTheme.off("updated", apply));
}

// --- account-proxy ---
/**
 * Account deletion relay, served from the `app://` origin.
 *
 * Settings → Delete account posts to `/api/account/delete-user/otp` and then
 * `/api/account/delete-user`. Both are server routes holding the service-role
 * key; the static bundle has neither, so on the desktop each call fell through
 * to the bundle's 404 page and the panel showed a JSON parse error instead of
 * sending the code. The shell relays exactly those two paths, POST only, to the
 * hosted app.
 */

export const ACCOUNT_PROXY_PATHS: readonly string[] = [
  "/api/account/delete-user",
  "/api/account/delete-user/otp",
];

export function isAccountProxyRequest(requestUrl: string): boolean {
  return ACCOUNT_PROXY_PATHS.includes(new URL(requestUrl).pathname);
}

export function proxyAccount(request: Request, fetchFn: ProxyFetch = fetch): Promise<Response> {
  if (request.method.toUpperCase() !== "POST") return Promise.resolve(refuse(405, "Method not allowed"));
  return relayToHostedApp(request, new URL(request.url).pathname, fetchFn);
}

// --- overleaf-proxy ---
/**
 * Overleaf Workshop relay, served from the `app://` origin.
 *
 * The Workshop panel signs in with an Overleaf session cookie, lists projects,
 * compiles and fetches the PDF through `/api/overleaf/workshop/*`. Those are
 * server routes that seal the cookie and talk to Overleaf; the static bundle
 * has none, so the shell relays exactly those paths to the hosted app. The
 * user's bearer token goes along; the Overleaf cookie stays in the body, as on
 * the web.
 */

/** Each Workshop route and the methods its server route answers. */
const OVERLEAF_PROXY_ROUTES: Readonly<Record<string, readonly string[]>> = {
  "/api/overleaf/workshop/session": ["POST", "DELETE"],
  "/api/overleaf/workshop/projects": ["POST"],
  "/api/overleaf/workshop/compile": ["POST"],
  "/api/overleaf/workshop/pdf": ["POST"],
};

export function isOverleafProxyRequest(requestUrl: string): boolean {
  return Object.hasOwn(OVERLEAF_PROXY_ROUTES, new URL(requestUrl).pathname);
}

export function proxyOverleaf(request: Request, fetchFn: ProxyFetch = fetch): Promise<Response> {
  const { pathname, search } = new URL(request.url);
  if (!OVERLEAF_PROXY_ROUTES[pathname]?.includes(request.method.toUpperCase())) {
    return Promise.resolve(refuse(405, "Method not allowed"));
  }
  return relayToHostedApp(request, pathname + search, fetchFn);
}

// --- app-relays ---
/**
 * The `/api/*` paths the shell answers itself.
 *
 * The web app has these as server routes; the static bundle the shell serves
 * has none, so each is relayed here with `net.fetch`, where no CORS applies.
 * One entry point keeps the `app://` handler in main.ts a dispatch, not a list.
 */

/** The relayed answer, or `null` when the request is for a bundle file. */
export function answerRelay(request: Request, fetchFn: ProxyFetch): Promise<Response> | null {
  // The reader's PDF proxy.
  if (isPdfProxyRequest(request.url)) return proxyPdf(request.url, fetchFn);
  // A paper published as a web page, for the reader's HTML view.
  if (isHtmlProxyRequest(request.url)) return proxyHtml(request.url, fetchFn);
  // Semantic Scholar, relayed so a throttled call is a 429 and not a CORS error.
  if (isSemanticScholarProxyRequest(request.url)) return proxySemanticScholar(request, fetchFn);
  // arXiv, which sends no CORS headers at all.
  if (isArxivProxyRequest(request.url)) return proxyArxiv(request, fetchFn);
  // The blob store's routes (pictures on papers and notes), on the hosted app.
  if (isBlobProxyRequest(request.url)) return proxyBlob(request, fetchFn);
  // Account deletion: both steps need the server's service-role key.
  if (isAccountProxyRequest(request.url)) return proxyAccount(request, fetchFn);
  // Overleaf Workshop: the server seals the Overleaf session and compiles.
  if (isOverleafProxyRequest(request.url)) return proxyOverleaf(request, fetchFn);
  return null;
}

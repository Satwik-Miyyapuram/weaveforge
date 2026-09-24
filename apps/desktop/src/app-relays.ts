/**
 * The `/api/*` paths the shell answers itself.
 *
 * The web app has these as server routes; the static bundle the shell serves
 * has none, so each is relayed here with `net.fetch`, where no CORS applies.
 * One entry point keeps the `app://` handler in main.ts a dispatch, not a list.
 */

import { isArxivProxyRequest, proxyArxiv } from "./arxiv-proxy";
import { isHtmlProxyRequest, proxyHtml } from "./html-proxy";
import { isPdfProxyRequest, proxyPdf } from "./pdf-proxy";
import { isSemanticScholarProxyRequest, proxySemanticScholar, type ProxyFetch } from "./semantic-scholar-proxy";

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
  return null;
}

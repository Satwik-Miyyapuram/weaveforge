/**
 * The rules both HTML relays share — the web server's `api/html-proxy` and the
 * desktop shell's copy — so a page is judged the same way wherever it is
 * fetched.
 *
 * A paper published as a web page (arXiv's HTML, PubMed Central, a journal's
 * full-text view) cannot be read from the page directly for the same reason a
 * PDF cannot: the hosts send no CORS headers. The relay fetches it and hands
 * back the markup as plain text — never as a document the browser would
 * render — and the reader sanitises it before showing it in a sandboxed frame.
 */

export const HTML_PROXY_PATH = "/api/html-proxy";

/** A full-text page with inline figures is a few MiB at most; this is headroom. */
export const HTML_PROXY_MAX_BYTES = 15 * 1024 * 1024;

/** The header the relay puts the address it ended up at in, after redirects. */
export const HTML_FINAL_URL_HEADER = "x-final-url";

export function isHtmlContentType(value: string | null): boolean {
  if (!value) return false;
  const type = value.split(";")[0]?.trim().toLowerCase() ?? "";
  return type === "text/html" || type === "application/xhtml+xml";
}

function charsetOf(contentType: string | null, head: string): string {
  const fromHeader = /charset\s*=\s*"?([\w.:-]+)/i.exec(contentType ?? "")?.[1];
  if (fromHeader) return fromHeader.toLowerCase();
  const fromMeta = /<meta[^>]+charset\s*=\s*["']?([\w.:-]+)/i.exec(head)?.[1];
  return fromMeta ? fromMeta.toLowerCase() : "utf-8";
}

/**
 * Decode a page's bytes with the charset it declares, in the header or in a
 * `<meta>` near the top. An unknown label falls back to UTF-8 rather than
 * failing: a few wrong accents beat no page.
 */
export function decodeHtmlBytes(bytes: Uint8Array, contentType: string | null): string {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 4096));
  const charset = charsetOf(contentType, head);
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

/**
 * The relay's answer: the markup as text, with the address it came from.
 *
 * `text/plain` and a sandboxing CSP so that opening the relay's URL in a tab
 * shows source, not a live page on this origin.
 */
export function htmlRelayResponse(text: string, finalUrl: string): Response {
  return new Response(text, {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
      "cache-control": "private, no-store",
      [HTML_FINAL_URL_HEADER]: finalUrl,
    },
  });
}

/**
 * Read a body up to `maxBytes`, or `null` past it. The cap holds while
 * reading: a `content-length` can be absent or wrong.
 */
export async function readCapped(body: ReadableStream<Uint8Array>, maxBytes: number): Promise<Uint8Array | null> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

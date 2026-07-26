import { NextResponse } from "next/server";
import { requireSdkUser } from "@/app/api/sdk/_shared";
import {
  isAllowedPdfProxyUrl,
  PDF_PROXY_MAX_BYTES,
} from "@/features/reader/application/sanitize-reader-url";

/**
 * Same-origin PDF proxy for the read-only reader (Phase D).
 *
 * Publisher hosts (arXiv, OpenReview, …) typically omit CORS headers, so
 * pdf.js cannot fetch them from the browser. This route fetches on the server
 * for an allowlisted set of hosts and streams the bytes back same-origin.
 *
 * Security: authenticated callers only; https allowlist; manual redirects;
 * PDF magic + content-type; streamed byte cap. Header fetch has a short
 * timeout; the body stream is not aborted by that header budget.
 */

export const runtime = "nodejs";

const MAX_REDIRECTS = 5;
const HEADER_TIMEOUT_MS = 30_000;
const PDF_MAGIC_WINDOW = 1024;

export { isAllowedPdfProxyUrl };

function pdfResponseHeaders(): HeadersInit {
  return {
    "content-type": "application/pdf",
    "content-disposition": "attachment",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; sandbox",
    "cache-control": "private, max-age=3600",
  };
}

function isPdfContentType(value: string | null): boolean {
  if (!value) return false;
  const type = value.split(";")[0]?.trim().toLowerCase() ?? "";
  return type === "application/pdf" || type === "application/octet-stream";
}

function cappedPdfStream(body: ReadableStream<Uint8Array>, maxBytes: number): ReadableStream<Uint8Array> {
  let seen = 0;
  const reader = body.getReader();
  return new ReadableStream({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      seen += value.byteLength;
      if (seen > maxBytes) {
        await reader.cancel().catch(() => undefined);
        controller.error(new Error("PDF too large"));
        return;
      }
      controller.enqueue(value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

async function readPrefix(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  minBytes: number,
  maxBytes: number,
): Promise<{ head: Uint8Array; rest: ReadableStream<Uint8Array> } | null> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  // Fill up to the magic window so `%PDF` offset past the first TLS record still
  // sniffs correctly. `minBytes` is only the empty-body floor.
  while (total < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value.byteLength) continue;
    chunks.push(value);
    total += value.byteLength;
  }
  if (total < minBytes) return null;
  const head = new Uint8Array(Math.min(total, maxBytes));
  let offset = 0;
  for (const chunk of chunks) {
    if (offset >= head.byteLength) break;
    const take = Math.min(chunk.byteLength, head.byteLength - offset);
    head.set(chunk.subarray(0, take), offset);
    offset += take;
  }
  // Leftover bytes from the last chunk past maxBytes must still be streamed.
  let leftover: Uint8Array | null = null;
  if (total > maxBytes) {
    let seen = 0;
    for (const chunk of chunks) {
      if (seen + chunk.byteLength <= maxBytes) {
        seen += chunk.byteLength;
        continue;
      }
      leftover = chunk.subarray(maxBytes - seen);
      break;
    }
  }
  let headSent = false;
  let leftoverSent = !leftover;
  const rest = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (!headSent) {
          headSent = true;
          controller.enqueue(head);
          return;
        }
        if (!leftoverSent && leftover) {
          leftoverSent = true;
          controller.enqueue(leftover);
          leftover = null;
          return;
        }
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        if (value.byteLength) controller.enqueue(value);
      } catch (err) {
        controller.error(err);
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
  return { head, rest };
}

function hasPdfMagic(bytes: Uint8Array): boolean {
  const window = bytes.subarray(0, Math.min(PDF_MAGIC_WINDOW, bytes.byteLength));
  const ascii = new TextDecoder("latin1").decode(window);
  return ascii.includes("%PDF");
}

/** Core proxy logic (auth already enforced by the route). Exported for unit tests. */
export async function proxyAllowlistedPdf(startUrl: string): Promise<Response> {
  let current = startUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isAllowedPdfProxyUrl(current)) {
      return NextResponse.json({ error: "URL host is not allowed for PDF proxy" }, { status: 400 });
    }
    const headerAbort = new AbortController();
    const headerTimer = setTimeout(() => headerAbort.abort(), HEADER_TIMEOUT_MS);
    let upstream: Response;
    try {
      upstream = await fetch(current, {
        redirect: "manual",
        cache: "no-store",
        signal: headerAbort.signal,
        headers: {
          "User-Agent": "weaveforge-reader/1.0 (mailto:noreply@example.com)",
          Accept: "application/pdf,*/*",
        },
      });
    } catch {
      clearTimeout(headerTimer);
      return NextResponse.json({ error: "Upstream fetch failed" }, { status: 502 });
    }
    clearTimeout(headerTimer);

    if (upstream.status >= 300 && upstream.status < 400) {
      const location = upstream.headers.get("location");
      void upstream.body?.cancel().catch(() => undefined);
      if (!location) {
        return NextResponse.json({ error: "Redirect missing Location" }, { status: 400 });
      }
      let next: URL;
      try {
        next = new URL(location, current);
      } catch {
        return NextResponse.json({ error: "Redirect Location is invalid" }, { status: 400 });
      }
      current = next.toString();
      continue;
    }

    if (!isAllowedPdfProxyUrl(upstream.url || current)) {
      void upstream.body?.cancel().catch(() => undefined);
      return NextResponse.json({ error: "Redirect left the allowlist" }, { status: 400 });
    }

    if (!upstream.ok || !upstream.body) {
      const status = upstream.status;
      void upstream.body?.cancel().catch(() => undefined);
      return NextResponse.json(
        { error: "Upstream fetch failed" },
        { status: status >= 400 && status < 600 ? status : 502 },
      );
    }

    const lengthHeader = upstream.headers.get("content-length");
    if (lengthHeader) {
      const length = Number(lengthHeader);
      if (!Number.isFinite(length) || length < 0) {
        void upstream.body.cancel().catch(() => undefined);
        return NextResponse.json({ error: "Invalid Content-Length" }, { status: 400 });
      }
      if (length > PDF_PROXY_MAX_BYTES) {
        void upstream.body.cancel().catch(() => undefined);
        return NextResponse.json({ error: "PDF too large" }, { status: 413 });
      }
    }

    if (!isPdfContentType(upstream.headers.get("content-type"))) {
      void upstream.body.cancel().catch(() => undefined);
      return NextResponse.json({ error: "Upstream is not a PDF" }, { status: 415 });
    }

    const prefixed = await readPrefix(upstream.body.getReader(), 5, PDF_MAGIC_WINDOW);
    if (!prefixed) {
      return NextResponse.json({ error: "Empty upstream body" }, { status: 415 });
    }
    if (!hasPdfMagic(prefixed.head)) {
      void prefixed.rest.cancel().catch(() => undefined);
      return NextResponse.json({ error: "Upstream is not a PDF" }, { status: 415 });
    }

    return new NextResponse(cappedPdfStream(prefixed.rest, PDF_PROXY_MAX_BYTES), {
      status: 200,
      headers: pdfResponseHeaders(),
    });
  }

  return NextResponse.json({ error: "Too many redirects" }, { status: 400 });
}

export async function GET(request: Request) {
  const auth = await requireSdkUser(request);
  if (!auth.ok) return auth.response;

  const target = new URL(request.url).searchParams.get("url");
  if (!target) {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
  }
  if (!isAllowedPdfProxyUrl(target)) {
    return NextResponse.json({ error: "URL host is not allowed for PDF proxy" }, { status: 400 });
  }

  return proxyAllowlistedPdf(target);
}

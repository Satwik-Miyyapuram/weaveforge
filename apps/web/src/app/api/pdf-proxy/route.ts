import { NextResponse } from "next/server";
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
 * Security: only https URLs on the allowlist; no credentials; redirects are
 * followed manually only while each Location stays on the allowlist. Responses
 * must be PDF (magic + content-type). Body size is counted on the stream.
 */

export const runtime = "nodejs";

const MAX_REDIRECTS = 5;
const FETCH_TIMEOUT_MS = 30_000;

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

async function fetchAllowlisted(startUrl: string): Promise<Response | NextResponse> {
  let current = startUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isAllowedPdfProxyUrl(current)) {
      return NextResponse.json({ error: "URL host is not allowed for PDF proxy" }, { status: 400 });
    }
    const upstream = await fetch(current, {
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        "User-Agent": "weaveforge-reader/1.0 (mailto:noreply@example.com)",
        Accept: "application/pdf,*/*",
      },
    });

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
        { error: `Upstream returned ${status}` },
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

    // Sniff the first bytes for %PDF before streaming the rest.
    const reader = upstream.body.getReader();
    const first = await reader.read();
    if (first.done || !first.value?.byteLength) {
      await reader.cancel().catch(() => undefined);
      return NextResponse.json({ error: "Empty upstream body" }, { status: 415 });
    }
    const head = first.value;
    const magic = new TextDecoder("ascii").decode(head.subarray(0, Math.min(5, head.byteLength)));
    if (!magic.startsWith("%PDF")) {
      await reader.cancel().catch(() => undefined);
      return NextResponse.json({ error: "Upstream is not a PDF" }, { status: 415 });
    }

    const rest = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(head);
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) {
              controller.close();
              return;
            }
            controller.enqueue(value);
          }
        } catch (err) {
          controller.error(err);
        }
      },
      cancel(reason) {
        return reader.cancel(reason);
      },
    });

    return new NextResponse(cappedPdfStream(rest, PDF_PROXY_MAX_BYTES), {
      status: 200,
      headers: pdfResponseHeaders(),
    });
  }

  return NextResponse.json({ error: "Too many redirects" }, { status: 400 });
}

export async function GET(request: Request) {
  const target = new URL(request.url).searchParams.get("url");
  if (!target) {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
  }
  if (!isAllowedPdfProxyUrl(target)) {
    return NextResponse.json({ error: "URL host is not allowed for PDF proxy" }, { status: 400 });
  }

  try {
    return await fetchAllowlisted(target);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upstream fetch failed";
    if (message === "PDF too large") {
      return NextResponse.json({ error: "PDF too large" }, { status: 413 });
    }
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

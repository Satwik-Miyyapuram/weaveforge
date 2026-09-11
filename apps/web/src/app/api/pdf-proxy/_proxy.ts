import { NextResponse } from "next/server";
import {
  isAllowedPdfProxyUrl,
  PDF_PROXY_MAX_BYTES,
} from "@/features/reader/application/sanitize-reader-url";

/**
 * Same-origin PDF proxy internals for the read-only reader (Phase D).
 *
 * Lives outside `route.ts` because a Next.js App Router route module may only
 * export route handlers and route config — exporting helpers from it fails the
 * production build's route type check. Underscore-prefixed files are ignored by
 * the router, matching the existing `api/sdk/_shared.ts` convention.
 *
 * Security: https allowlist; manual redirects re-checked per hop; PDF magic +
 * content-type; streamed byte cap; and a deadline on the *whole* exchange.
 *
 * The deadline is the part that was missing. There used to be one timer, armed
 * around the header fetch and cleared the moment the headers arrived — so an
 * allowlisted host that answered `200 application/pdf` and then dribbled a byte
 * a minute held the request (and a server slot) open indefinitely. The byte cap
 * does not help: it bounds the size, not the rate, and a host sending one byte
 * per minute never reaches it.
 */

const MAX_REDIRECTS = 5;
const HEADER_TIMEOUT_MS = 30_000;

/**
 * Budget for the whole body, first byte to last.
 *
 * Generous next to `HEADER_TIMEOUT_MS` because a PDF is measured in megabytes
 * and the reader may be on a slow link — but bounded, which is the property
 * that matters: an upstream cannot hold a request open for longer than this
 * plus the header budget, whatever it sends.
 */
const BODY_TIMEOUT_MS = 60_000;

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

/**
 * One budget covering the body phase, enforced two ways.
 *
 * Both mechanisms are needed, and for different halves of the same problem:
 *
 *   * Aborting the controller is what actually tears the upstream connection
 *     down. Without it the socket keeps draining bytes nobody will read, which
 *     is the state the previous code left a stalled body in.
 *   * The rejected promise is what a read is *raced* against. A read already
 *     awaiting a body that will never deliver is not reliably interrupted by an
 *     abort — and when the body is a stub with no connection behind it (a test)
 *     an abort reaches nothing at all.
 *
 * `AbortController` + `setTimeout` rather than `AbortSignal.timeout` because a
 * signal cannot be re-armed: the file's header phase and body phase share one
 * connection, and the header timer is replaced by this one rather than by a
 * second signal.
 *
 * `stop()` is idempotent, because every exit path of the stream it guards calls
 * it.
 */
interface Deadline {
  race<T>(read: Promise<T>): Promise<T>;
  stop(): void;
}

function startDeadline(ms: number, abort: () => void): Deadline {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let reject!: (err: Error) => void;
  const expired = new Promise<never>((_, rejectPromise) => {
    reject = rejectPromise;
  });
  // A deadline that fires after its read has already finished must not surface
  // as an unhandled rejection. Attaching a handler here does not change what a
  // racing caller sees.
  void expired.catch(() => undefined);
  timer = setTimeout(() => {
    abort();
    reject(new Error("Upstream body timed out"));
  }, ms);
  return {
    race: (read) => Promise.race([read, expired]),
    stop: () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}

/**
 * Bound the body by size, and by time.
 *
 * `deadline.stop()` is called on every way out — completion, cancellation by
 * the client, a byte-cap overflow, or a read that rejects — because a timer
 * left armed after the response is finished would abort the connection out from
 * under whatever the client does next.
 */
function cappedPdfStream(
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
  deadline: Deadline,
): ReadableStream<Uint8Array> {
  let seen = 0;
  const reader = body.getReader();
  return new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await deadline.race(reader.read());
        if (done) {
          deadline.stop();
          controller.close();
          return;
        }
        seen += value.byteLength;
        if (seen > maxBytes) {
          deadline.stop();
          await reader.cancel().catch(() => undefined);
          controller.error(new Error("PDF too large"));
          return;
        }
        controller.enqueue(value);
      } catch (err) {
        deadline.stop();
        controller.error(err);
      }
    },
    cancel(reason) {
      deadline.stop();
      return reader.cancel(reason);
    },
  });
}

async function readPrefix(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  minBytes: number,
  maxBytes: number,
  deadline: Deadline,
): Promise<{ head: Uint8Array; rest: ReadableStream<Uint8Array> } | null> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  // Fill up to the magic window so `%PDF` offset past the first TLS record still
  // sniffs correctly. `minBytes` is only the empty-body floor.
  while (total < maxBytes) {
    const { done, value } = await deadline.race(reader.read());
    if (done) break;
    if (!value.byteLength) continue;
    chunks.push(value);
    total += value.byteLength;
  }
  if (total < minBytes) {
    await reader.cancel().catch(() => undefined);
    return null;
  }
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

/**
 * Timeout overrides.
 *
 * Exists so a test can watch a deadline actually fire without waiting thirty
 * seconds for it — the rule is about ordering, not about the number.
 */
export interface PdfProxyTimeouts {
  headerTimeoutMs?: number;
  bodyTimeoutMs?: number;
}

/** Core proxy logic (auth is enforced by the route before this runs). */
export async function proxyAllowlistedPdf(
  startUrl: string,
  timeouts: PdfProxyTimeouts = {},
): Promise<Response> {
  const headerTimeoutMs = timeouts.headerTimeoutMs ?? HEADER_TIMEOUT_MS;
  const bodyTimeoutMs = timeouts.bodyTimeoutMs ?? BODY_TIMEOUT_MS;
  let current = startUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isAllowedPdfProxyUrl(current)) {
      return NextResponse.json({ error: "URL host is not allowed for PDF proxy" }, { status: 400 });
    }
    // One controller per hop, armed for the headers and then for the body.
    // Aborting it tears the connection down, not just the read.
    const hopAbort = new AbortController();
    const headerTimer = setTimeout(() => hopAbort.abort(), headerTimeoutMs);
    let upstream: Response;
    try {
      upstream = await fetch(current, {
        redirect: "manual",
        cache: "no-store",
        signal: hopAbort.signal,
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

    // The body phase: one budget from the first byte of the magic window to the
    // last byte streamed, so neither half can be stalled. Armed here rather than
    // earlier so the refusal paths above do not leave a timer running.
    const deadline = startDeadline(bodyTimeoutMs, () => hopAbort.abort());

    let prefixed: Awaited<ReturnType<typeof readPrefix>>;
    try {
      prefixed = await readPrefix(upstream.body.getReader(), 5, PDF_MAGIC_WINDOW, deadline);
    } catch {
      // The deadline fired mid-read, or the connection dropped.
      deadline.stop();
      return NextResponse.json({ error: "Upstream body did not arrive in time" }, { status: 504 });
    }
    if (!prefixed) {
      deadline.stop();
      return NextResponse.json({ error: "Empty upstream body" }, { status: 415 });
    }
    if (!hasPdfMagic(prefixed.head)) {
      deadline.stop();
      void prefixed.rest.cancel().catch(() => undefined);
      return NextResponse.json({ error: "Upstream is not a PDF" }, { status: 415 });
    }

    return new NextResponse(
      cappedPdfStream(prefixed.rest, PDF_PROXY_MAX_BYTES, deadline),
      {
        status: 200,
        headers: pdfResponseHeaders(),
      },
    );
  }

  return NextResponse.json({ error: "Too many redirects" }, { status: 400 });
}

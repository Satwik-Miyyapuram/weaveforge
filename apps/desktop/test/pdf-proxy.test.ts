import test from "node:test";
import assert from "node:assert/strict";
import { isPdfProxyRequest, proxyPdf, type PdfFetch } from "../src/pdf-proxy";

/**
 * The shell's copy of the reader's PDF proxy.
 *
 * The allowlist itself is `sanitize-reader-url`'s and tested there; these
 * cover what the shell adds — that nothing leaves for a host off the list,
 * that a redirect off the list is refused after the fact, and that only a
 * document that is actually a PDF reaches the renderer.
 */

const APP = "app://weaveforge";
const ARXIV = "https://arxiv.org/pdf/1706.03762";

function pdfBody(): Uint8Array {
  return new TextEncoder().encode("%PDF-1.4\n%fake\n%%EOF");
}

function answering(
  body: Uint8Array | string,
  init: { status?: number; type?: string; url?: string } = {},
) {
  const calls: string[] = [];
  const fetchFn: PdfFetch = (input) => {
    calls.push(input);
    const res = new Response(body as BodyInit, {
      status: init.status ?? 200,
      headers: { "content-type": init.type ?? "application/pdf" },
    });
    Object.defineProperty(res, "url", { value: init.url ?? String(input) });
    return Promise.resolve(res);
  };
  return { fetchFn, calls };
}

test("only the proxy path is the proxy", () => {
  assert.equal(isPdfProxyRequest(`${APP}/api/pdf-proxy?url=x`), true);
  assert.equal(isPdfProxyRequest(`${APP}/reader?url=x`), false);
});

test("a host off the allowlist is refused before anything is fetched", async () => {
  const { fetchFn, calls } = answering(pdfBody());
  const res = await proxyPdf(`${APP}/api/pdf-proxy?url=${encodeURIComponent("https://evil.example/a.pdf")}`, fetchFn);
  assert.equal(res.status, 400);
  assert.deepEqual(calls, []);
});

test("an allowlisted PDF comes back as one, without the upstream's headers", async () => {
  const { fetchFn, calls } = answering(pdfBody());
  const res = await proxyPdf(`${APP}/api/pdf-proxy?url=${encodeURIComponent(ARXIV)}`, fetchFn);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/pdf");
  assert.deepEqual(calls, [ARXIV]);
  assert.equal(new TextDecoder().decode(await res.arrayBuffer()).startsWith("%PDF"), true);
});

test("a redirect that leaves the allowlist is refused", async () => {
  const { fetchFn } = answering(pdfBody(), { url: "https://mirror.example/x.pdf" });
  const res = await proxyPdf(`${APP}/api/pdf-proxy?url=${encodeURIComponent(ARXIV)}`, fetchFn);
  assert.equal(res.status, 400);
});

test("an HTML landing page is not a PDF, whatever it is labelled", async () => {
  const labelled = answering("<html>abstract page</html>", { type: "text/html" });
  assert.equal((await proxyPdf(`${APP}/api/pdf-proxy?url=${encodeURIComponent(ARXIV)}`, labelled.fetchFn)).status, 415);
  const lying = answering("<html>abstract page</html>", { type: "application/pdf" });
  assert.equal((await proxyPdf(`${APP}/api/pdf-proxy?url=${encodeURIComponent(ARXIV)}`, lying.fetchFn)).status, 415);
});

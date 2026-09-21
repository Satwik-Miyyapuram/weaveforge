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

test("a typed address may be any https host, and is still held to being a PDF", async () => {
  const typed = `${APP}/api/pdf-proxy?url=${encodeURIComponent("https://repo.example/a.pdf")}&typed=1`;
  const { fetchFn, calls } = answering(pdfBody());
  const res = await proxyPdf(typed, fetchFn);
  assert.equal(res.status, 200);
  assert.deepEqual(calls, ["https://repo.example/a.pdf"]);

  const html = answering("<html>", { type: "text/html" });
  assert.equal((await proxyPdf(typed, html.fetchFn)).status, 415);
});

test("a typed address is still refused when it is not https", async () => {
  const { fetchFn, calls } = answering(pdfBody());
  for (const url of ["http://localhost:5432/x.pdf", "https://user:pw@repo.example/a.pdf", "file:///C:/a.pdf"]) {
    const res = await proxyPdf(`${APP}/api/pdf-proxy?url=${encodeURIComponent(url)}&typed=1`, fetchFn);
    assert.equal(res.status, 400, url);
  }
  assert.deepEqual(calls, []);
});

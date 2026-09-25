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

test("a typed address on a private or loopback host is refused before anything is fetched", async () => {
  for (const host of ["localhost", "127.0.0.1", "10.0.0.5", "172.20.1.1", "192.168.1.1", "169.254.169.254", "[::1]", "[fd00::1]", "[fe80::1]"]) {
    const { fetchFn, calls } = answering(pdfBody());
    const url = `${APP}/api/pdf-proxy?url=${encodeURIComponent(`https://${host}/a.pdf`)}&typed=1`;
    assert.equal((await proxyPdf(url, fetchFn)).status, 400, host);
    assert.deepEqual(calls, [], host);
  }
});

test("each redirect hop is checked before it is fetched", async () => {
  const calls: string[] = [];
  const fetchFn: PdfFetch = (input) => {
    calls.push(input);
    return Promise.resolve(new Response(null, { status: 302, headers: { location: "https://127.0.0.1/admin" } }));
  };
  const typed = `${APP}/api/pdf-proxy?url=${encodeURIComponent("https://repo.example/a.pdf")}&typed=1`;
  assert.equal((await proxyPdf(typed, fetchFn)).status, 400);
  assert.deepEqual(calls, ["https://repo.example/a.pdf"]);
});

test("a redirect within the allowlist is followed hop by hop", async () => {
  const calls: string[] = [];
  const fetchFn: PdfFetch = (input) => {
    calls.push(input);
    if (calls.length === 1) {
      return Promise.resolve(new Response(null, { status: 301, headers: { location: "/pdf/1706.03762v7" } }));
    }
    return Promise.resolve(new Response(pdfBody() as BodyInit, { headers: { "content-type": "application/pdf" } }));
  };
  const res = await proxyPdf(`${APP}/api/pdf-proxy?url=${encodeURIComponent(ARXIV)}`, fetchFn);
  assert.equal(res.status, 200);
  assert.deepEqual(calls, [ARXIV, "https://arxiv.org/pdf/1706.03762v7"]);
});

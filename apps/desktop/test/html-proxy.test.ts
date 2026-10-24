import test from "node:test";
import assert from "node:assert/strict";
import { isHtmlProxyRequest, proxyHtml } from "../src/html-proxy";
import type { ProxyFetch } from "../src/proxy-shared";

/**
 * The shell's HTML relay: https only, before and after redirects; only a web
 * page comes back, as text, never as a document; and the address it ended at
 * travels with it so relative links resolve against the right page.
 */

const APP = "app://weaveforge";

function answering(body: BodyInit, init: { status?: number; type?: string; url?: string } = {}) {
  const calls: string[] = [];
  const fetchFn: ProxyFetch = (input) => {
    calls.push(input);
    const res = new Response(body, {
      status: init.status ?? 200,
      headers: { "content-type": init.type ?? "text/html; charset=utf-8" },
    });
    Object.defineProperty(res, "url", { value: init.url ?? String(input) });
    return Promise.resolve(res);
  };
  return { fetchFn, calls };
}

const relay = (url: string) => `${APP}/api/html-proxy?url=${encodeURIComponent(url)}`;

test("only the relay path is the relay", () => {
  assert.equal(isHtmlProxyRequest(relay("https://arxiv.org/html/1")), true);
  assert.equal(isHtmlProxyRequest(`${APP}/api/pdf-proxy?url=x`), false);
});

test("a page comes back as text, with the address it ended at", async () => {
  const { fetchFn } = answering("<html><body>Hello</body></html>", { url: "https://arxiv.org/html/2101.00001v2" });
  const res = await proxyHtml(relay("https://arxiv.org/html/2101.00001"), fetchFn);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /^text\/plain/);
  assert.equal(res.headers.get("x-final-url"), "https://arxiv.org/html/2101.00001v2");
  assert.equal(await res.text(), "<html><body>Hello</body></html>");
});

test("the declared charset is honoured", async () => {
  const latin1 = new Uint8Array([0x42, 0x61, 0x6c, 0x6c, 0xe9]); // "Ballé" in latin1
  const { fetchFn } = answering(latin1, { type: "text/html; charset=iso-8859-1" });
  const res = await proxyHtml(relay("https://a.org/p"), fetchFn);
  assert.equal(await res.text(), "Ballé");
});

test("nothing but https leaves, and a redirect off https is refused", async () => {
  const { fetchFn, calls } = answering("x");
  assert.equal((await proxyHtml(relay("http://localhost:8080/"), fetchFn)).status, 400);
  assert.equal((await proxyHtml(`${APP}/api/html-proxy`, fetchFn)).status, 400);
  assert.equal(calls.length, 0);
  const redirected = answering("x", { url: "http://intranet/secret" });
  assert.equal((await proxyHtml(relay("https://a.org/p"), redirected.fetchFn)).status, 400);
});

test("a PDF, an error or a network failure is not a page", async () => {
  assert.equal((await proxyHtml(relay("https://a.org/p"), answering("%PDF", { type: "application/pdf" }).fetchFn)).status, 415);
  assert.equal((await proxyHtml(relay("https://a.org/p"), answering("no", { status: 404 }).fetchFn)).status, 502);
  const failing: ProxyFetch = () => Promise.reject(new Error("offline"));
  assert.equal((await proxyHtml(relay("https://a.org/p"), failing)).status, 502);
});

test("a private or loopback host is refused before anything is fetched", async () => {
  for (const host of ["localhost", "127.0.0.1", "127.1", "10.0.0.1", "172.20.1.1", "192.168.1.1", "169.254.169.254", "[::1]", "[::ffff:127.0.0.1]", "[fd00::1]", "[fe80::1]"]) {
    const { fetchFn, calls } = answering("x");
    assert.equal((await proxyHtml(relay(`https://${host}/p`), fetchFn)).status, 400, host);
    assert.deepEqual(calls, [], host);
  }
});

test("each redirect hop is checked before it is fetched", async () => {
  const calls: string[] = [];
  const fetchFn: ProxyFetch = (input) => {
    calls.push(input);
    return Promise.resolve(new Response(null, { status: 302, headers: { location: "https://169.254.169.254/latest" } }));
  };
  assert.equal((await proxyHtml(relay("https://a.org/p"), fetchFn)).status, 400);
  assert.deepEqual(calls, ["https://a.org/p"]);
});

test("a fetch that ended on a private host is refused", async () => {
  const { fetchFn } = answering("<html></html>", { url: "https://192.168.0.1/admin" });
  assert.equal((await proxyHtml(relay("https://a.org/p"), fetchFn)).status, 400);
});

test("a public redirect is followed hop by hop, and the page names where it ended", async () => {
  const calls: string[] = [];
  const fetchFn: ProxyFetch = (input) => {
    calls.push(input);
    if (calls.length === 1) {
      return Promise.resolve(new Response(null, { status: 301, headers: { location: "/html/2101.00001v2" } }));
    }
    return Promise.resolve(new Response("<p>ok</p>", { headers: { "content-type": "text/html" } }));
  };
  const res = await proxyHtml(relay("https://arxiv.org/html/2101.00001"), fetchFn);
  assert.equal(res.status, 200);
  assert.deepEqual(calls, ["https://arxiv.org/html/2101.00001", "https://arxiv.org/html/2101.00001v2"]);
  assert.equal(res.headers.get("x-final-url"), "https://arxiv.org/html/2101.00001v2");
});

test("an endless redirect chain stops", async () => {
  let n = 0;
  const fetchFn: ProxyFetch = () => {
    n++;
    return Promise.resolve(new Response(null, { status: 302, headers: { location: `https://a.org/${n}` } }));
  };
  assert.equal((await proxyHtml(relay("https://a.org/0"), fetchFn)).status, 502);
  assert.ok(n <= 6, `fetched ${n} times`);
});

test("a page past the cap with no content-length is refused while reading", async () => {
  let cancelled = false;
  const chunk = new Uint8Array(1024 * 1024);
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(chunk);
    },
    cancel() {
      cancelled = true;
    },
  });
  const fetchFn: ProxyFetch = () => Promise.resolve(new Response(body, { headers: { "content-type": "text/html" } }));
  assert.equal((await proxyHtml(relay("https://a.org/p"), fetchFn)).status, 413);
  assert.equal(cancelled, true);
});

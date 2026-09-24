import { test } from "node:test";
import assert from "node:assert/strict";
import { GET } from "../route";
import { proxyAllowlistedHtml, proxyAnyHtml } from "../_proxy";

/**
 * The web server's HTML relay: allowlisted hosts on every hop, only a web page
 * back and only as text, a byte cap, and a deadline over the whole exchange.
 */

function page(body: BodyInit, init: { status?: number; type?: string; location?: string } = {}): Response {
  const headers: Record<string, string> = { "content-type": init.type ?? "text/html; charset=utf-8" };
  if (init.location) headers.location = init.location;
  return new Response(body, { status: init.status ?? 200, headers });
}

test("html-proxy: a page on an open-access host comes back as text", async () => {
  const res = await proxyAllowlistedHtml("https://arxiv.org/html/2101.00001", {
    fetchFn: async () => page("<p>full text</p>"),
  });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /^text\/plain/);
  assert.equal(res.headers.get("x-final-url"), "https://arxiv.org/html/2101.00001");
  assert.equal(await res.text(), "<p>full text</p>");
});

test("html-proxy: every redirect hop is checked against the list", async () => {
  const asked: string[] = [];
  const res = await proxyAllowlistedHtml("https://arxiv.org/html/1", {
    fetchFn: async (input) => {
      asked.push(String(input));
      return page("", { status: 302, location: "https://evil.test/steal" });
    },
  });
  assert.equal(res.status, 400);
  assert.deepEqual(asked, ["https://arxiv.org/html/1"]);

  const followed = await proxyAllowlistedHtml("https://arxiv.org/html/1", {
    fetchFn: async (input) =>
      String(input).endsWith("/1") ? page("", { status: 301, location: "/html/1v2" }) : page("ok"),
  });
  assert.equal(followed.status, 200);
  assert.equal(followed.headers.get("x-final-url"), "https://arxiv.org/html/1v2");
});

test("html-proxy: not a page, too large, an upstream error", async () => {
  const pdf = await proxyAllowlistedHtml("https://arxiv.org/pdf/1", {
    fetchFn: async () => page("%PDF", { type: "application/pdf" }),
  });
  assert.equal(pdf.status, 415);
  const big = await proxyAllowlistedHtml("https://arxiv.org/html/1", {
    fetchFn: async () => page(new Uint8Array(16 * 1024 * 1024)),
  });
  assert.equal(big.status, 413);
  const missing = await proxyAllowlistedHtml("https://arxiv.org/html/1", {
    fetchFn: async () => page("gone", { status: 404 }),
  });
  assert.equal(missing.status, 502);
  assert.equal(((await missing.json()) as { error: string }).error, "Upstream returned 404");
});

test("html-proxy: a host that never answers is cut off by the deadline", async () => {
  const res = await proxyAllowlistedHtml("https://arxiv.org/html/1", {
    deadlineMs: 20,
    fetchFn: (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      }),
  });
  assert.equal(res.status, 504);
});

test("html-proxy: a blog on no list goes through the address-guarded fetch", async () => {
  let asked: { url: string; accept?: string } | undefined;
  const res = await proxyAnyHtml("https://lilianweng.github.io/posts/agent/", async (url, options) => {
    asked = { url, accept: options.accept };
    return {
      ok: true,
      url: "https://lilianweng.github.io/posts/agent/",
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: new TextEncoder().encode("<article>post</article>"),
    };
  });
  assert.equal(res.status, 200);
  assert.equal(asked?.url, "https://lilianweng.github.io/posts/agent/");
  assert.match(asked?.accept ?? "", /text\/html/);
  assert.equal(res.headers.get("x-final-url"), "https://lilianweng.github.io/posts/agent/");
  assert.equal(await res.text(), "<article>post</article>");
});

test("html-proxy: the guarded fetch's refusal and a non-page answer are passed on", async () => {
  const refused = await proxyAnyHtml("http://10.0.0.1/", async () => ({
    ok: false,
    kind: "refused",
    status: 400,
    message: "That address is not allowed",
  }));
  assert.equal(refused.status, 400);
  assert.equal(((await refused.json()) as { error: string }).error, "That address is not allowed");

  const pdf = await proxyAnyHtml("https://example.org/a.pdf", async () => ({
    ok: true,
    url: "https://example.org/a.pdf",
    status: 200,
    contentType: "application/pdf",
    body: new Uint8Array([37, 80, 68, 70]),
  }));
  assert.equal(pdf.status, 415);
});

test("html-proxy: GET requires authentication, for a listed host and any other", async () => {
  for (const target of ["https://arxiv.org/html/2101.00001", "https://example.org/blog/post"]) {
    const res = await GET(new Request("http://localhost/api/html-proxy?url=" + encodeURIComponent(target)));
    assert.equal(res.status, 401, target);
  }
});

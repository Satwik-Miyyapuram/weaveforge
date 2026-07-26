import { test } from "node:test";
import assert from "node:assert/strict";
import { GET, isAllowedPdfProxyUrl } from "../route";

function stubFetch(handler: (url: string) => Response) {
  const original = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request) => {
    const reqUrl = String(input);
    const res = handler(reqUrl);
    // Pretend the final URL is the request URL (no off-allowlist redirect).
    Object.defineProperty(res, "url", { value: reqUrl });
    return Promise.resolve(res);
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

test("pdf-proxy: allowlist accepts arxiv/openreview https only", () => {
  assert.equal(isAllowedPdfProxyUrl("https://arxiv.org/pdf/1706.03762"), true);
  assert.equal(isAllowedPdfProxyUrl("https://openreview.net/pdf?id=x"), true);
  assert.equal(isAllowedPdfProxyUrl("http://arxiv.org/pdf/1706.03762"), false);
  assert.equal(isAllowedPdfProxyUrl("https://evil.test/pdf"), false);
  assert.equal(isAllowedPdfProxyUrl("javascript:alert(1)"), false);
});

test("pdf-proxy: 400 when url is missing or not allowlisted", async () => {
  const missing = await GET(new Request("http://localhost/api/pdf-proxy"));
  assert.equal(missing.status, 400);
  const bad = await GET(
    new Request("http://localhost/api/pdf-proxy?url=" + encodeURIComponent("https://evil.test/a.pdf")),
  );
  assert.equal(bad.status, 400);
});

test("pdf-proxy: streams an allowlisted PDF", async () => {
  const restore = stubFetch((url) => {
    assert.match(url, /arxiv\.org\/pdf\/1706\.03762/);
    return new Response("%PDF-1.4", {
      status: 200,
      headers: { "content-type": "application/pdf" },
    });
  });
  try {
    const res = await GET(
      new Request(
        "http://localhost/api/pdf-proxy?url=" +
          encodeURIComponent("https://arxiv.org/pdf/1706.03762"),
      ),
    );
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /pdf/);
    assert.equal(await res.text(), "%PDF-1.4");
  } finally {
    restore();
  }
});

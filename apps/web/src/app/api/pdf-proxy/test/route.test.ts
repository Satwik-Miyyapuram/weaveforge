import { test } from "node:test";
import assert from "node:assert/strict";
import { GET, isAllowedPdfProxyUrl } from "../route";

function stubFetch(handler: (url: string) => Response) {
  const original = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request) => {
    const reqUrl = String(input);
    const res = handler(reqUrl);
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
    return new Response("%PDF-1.4 hello", {
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
    assert.equal(res.headers.get("content-type"), "application/pdf");
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.match(res.headers.get("content-disposition") ?? "", /attachment/);
    assert.equal(await res.text(), "%PDF-1.4 hello");
  } finally {
    restore();
  }
});

test("pdf-proxy: rejects HTML on an allowlisted host", async () => {
  const restore = stubFetch(() =>
    new Response("<script>alert(1)</script>", {
      status: 200,
      headers: { "content-type": "text/html" },
    }),
  );
  try {
    const res = await GET(
      new Request(
        "http://localhost/api/pdf-proxy?url=" +
          encodeURIComponent("https://arxiv.org/html/1706.03762"),
      ),
    );
    assert.equal(res.status, 415);
  } finally {
    restore();
  }
});

test("pdf-proxy: rejects bodies that fail the %PDF magic sniff", async () => {
  const restore = stubFetch(() =>
    new Response("<html>not a pdf</html>", {
      status: 200,
      headers: { "content-type": "application/pdf" },
    }),
  );
  try {
    const res = await GET(
      new Request(
        "http://localhost/api/pdf-proxy?url=" +
          encodeURIComponent("https://arxiv.org/pdf/fake"),
      ),
    );
    assert.equal(res.status, 415);
  } finally {
    restore();
  }
});

test("pdf-proxy: refuses off-allowlist redirects before following", async () => {
  const seen: string[] = [];
  const restore = stubFetch((url) => {
    seen.push(url);
    return new Response(null, {
      status: 302,
      headers: { location: "http://169.254.169.254/latest/meta-data/" },
    });
  });
  try {
    const res = await GET(
      new Request(
        "http://localhost/api/pdf-proxy?url=" +
          encodeURIComponent("https://arxiv.org/ct?url=http://evil"),
      ),
    );
    assert.equal(res.status, 400);
    assert.deepEqual(seen, ["https://arxiv.org/ct?url=http://evil"]);
  } finally {
    restore();
  }
});

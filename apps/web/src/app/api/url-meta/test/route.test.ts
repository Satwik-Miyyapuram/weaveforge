import { test } from "node:test";
import assert from "node:assert/strict";
import { GET } from "../route";

function req(url: string): Request {
  return new Request(url);
}

/** Install a fake global fetch for one test; returns a restore fn. */
function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const original = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) =>
    Promise.resolve(handler(String(input), init))) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

test("url-meta: 400 when url param is missing", async () => {
  const res = await GET(req("http://localhost/api/url-meta"));
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /url is required/);
});

test("url-meta: 400 on an unparseable url", async () => {
  const res = await GET(req("http://localhost/api/url-meta?url=not a url"));
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /invalid url/);
});

test("url-meta: 400 rejects non-http(s) protocols (no SSRF to file:/ftp:)", async () => {
  const res = await GET(req(`http://localhost/api/url-meta?url=${encodeURIComponent("file:///etc/passwd")}`));
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /http\(s\)/);
});

test("url-meta: resolves a DOI in the URL via Crossref", async () => {
  const restore = stubFetch((url) => {
    assert.match(url, /api\.crossref\.org\/works\//);
    return Response.json({
      message: {
        title: ["A Great  Paper"],
        author: [{ given: "Ada", family: "Lovelace" }, { name: "Alan Turing" }],
        issued: { "date-parts": [[2021, 5]] },
        "container-title": ["J. Testing"],
        DOI: "10.1000/xyz123",
        URL: "https://doi.org/10.1000/xyz123",
      },
    });
  });
  try {
    const target = "https://dl.acm.org/doi/10.1000/xyz123";
    const res = await GET(req(`http://localhost/api/url-meta?url=${encodeURIComponent(target)}`));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.title, "A Great Paper");
    assert.deepEqual(body.authors, ["Ada Lovelace", "Alan Turing"]);
    assert.equal(body.year, 2021);
    assert.equal(body.venue, "J. Testing");
    assert.equal(body.doi, "10.1000/xyz123");
  } finally {
    restore();
  }
});

test("url-meta: 404 when Crossref has no record for the DOI", async () => {
  const restore = stubFetch(() => new Response("nope", { status: 404 }));
  try {
    const target = "https://dl.acm.org/doi/10.5555/unregistered";
    const res = await GET(req(`http://localhost/api/url-meta?url=${encodeURIComponent(target)}`));
    assert.equal(res.status, 404);
    assert.match((await res.json()).error, /not found in Crossref/);
  } finally {
    restore();
  }
});

test("url-meta: scrapes citation meta tags from an HTML page", async () => {
  const html = `<html><head>
    <meta name="citation_title" content="Attention Is All You Need">
    <meta name="citation_author" content="Vaswani, Ashish">
    <meta name="citation_author" content="Shazeer, Noam">
    <meta name="citation_publication_date" content="2017/06/12">
    <meta name="citation_journal_title" content="NeurIPS">
    <meta name="citation_doi" content="https://doi.org/10.5555/attn">
    <meta name="citation_abstract" content="The dominant   models.">
  </head></html>`;
  const restore = stubFetch(() => new Response(html, { status: 200 }));
  try {
    const target = "https://arxiv.org/abs/1706.03762";
    const res = await GET(req(`http://localhost/api/url-meta?url=${encodeURIComponent(target)}`));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.title, "Attention Is All You Need");
    assert.deepEqual(body.authors, ["Vaswani, Ashish", "Shazeer, Noam"]);
    assert.equal(body.year, 2017);
    assert.equal(body.venue, "NeurIPS");
    assert.equal(body.doi, "10.5555/attn");
    assert.equal(body.arxivId, "1706.03762");
    assert.equal(body.abstract, "The dominant models.");
  } finally {
    restore();
  }
});

test("url-meta: passes through an upstream non-OK status with a hint", async () => {
  const restore = stubFetch(() => new Response("forbidden", { status: 403 }));
  try {
    const target = "https://example.com/paper";
    const res = await GET(req(`http://localhost/api/url-meta?url=${encodeURIComponent(target)}`));
    assert.equal(res.status, 403);
    assert.match((await res.json()).error, /blocked automated access/);
  } finally {
    restore();
  }
});

test("url-meta: arXiv URLs resolve through the arXiv API, not the abs page", async () => {
  const restore = stubFetch((url) => {
    assert.match(url, /export\.arxiv\.org\/api\/query/);
    return new Response(
      `<feed><entry><title>BISCUIT: Causal Representation Learning</title>` +
        `<summary>We study binary interactions.</summary>` +
        `<published>2023-06-01T00:00:00Z</published>` +
        `<author><name>Phillip Lippe</name></author>` +
        `<arxiv:doi>10.1000/biscuit</arxiv:doi></entry></feed>`,
    );
  });
  try {
    const target = "https://arxiv.org/abs/2306.09643";
    const res = await GET(req(`http://localhost/api/url-meta?url=${encodeURIComponent(target)}`));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.title, "BISCUIT: Causal Representation Learning");
    assert.equal(body.arxivId, "2306.09643");
    assert.equal(body.year, 2023);
    assert.deepEqual(body.authors, ["Phillip Lippe"]);
    assert.equal(body.abstract, "We study binary interactions.");
  } finally {
    restore();
  }
});

test("url-meta: 422 on a bot wall rather than importing its <title>", async () => {
  const restore = stubFetch(() =>
    new Response("<html><head><title>Client Challenge</title></head></html>", {
      headers: { "content-type": "text/html" },
    }),
  );
  try {
    const target = "https://www.nature.com/articles/s41586-021-03819-2";
    const res = await GET(req(`http://localhost/api/url-meta?url=${encodeURIComponent(target)}`));
    assert.equal(res.status, 422);
    assert.match((await res.json()).error, /blocked automated access/);
  } finally {
    restore();
  }
});

test("url-meta: 422 when a page has no citation metadata at all", async () => {
  const restore = stubFetch(() =>
    new Response("<html><head><title>Some blog post</title></head></html>", {
      headers: { "content-type": "text/html" },
    }),
  );
  try {
    const target = "https://example.com/post";
    const res = await GET(req(`http://localhost/api/url-meta?url=${encodeURIComponent(target)}`));
    assert.equal(res.status, 422);
    assert.match((await res.json()).error, /No citation metadata/);
  } finally {
    restore();
  }
});

test("url-meta: a scheme-less host is fetched over https", async () => {
  let seen = "";
  const restore = stubFetch((url) => {
    seen = url;
    return new Response(
      '<html><head><meta name="citation_title" content="Scheme Less"/></head></html>',
      { headers: { "content-type": "text/html" } },
    );
  });
  try {
    const res = await GET(req(`http://localhost/api/url-meta?url=${encodeURIComponent("example.com/paper")}`));
    assert.equal(res.status, 200);
    assert.equal((await res.json()).title, "Scheme Less");
    assert.equal(seen, "https://example.com/paper");
  } finally {
    restore();
  }
});

test("url-meta: an explicit http target is kept as http, not upgraded", async () => {
  let seen = "";
  const restore = stubFetch((url) => {
    seen = url;
    return new Response(
      '<html><head><meta name="citation_title" content="Plain HTTP"/></head></html>',
      { headers: { "content-type": "text/html" } },
    );
  });
  try {
    const res = await GET(req(`http://localhost/api/url-meta?url=${encodeURIComponent("http://example.com/paper")}`));
    assert.equal(res.status, 200);
    assert.equal(seen, "http://example.com/paper");
  } finally {
    restore();
  }
});

test("url-meta: the scheme-less fallback still cannot smuggle in file:", async () => {
  const res = await GET(req(`http://localhost/api/url-meta?url=${encodeURIComponent("file:///etc/passwd")}`));
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /http\(s\)/);
});

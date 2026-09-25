import { test } from "node:test";
import assert from "node:assert/strict";
import { GET } from "../route";
import { resolveUrlMetadata } from "../_meta";
import { stubFetch, stubOutboundFetch } from "@/lib/test/stub-fetch";

/**
 * The route is authentication and one line of shaping; what may be fetched and
 * what is read out of it is `_meta`, which these drive directly. Splitting them
 * is what lets the address-guard cases below run without a Supabase session —
 * before, they could only have run by leaving the route open.
 */

/** Calls the metadata logic the way the route would, given a query string. */
function GET_META(url: string) {
  return resolveUrlMetadata(new URL(url).searchParams.get("url"));
}

function req(url: string): Request {
  return new Request(url);
}

/**
 * Stub both halves of the resolver.
 *
 * It talks to two kinds of thing: the page itself through `safe-fetch` (which no
 * longer calls `fetch` — it dials the address the guard vetted), and the DOI and
 * arXiv APIs through plain `fetch`. A test that stubs one and not the other
 * silently reaches the live API for the other; three of these were passing
 * against real Crossref and arXiv responses before this, which is worse than
 * failing, because it cannot be run offline.
 */
function stubBoth(handler: (url: string) => Response | Promise<Response>) {
  const outbound = stubOutboundFetch(handler);
  const global = stubFetch((url) => handler(url));
  return {
    restore: () => {
      outbound.restore();
      global.restore();
    },
  };
}
test("url-meta: 400 when url param is missing", async () => {
  const res = await GET_META("http://localhost/api/url-meta");
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /url is required/);
});

test("url-meta: 400 on an unparseable url", async () => {
  const res = await GET_META("http://localhost/api/url-meta?url=not a url");
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /invalid url/);
});

test("url-meta: 400 rejects non-http(s) protocols (no SSRF to file:/ftp:)", async () => {
  const res = await GET_META(`http://localhost/api/url-meta?url=${encodeURIComponent("file:///etc/passwd")}`);
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /http\(s\)/);
});

test("url-meta: refuses a private address without requesting it", async () => {
  // This route used to `fetch(..., { redirect: "follow" })` with no address
  // check at all, which made it a way to reach anything the server could.
  let requested = false;
  const { restore } = stubBoth(() => {
    requested = true;
    return new Response("should not happen");
  });
  try {
    for (const target of [
      "http://169.254.169.254/latest/meta-data/",
      "http://127.0.0.1:8000/admin",
      "http://10.0.0.5/",
      "http://[::1]/",
      "http://localhost/",
    ]) {
      const res = await GET_META(`http://localhost/api/url-meta?url=${encodeURIComponent(target)}`);
      assert.equal(res.status, 400, target);
    }
    assert.equal(requested, false, "no request should have left the server");
  } finally {
    restore();
  }
});

test("url-meta: refuses a URL carrying credentials, and an odd port", async () => {
  for (const target of ["http://user:pass@example.com/", "http://example.com:6379/"]) {
    const res = await GET_META(`http://localhost/api/url-meta?url=${encodeURIComponent(target)}`);
    assert.equal(res.status, 400, target);
  }
});

test("url-meta: resolves a DOI in the URL via Crossref", async () => {
  const { restore } = stubBoth((url) => {
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
    const res = await GET_META(`http://localhost/api/url-meta?url=${encodeURIComponent(target)}`);
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
  const { restore } = stubBoth(() => new Response("nope", { status: 404 }));
  try {
    const target = "https://dl.acm.org/doi/10.5555/unregistered";
    const res = await GET_META(`http://localhost/api/url-meta?url=${encodeURIComponent(target)}`);
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
  const { restore } = stubBoth(() => new Response(html, { status: 200 }));
  try {
    const target = "https://arxiv.org/abs/1706.03762";
    const res = await GET_META(`http://localhost/api/url-meta?url=${encodeURIComponent(target)}`);
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
  const { restore } = stubBoth(() => new Response("forbidden", { status: 403 }));
  try {
    const target = "https://example.com/paper";
    const res = await GET_META(`http://localhost/api/url-meta?url=${encodeURIComponent(target)}`);
    assert.equal(res.status, 403);
    assert.match((await res.json()).error, /blocked automated access/);
  } finally {
    restore();
  }
});

test("url-meta: arXiv URLs resolve through the arXiv API, not the abs page", async () => {
  const { restore } = stubBoth((url) => {
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
    const res = await GET_META(`http://localhost/api/url-meta?url=${encodeURIComponent(target)}`);
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
  const { restore } = stubBoth(() =>
    new Response("<html><head><title>Client Challenge</title></head></html>", {
      headers: { "content-type": "text/html" },
    }),
  );
  try {
    const target = "https://www.nature.com/articles/s41586-021-03819-2";
    const res = await GET_META(`http://localhost/api/url-meta?url=${encodeURIComponent(target)}`);
    assert.equal(res.status, 422);
    assert.match((await res.json()).error, /blocked automated access/);
  } finally {
    restore();
  }
});

test("url-meta: 422 when a page is neither a paper nor an article", async () => {
  const { restore } = stubBoth(() =>
    new Response("<html><head><title>Welcome to my site</title></head></html>", {
      headers: { "content-type": "text/html" },
    }),
  );
  try {
    const target = "https://example.com/";
    const res = await GET_META(`http://localhost/api/url-meta?url=${encodeURIComponent(target)}`);
    assert.equal(res.status, 422);
    assert.match((await res.json()).error, /does not look like a paper or an article/);
  } finally {
    restore();
  }
});

test("url-meta: a blog post that says it is an article is imported", async () => {
  // Research blogs and essays carry no citation tags; they say what they are
  // through JSON-LD or OpenGraph, and they are the paper.
  const page = `<html><head>
    <title>LLM Powered Autonomous Agents | Lil'Log</title>
    <meta property="og:site_name" content="Lil'Log">
    <meta property="og:type" content="article">
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"BlogPosting",
      "headline":"LLM Powered Autonomous Agents","author":{"@type":"Person","name":"Lilian Weng"},
      "datePublished":"2023-06-23T00:00:00Z","description":"Building agents with LLM as the core controller."}</script>
  </head><body><article>…</article></body></html>`;
  const { restore } = stubBoth(() => new Response(page, { headers: { "content-type": "text/html" } }));
  try {
    const target = "https://lilianweng.github.io/posts/2023-06-23-agent/";
    const res = await GET_META(`http://localhost/api/url-meta?url=${encodeURIComponent(target)}`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.title, "LLM Powered Autonomous Agents");
    assert.deepEqual(body.authors, ["Lilian Weng"]);
    assert.equal(body.year, 2023);
    assert.equal(body.venue, "Lil'Log");
  } finally {
    restore();
  }
});

test("url-meta: a scheme-less host is fetched over https", async () => {
  let seen = "";
  const { restore } = stubBoth((url) => {
    seen = url;
    return new Response(
      '<html><head><meta name="citation_title" content="Scheme Less"/></head></html>',
      { headers: { "content-type": "text/html" } },
    );
  });
  try {
    const res = await GET_META(`http://localhost/api/url-meta?url=${encodeURIComponent("example.com/paper")}`);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).title, "Scheme Less");
    assert.equal(seen, "https://example.com/paper");
  } finally {
    restore();
  }
});

test("url-meta: an explicit http target is kept as http, not upgraded", async () => {
  let seen = "";
  const { restore } = stubBoth((url) => {
    seen = url;
    return new Response(
      '<html><head><meta name="citation_title" content="Plain HTTP"/></head></html>',
      { headers: { "content-type": "text/html" } },
    );
  });
  try {
    const res = await GET_META(`http://localhost/api/url-meta?url=${encodeURIComponent("http://example.com/paper")}`);
    assert.equal(res.status, 200);
    assert.equal(seen, "http://example.com/paper");
  } finally {
    restore();
  }
});

test("url-meta: the scheme-less fallback still cannot smuggle in file:", async () => {
  const res = await GET_META(`http://localhost/api/url-meta?url=${encodeURIComponent("file:///etc/passwd")}`);
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /http\(s\)/);
});

/**
 * The gate itself. Everything above proves the fetch is guarded about *where*
 * it may go; these prove it is guarded about *who* may send it there.
 */
test("url-meta: no token is a 401, and nothing is requested", async () => {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = ((input: string | URL | Request) => {
    calls.push(String(input));
    return Promise.resolve(new Response("should not happen", { status: 500 }));
  }) as typeof fetch;
  try {
    const res = await GET(req(`http://localhost/api/url-meta?url=${encodeURIComponent("https://example.com/p")}`));
    assert.equal(res.status, 401);
    assert.deepEqual(calls, []);
  } finally {
    globalThis.fetch = original;
  }
});

test("url-meta: a token that does not check out never reaches the target", async () => {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = ((input: string | URL | Request) => {
    calls.push(String(input));
    return Promise.resolve(new Response("{}", { status: 401 }));
  }) as typeof fetch;
  try {
    const res = await GET(
      new Request(`http://localhost/api/url-meta?url=${encodeURIComponent("https://example.com/p")}`, {
        headers: { authorization: "Bearer nonsense" },
      }),
    );
    assert.notEqual(res.status, 200);
    // Whatever the auth check itself did, the visitor's address was never asked for.
    assert.ok(calls.every((call) => !call.includes("example.com")));
  } finally {
    globalThis.fetch = original;
  }
});

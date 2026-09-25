import { test } from "node:test";
import assert from "node:assert/strict";
import { GET } from "../route";
import { isAllowedPdfProxyUrl, proxyAllowlistedPdf } from "../_proxy";
import { stubFetch } from "@/lib/test/stub-fetch";


test("pdf-proxy: allowlist accepts arxiv/openreview https only", () => {
  assert.equal(isAllowedPdfProxyUrl("https://arxiv.org/pdf/1706.03762"), true);
  assert.equal(isAllowedPdfProxyUrl("https://openreview.net/pdf?id=x"), true);
  assert.equal(isAllowedPdfProxyUrl("http://arxiv.org/pdf/1706.03762"), false);
  assert.equal(isAllowedPdfProxyUrl("https://evil.test/pdf"), false);
  assert.equal(isAllowedPdfProxyUrl("javascript:alert(1)"), false);
});

/**
 * The open-access hosts, and the lookalikes that must not pass.
 *
 * The list was arXiv and OpenReview only, so "index my library" reported *"the
 * proxy produced no bytes"* for every paper on a host it would not fetch — the
 * papers that are freely readable being the ones refused. These are the hosts the
 * reader's own library actually has, plus the repositories a literature review
 * reaches for.
 */
test("pdf-proxy: open-access repositories and publishers are allowed", () => {
  const allowed = [
    // Preprints and repositories.
    "https://biorxiv.org/content/10.1101/2020.01.01.000001v1.full.pdf",
    "https://www.medrxiv.org/content/10.1101/2020.01.01.000001v1.full.pdf",
    "https://chemrxiv.org/engage/api-gateway/chemrxiv/assets/x.pdf",
    "https://pmc.ncbi.nlm.nih.gov/articles/PMC1234567/pdf/x.pdf",
    "https://europepmc.org/articles/PMC1234567?pdf=render",
    // Open-access publishers.
    "https://journals.plos.org/plosone/article/file?id=x&type=printable",
    "https://elifesciences.org/articles/12345.pdf",
    "https://www.frontiersin.org/articles/10.3389/x/pdf",
    "https://www.mdpi.com/1234-5678/9/1/1/pdf",
    "https://olh.openlibhums.org/article/id/1234/galley/1/download/",
    // A publisher's dedicated open-access infrastructure.
    "https://link.springer.com/content/pdf/10.1007/x.pdf",
    "https://www.springeropen.com/articles/10.1186/x.pdf",
  ];
  for (const url of allowed) {
    assert.equal(isAllowedPdfProxyUrl(url), true, `${url} should be allowed`);
  }
});

test("pdf-proxy: a lookalike host cannot pass the allowlist", () => {
  // The check compares `hostname` exactly against a set, so a domain that merely
  // *contains* an allowed one is not reachable. Pinned because a future change to
  // a suffix match would quietly turn the proxy into a fetch-anything relay.
  const refused = [
    "https://evil-arxiv.org/pdf/1706.03762",
    "https://arxiv.org.evil.test/pdf/1706.03762",
    "https://notplos.org/x.pdf",
    "https://plos.org.evil.test/x.pdf",
    "https://ncbi.nlm.nih.gov.evil.test/x.pdf",
  ];
  for (const url of refused) {
    assert.equal(isAllowedPdfProxyUrl(url), false, `${url} should be refused`);
  }
});

test("pdf-proxy: mostly-paywalled publishers are not promised", () => {
  /*
   * A deliberate absence, pinned so it is not "helpfully" added later.
   *
   * The proxy fetches anonymously, so a host whose articles mostly need a
   * subscription can be on the list and still answer 403 — which is what SAGE and
   * Elsevier did. Listing them would be a line of code that changes nothing and
   * reads as though it had, and the reader would still be told their library
   * could not be indexed with no idea why.
   */
  for (const url of [
    "https://journals.sagepub.com/doi/pdf/10.1177/x",
    "https://www.sciencedirect.com/science/article/pii/x/pdf",
    "https://www.nature.com/articles/x.pdf",
    "https://onlinelibrary.wiley.com/doi/pdf/10.1002/x",
  ]) {
    assert.equal(isAllowedPdfProxyUrl(url), false, `${url} should not be promised`);
  }
});

test("pdf-proxy: GET requires authentication", async () => {
  const res = await GET(
    new Request(
      "http://localhost/api/pdf-proxy?url=" +
        encodeURIComponent("https://arxiv.org/pdf/1706.03762"),
    ),
  );
  assert.equal(res.status, 401);
});

test("pdf-proxy: 400 when url is not allowlisted", async () => {
  const bad = await proxyAllowlistedPdf("https://evil.test/a.pdf");
  assert.equal(bad.status, 400);
});

test("pdf-proxy: streams an allowlisted PDF", async () => {
  const { restore } = stubFetch((url) => {
    assert.match(url, /arxiv\.org\/pdf\/1706\.03762/);
    return new Response("%PDF-1.4 hello", {
      status: 200,
      headers: { "content-type": "application/pdf" },
    });
  });
  try {
    const res = await proxyAllowlistedPdf("https://arxiv.org/pdf/1706.03762");
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
  const { restore } = stubFetch(() =>
    new Response("<script>alert(1)</script>", {
      status: 200,
      headers: { "content-type": "text/html" },
    }),
  );
  try {
    const res = await proxyAllowlistedPdf("https://arxiv.org/html/1706.03762");
    assert.equal(res.status, 415);
  } finally {
    restore();
  }
});

test("pdf-proxy: rejects bodies that fail the %PDF magic sniff", async () => {
  const { restore } = stubFetch(() =>
    new Response("<html>not a pdf</html>", {
      status: 200,
      headers: { "content-type": "application/pdf" },
    }),
  );
  try {
    const res = await proxyAllowlistedPdf("https://arxiv.org/pdf/fake");
    assert.equal(res.status, 415);
  } finally {
    restore();
  }
});

test("pdf-proxy: accepts magic within the first 1KiB (not only byte 0)", async () => {
  const { restore } = stubFetch(() => {
    const prefix = new Uint8Array(8).fill(0);
    const body = new Uint8Array(prefix.length + 8);
    body.set(prefix);
    body.set(new TextEncoder().encode("%PDF-1.4"), prefix.length);
    return new Response(body, {
      status: 200,
      headers: { "content-type": "application/octet-stream" },
    });
  });
  try {
    const res = await proxyAllowlistedPdf("https://arxiv.org/pdf/offset");
    assert.equal(res.status, 200);
  } finally {
    restore();
  }
});

test("pdf-proxy: refuses off-allowlist redirects before following", async () => {
  const seen: string[] = [];
  const { restore } = stubFetch((url) => {
    seen.push(url);
    return new Response(null, {
      status: 302,
      headers: { location: "http://169.254.169.254/latest/meta-data/" },
    });
  });
  try {
    const res = await proxyAllowlistedPdf("https://arxiv.org/ct?url=http://evil");
    assert.equal(res.status, 400);
    assert.deepEqual(seen, ["https://arxiv.org/ct?url=http://evil"]);
  } finally {
    restore();
  }
});

/**
 * The deadlines. Both use a short override — the rule is about a budget
 * existing and covering the right phase, not about its length.
 */

/** A body that sends its first chunk and then never sends anything again. */
function stalledBody(first: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(first);
      // Deliberately never closed and never pulled again.
    },
  });
}

test("pdf-proxy: a body that stalls after the headers is abandoned on the body deadline", async () => {
  // The header budget used to be cleared the moment the headers arrived, so an
  // allowlisted host that answered 200 and then went quiet held the request —
  // and the server slot — for as long as it liked. The byte cap never fires on
  // a host that sends nothing.
  const { restore } = stubFetch(() => new Response(
    stalledBody(new TextEncoder().encode("%PDF-1.4")),
    { status: 200, headers: { "content-type": "application/pdf" } },
  ));
  try {
    const res = await proxyAllowlistedPdf("https://arxiv.org/pdf/stall", { bodyTimeoutMs: 25 });
    assert.equal(res.status, 504);
    assert.match((await res.json()).error, /did not arrive in time/);
  } finally {
    restore();
  }
});

test("pdf-proxy: the deadline also covers a body that stalls mid-stream", async () => {
  // Past the magic window, so the sniff succeeds and the client is already
  // receiving bytes when the host goes quiet. The response cannot be replaced
  // with an error status at that point, so the deadline cuts the body.
  const head = new Uint8Array(2_048).fill(32);
  head.set(new TextEncoder().encode("%PDF-1.4"), 0);
  const { restore } = stubFetch(() => new Response(stalledBody(head), {
    status: 200,
    headers: { "content-type": "application/pdf" },
  }));
  try {
    const res = await proxyAllowlistedPdf("https://arxiv.org/pdf/stall-tail", { bodyTimeoutMs: 25 });
    assert.equal(res.status, 200);
    // The status was already sent, so the deadline cuts the body instead: the
    // read rejects rather than reading the stalled stream as a complete PDF.
    await assert.rejects(() => res.text(), /timed out/, "a stalled tail must not read as a complete PDF");
  } finally {
    restore();
  }
});

test("pdf-proxy: a complete body is not cut off by the deadline", async () => {
  // The timer is cleared on every exit path, including the happy one — a stream
  // that finishes normally must not have its connection aborted underneath it.
  const { restore } = stubFetch(() => new Response("%PDF-1.4 complete", {
    status: 200,
    headers: { "content-type": "application/pdf" },
  }));
  try {
    const res = await proxyAllowlistedPdf("https://arxiv.org/pdf/ok", { bodyTimeoutMs: 25 });
    assert.equal(res.status, 200);
    assert.equal(await res.text(), "%PDF-1.4 complete");
  } finally {
    restore();
  }
});


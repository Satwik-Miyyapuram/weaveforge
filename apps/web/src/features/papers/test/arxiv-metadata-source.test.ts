import { test } from "node:test";
import assert from "node:assert/strict";
import { ArxivMetadataSource } from "../infrastructure/arxiv-metadata-source";

const feed = (entries: string) =>
  `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>ArXiv Query</title>${entries}</feed>`;

const source = (xml: string) =>
  new ArxivMetadataSource(async () => new Response(xml, { status: 200 }));

test("a known id is parsed from its entry", async () => {
  const xml = feed(
    "<entry><title>Attention Is\n  All You Need</title><published>2017-06-12T00:00:00Z</published>" +
      "<summary>We propose &amp; test.</summary><author><name>A. Vaswani</name></author></entry>",
  );
  const m = await source(xml).fetch({ kind: "arxiv", value: "1706.03762" });
  assert.equal(m.title, "Attention Is All You Need");
  assert.equal(m.year, 2017);
  assert.deepEqual(m.authors, ["A. Vaswani"]);
  assert.equal(m.abstract, "We propose & test.");
});

test("a feed with no entry is an error, not a placeholder paper (25-05)", async () => {
  // The feed's own <title> must not be taken for the paper's.
  await assert.rejects(source(feed("")).fetch({ kind: "arxiv", value: "9999.99999" }), /arXiv has no paper 9999\.99999/);
});

test("arXiv's error entry is an error (25-05)", async () => {
  const xml = feed("<entry><id>http://arxiv.org/api/errors#incorrect_id_format</id><title>Error</title><summary>incorrect id format</summary></entry>");
  await assert.rejects(source(xml).fetch({ kind: "arxiv", value: "bogus" }), /arXiv has no paper bogus/);
});

test("an HTTP failure still says so", async () => {
  const s = new ArxivMetadataSource(async () => new Response("", { status: 503, statusText: "Busy" }));
  await assert.rejects(s.fetch({ kind: "arxiv", value: "1706.03762" }), /arXiv request failed: 503/);
});

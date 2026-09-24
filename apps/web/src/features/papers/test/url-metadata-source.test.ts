import assert from "node:assert/strict";
import test from "node:test";
import { UrlMetadataSource } from "../infrastructure/url-metadata-source";

/**
 * The desktop path: no server route, so the page comes through the shell's
 * HTML relay and is read here with the same parser the route uses.
 */

const BLOG = `<html><head>
  <title>LLM Powered Autonomous Agents | Lil'Log</title>
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="Lil'Log">
  <meta name="author" content="Lilian Weng">
  <meta property="article:published_time" content="2023-06-23T00:00:00Z">
</head><body><article>…</article></body></html>`;

function shellSource(respond: (url: string) => Response) {
  const asked: string[] = [];
  const source = new UrlMetadataSource(
    async (input) => {
      asked.push(String(input));
      return respond(String(input));
    },
    "/api/url-meta",
    async () => ({}),
    () => true,
  );
  return { source, asked };
}

test("url source in the shell: a blog post imports through the HTML relay", async () => {
  const { source, asked } = shellSource(
    () =>
      new Response(BLOG, {
        status: 200,
        headers: { "x-final-url": "https://lilianweng.github.io/posts/2023-06-23-agent/" },
      }),
  );
  const meta = await source.fetch({ kind: "url", value: "lilianweng.github.io/posts/2023-06-23-agent/" });
  assert.match(asked[0] ?? "", /^\/api\/html-proxy\?url=https%3A%2F%2Flilianweng/);
  assert.equal(meta.title, "LLM Powered Autonomous Agents");
  assert.deepEqual(meta.authors, ["Lilian Weng"]);
  assert.equal(meta.year, 2023);
  assert.equal(meta.venue, "Lil'Log");
  assert.equal(meta.url, "https://lilianweng.github.io/posts/2023-06-23-agent/");
});

test("url source in the shell: a home page is refused with the parser's reason", async () => {
  const { source } = shellSource(() => new Response("<title>Welcome</title>", { status: 200 }));
  await assert.rejects(source.fetch({ kind: "url", value: "https://example.com/" }), /does not look like a paper or an article/);
});

test("url source in the shell: the relay's refusal is shown in its own words", async () => {
  const { source } = shellSource(
    () => new Response(JSON.stringify({ error: "Only https links are fetched" }), { status: 400 }),
  );
  await assert.rejects(source.fetch({ kind: "url", value: "http://example.com/" }), /^Error: Only https links are fetched$/);

  const pdf = shellSource(() => new Response(JSON.stringify({ error: "not html" }), { status: 415 }));
  await assert.rejects(pdf.source.fetch({ kind: "url", value: "https://a.org/p.pdf" }), /not a web page/);
});

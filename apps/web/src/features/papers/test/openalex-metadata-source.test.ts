import assert from "node:assert/strict";
import test from "node:test";
import { OpenAlexMetadataSource } from "../infrastructure/openalex-metadata-source";

const ref = { kind: "bibliographic", value: "Some title", hints: { title: "Some title" } } as const;

/** Records the URL asked for and answers with no works. */
function recorder() {
  const urls: string[] = [];
  const fetchFn = (async (input: string | URL | Request) => {
    urls.push(String(input));
    return new Response(JSON.stringify({ results: [] }), { status: 200 });
  }) as typeof fetch;
  return { urls, fetchFn };
}

test("OpenAlex metadata lookups send the user's key as api_key", async () => {
  const { urls, fetchFn } = recorder();
  const source = new OpenAlexMetadataSource(fetchFn, undefined, undefined, async () => "oa-key");
  await assert.rejects(source.fetch(ref));
  assert.equal(new URL(String(urls[0])).searchParams.get("api_key"), "oa-key");
});

test("OpenAlex metadata lookups without a key send no api_key", async () => {
  const { urls, fetchFn } = recorder();
  const source = new OpenAlexMetadataSource(fetchFn, undefined, undefined, async () => undefined);
  await assert.rejects(source.fetch(ref));
  assert.equal(new URL(String(urls[0])).searchParams.has("api_key"), false);
});

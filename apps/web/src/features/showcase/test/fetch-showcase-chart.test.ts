import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchShowcaseChart } from "../application/fetch-showcase-chart";

const png = new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });

test("a served chart comes back as its image, fetched from the bundled path", async () => {
  const asked: string[] = [];
  const got = await fetchShowcaseChart("beta-loss-curve", async (url) => {
    asked.push(String(url));
    return new Response(png);
  });
  assert.deepEqual(asked, ["/showcase/beta-loss-curve.png"]);
  assert.equal(got?.size, 4);
});

test("a missing chart (404) is skipped", async () => {
  const got = await fetchShowcaseChart("gone", async () => new Response("", { status: 404 }));
  assert.equal(got, null);
});

test("a network error skips the chart instead of aborting the seed (36-17)", async () => {
  const got = await fetchShowcaseChart("beta-loss-curve", () => Promise.reject(new TypeError("Failed to fetch")));
  assert.equal(got, null);
});

test("a body that cannot be read is skipped too", async () => {
  const broken = { ok: true, blob: () => Promise.reject(new Error("aborted")) } as unknown as Response;
  const got = await fetchShowcaseChart("beta-loss-curve", async () => broken);
  assert.equal(got, null);
});

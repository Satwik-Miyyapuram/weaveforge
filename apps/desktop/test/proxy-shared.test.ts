import test from "node:test";
import assert from "node:assert/strict";
import { refuse, type ProxyFetch } from "../src/proxy-shared";
import { proxyArxiv } from "../src/arxiv-proxy";
import { proxyHtml } from "../src/html-proxy";
import { proxyPdf } from "../src/pdf-proxy";
import { proxySemanticScholar } from "../src/semantic-scholar-proxy";
import { proxyBlob } from "../src/blob-proxy";
import { proxyAccount } from "../src/account-proxy";

/**
 * Every shell proxy refuses the same way, through one `refuse` (37-13, 38-13):
 * a JSON `{ error }` body with its status, and nothing sent upstream.
 */

const APP = "app://weaveforge";

/** A fetch that fails the test if any proxy reaches upstream. */
const never: ProxyFetch = () => {
  throw new Error("a refused request must not reach upstream");
};

async function assertRefused(res: Response, status: number, error: RegExp): Promise<void> {
  assert.equal(res.status, status);
  assert.equal(res.headers.get("content-type"), "application/json");
  const body = (await res.json()) as { error?: unknown };
  assert.deepEqual(Object.keys(body), ["error"]);
  assert.match(String(body.error), error);
}

test("refuse answers a JSON error with the given status", async () => {
  await assertRefused(refuse(403, "Host not allowed"), 403, /^Host not allowed$/);
  await assertRefused(refuse(502, "Upstream fetch failed"), 502, /Upstream/);
});

test("pdf proxy refuses a host off the allowlist", async () => {
  const url = `${APP}/api/pdf-proxy?url=${encodeURIComponent("https://evil.example/x.pdf")}`;
  await assertRefused(await proxyPdf(url, never), 400, /not allowed/);
});

test("html proxy refuses a non-https address", async () => {
  const url = `${APP}/api/html-proxy?url=${encodeURIComponent("http://example.com/")}`;
  await assertRefused(await proxyHtml(url, never), 400, /https/);
});

test("html proxy refuses a missing url", async () => {
  await assertRefused(await proxyHtml(`${APP}/api/html-proxy`, never), 400, /url is required/);
});

test("arXiv proxy refuses a non-GET method", async () => {
  const req = new Request(`${APP}/api/arxiv?id_list=1706.03762`, { method: "POST" });
  await assertRefused(await proxyArxiv(req, never), 405, /Method not allowed/);
});

test("Semantic Scholar proxy refuses a non-GET/POST method", async () => {
  const req = new Request(`${APP}/api/semantic-scholar/graph/v1/paper/x`, { method: "DELETE" });
  await assertRefused(await proxySemanticScholar(req, never), 405, /Method not allowed/);
});

test("blob and account proxies refuse a wrong method", async () => {
  await assertRefused(await proxyBlob(new Request(`${APP}/api/blobs/a`, { method: "PUT" }), never), 405, /Method/);
  await assertRefused(await proxyAccount(new Request(`${APP}/api/account/delete-user`), never), 405, /Method/);
});

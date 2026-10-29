import test from "node:test";
import assert from "node:assert/strict";
import { refuse, upstreamFailed, type ProxyFetch } from "../src/proxy-shared";
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

test("a private host is any loopback, private, link-local or special address, or localhost", async () => {
  const { isPrivateHost } = await import("../src/proxy-shared");
  for (const host of ["localhost", "a.localhost", "LOCALHOST.", "127.0.0.1", "0.0.0.0", "10.1.2.3", "100.64.0.1", "172.31.0.1", "192.168.0.1", "169.254.169.254", "198.18.0.1", "224.0.0.1", "[::1]", "::", "[::ffff:7f00:1]", "fd00::1", "fe80::1"]) {
    assert.equal(isPrivateHost(host), true, host);
  }
  for (const host of ["arxiv.org", "8.8.8.8", "172.32.0.1", "[2606:4700::1111]"]) {
    assert.equal(isPrivateHost(host), false, host);
  }
});

test("a public https address has no credentials and no private host, in any spelling", async () => {
  const { isPublicHttpsUrl } = await import("../src/proxy-shared");
  assert.equal(isPublicHttpsUrl("https://arxiv.org/pdf/1"), true);
  for (const url of ["http://arxiv.org/", "https://u:p@arxiv.org/", "https://127.1/", "https://0x7f.1/", "https://2130706433/", "https://[::ffff:127.0.0.1]/", "not a url", ""]) {
    assert.equal(isPublicHttpsUrl(url), false, url);
  }
});

// xlog-05: a proxy that cannot reach upstream still answers 502, and now says why in the log.
test("upstreamFailed logs the reason and its cause, and answers the refusal", async () => {
  const logged: string[] = [];
  const cause = Object.assign(new Error("getaddrinfo ENOTFOUND export.arxiv.org"), { code: "ENOTFOUND" });
  const res = upstreamFailed("arxiv", new TypeError("fetch failed", { cause }), 502, "Upstream fetch failed", (line) => void logged.push(line));
  await assertRefused(res, 502, /^Upstream fetch failed$/);
  assert.equal(logged.length, 1);
  assert.match(logged[0]!, /^\[proxy:arxiv\] Upstream fetch failed: fetch failed \(getaddrinfo ENOTFOUND export\.arxiv\.org\)$/);

  upstreamFailed("blob", "plain string", 502, "Upstream fetch failed", (line) => void logged.push(line));
  assert.match(logged[1]!, /plain string$/);
  upstreamFailed("blob", new Error("x".repeat(5_000)), 502, "Upstream fetch failed", (line) => void logged.push(line));
  assert.ok(logged[2]!.length < 400, "a long reason is cut");
});

test("every proxy logs a network failure once and still answers 502", async (t) => {
  const warn = t.mock.method(console, "warn", () => undefined);
  const offline: ProxyFetch = () => Promise.reject(new Error("offline"));
  const answers = [
    await proxyArxiv(new Request(`${APP}/api/arxiv?id_list=1`), offline),
    await proxyBlob(new Request(`${APP}/api/blobs/a`), offline),
    await proxySemanticScholar(new Request(`${APP}/api/semantic-scholar/graph/v1/paper/x`), offline),
    await proxyHtml(`${APP}/api/html-proxy?url=${encodeURIComponent("https://a.org/p")}`, offline),
    await proxyPdf(`${APP}/api/pdf-proxy?typed=1&url=${encodeURIComponent("https://a.org/x.pdf")}`, offline),
  ];
  assert.deepEqual(answers.map((r) => r.status), [502, 502, 502, 502, 502]);
  assert.equal(warn.mock.callCount(), 5);
  for (const call of warn.mock.calls) assert.match(String(call.arguments[0]), /^\[proxy:[\w.-]+\] .*offline/);
});

test("a body that breaks off is logged and answers 504", async (t) => {
  const warn = t.mock.method(console, "warn", () => undefined);
  const broken = (type: string): ProxyFetch => async () =>
    new Response(new ReadableStream({ pull(c) { c.error(new Error("socket hang up")); } }), {
      headers: { "content-type": type },
    });
  const html = await proxyHtml(`${APP}/api/html-proxy?url=${encodeURIComponent("https://a.org/p")}`, broken("text/html"));
  const pdf = await proxyPdf(`${APP}/api/pdf-proxy?typed=1&url=${encodeURIComponent("https://a.org/x.pdf")}`, broken("application/pdf"));
  assert.deepEqual([html.status, pdf.status], [504, 504]);
  assert.equal(warn.mock.callCount(), 2);
  for (const call of warn.mock.calls) assert.match(String(call.arguments[0]), /socket hang up/);
});

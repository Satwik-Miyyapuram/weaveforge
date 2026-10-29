import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { BaseAPI } from "../vendor/overleaf-workshop/base-api";
import { compileOverleafProjectWithCookies, fetchOverleafPdfWithCookies, workshopPdfResponse } from "../infrastructure/overleaf-workshop-compile";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const profilePage = `<html><meta name="ol-user_id" content="u1"><meta name="ol-csrfToken" content="csrf-1"></html>`;

type Handler = (url: string) => Response;
function fake(handlers: Record<string, Handler>, seen: string[] = []) {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    seen.push(url);
    const key = Object.keys(handlers).find((k) => url.endsWith(k));
    return key === undefined ? new Response("nope", { status: 404 }) : handlers[key]!(url);
  }) as typeof fetch;
  return seen;
}
const login = {
  "project": () => new Response(profilePage, { status: 200 }),
  "socket.io/socket.io.js": () => new Response("", { status: 200, headers: { "set-cookie": "s=1; Path=/" } }),
};
const api = () => new BaseAPI("https://ol.test/");
const compileJson = (body: object) => () => new Response(JSON.stringify(body), { status: 200 });

test("compile returns the parsed compile result on success", async () => {
  fake({ ...login, "compile?auto_compile=true": compileJson({ status: "success", compileGroup: "g", outputFiles: [] }) });
  const r = await compileOverleafProjectWithCookies("c=1", "p1", "main.tex", api());
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.compile.status, "success");
});

test("a LaTeX compile failure is returned as data (ok, status failure), not thrown", async () => {
  fake({ ...login, "compile?auto_compile=true": compileJson({ status: "failure", compileGroup: "g", outputFiles: [] }) });
  const r = await compileOverleafProjectWithCookies("c=1", "p1", "main.tex", api());
  assert.equal(r.ok && r.compile.status, "failure");
});

test("an expired or bad cookie stops before compiling", async () => {
  const seen = fake({ "project": () => new Response("<html>sign in</html>", { status: 200 }) });
  const r = await compileOverleafProjectWithCookies("expired=1", "p1", "main.tex", api());
  assert.deepEqual(r, { ok: false, message: "Failed to get User ID." });
  assert.equal(seen.some((u) => u.includes("compile")), false);
});

test("a network failure during compile is reported as a message", async () => {
  fake({ ...login });
  globalThis.fetch = (async (input: string | URL | Request) => {
    if (String(input).includes("compile")) throw new Error("getaddrinfo ENOTFOUND ol.test");
    return (login[Object.keys(login).find((k) => String(input).endsWith(k)) as keyof typeof login] ?? (() => new Response("", { status: 404 })))();
  }) as typeof fetch;
  const r = await compileOverleafProjectWithCookies("c=1", "p1", "main.tex", api());
  assert.equal(r.ok, false);
});

test("PDF: compiles, then downloads output.pdf from the CDN without the session cookie", async () => {
  const seen = fake({
    ...login,
    "compile?auto_compile=true": compileJson({
      status: "success", compileGroup: "g", clsiServerId: "s/1", pdfDownloadDomain: "https://cdn.test/",
      outputFiles: [{ path: "output.pdf", url: "/output.pdf", type: "pdf" }],
      stats: {}, timings: {}, enableHybridPdfDownload: true,
    }),
    "enable_pdf_caching=true": () => new Response(new Uint8Array([37, 80, 68, 70]), { status: 200 }),
  });
  const r = await fetchOverleafPdfWithCookies("c=1", "p1", "main.tex", api());
  assert.equal(r.ok, true);
  assert.deepEqual(r.ok ? Array.from(r.pdf) : [], [37, 80, 68, 70]);
  assert.ok(seen.some((u) => u.startsWith("https://cdn.test/")));
});

test("PDF: a failed compile yields no PDF and the compile status as the message", async () => {
  fake({ ...login, "compile?auto_compile=true": compileJson({ status: "failure", compileGroup: "g", outputFiles: [], stats: {}, timings: {}, enableHybridPdfDownload: false }) });
  const r = await fetchOverleafPdfWithCookies("c=1", "p1", "main.tex", api());
  assert.deepEqual(r, { ok: false, message: "Compile failed (status failure)." });
});

test("PDF: a successful compile with no output.pdf is reported, not returned empty", async () => {
  fake({ ...login, "compile?auto_compile=true": compileJson({ status: "success", compileGroup: "g", outputFiles: [], stats: {}, timings: {}, enableHybridPdfDownload: false }) });
  const r = await fetchOverleafPdfWithCookies("c=1", "p1", "main.tex", api());
  assert.deepEqual(r, { ok: false, message: "The compile produced no PDF." });
});

test("PDF: an empty download (404 from CLSI) is reported, not returned empty", async () => {
  fake({
    ...login,
    "compile?auto_compile=true": compileJson({ status: "success", compileGroup: "g", outputFiles: [{ path: "output.pdf", url: "/output.pdf", type: "pdf" }], stats: {}, timings: {}, enableHybridPdfDownload: false }),
    "output.pdf": () => new Response("gone", { status: 404 }),
  });
  const r = await fetchOverleafPdfWithCookies("c=1", "p1", "main.tex", api());
  assert.deepEqual(r, { ok: false, message: "The PDF could not be downloaded." });
});

test("the PDF response is application/pdf, uncached, and carries the exact bytes", async () => {
  const res = workshopPdfResponse(new Uint8Array([37, 80, 68, 70]));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Content-Type"), "application/pdf");
  assert.equal(res.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(Array.from(new Uint8Array(await res.arrayBuffer())), [37, 80, 68, 70]);
});

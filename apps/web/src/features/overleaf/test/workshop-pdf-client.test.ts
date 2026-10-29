import test from "node:test";
import assert from "node:assert/strict";
import { fetchWorkshopPdf, type WorkshopPdfDeps } from "../infrastructure/workshop-pdf-client";

const SESSION = "3f6c2a9e-1b2d-4c5e-8f70-123456789abc";
const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]); // "%PDF-"

interface Call {
  url: string;
  init: RequestInit;
}

/** Deps with a recording fetch, a fixed auth header and a recording blob-URL factory. */
function makeDeps(respond: () => Response | Promise<Response>) {
  const calls: Call[] = [];
  const created: Blob[] = [];
  const deps: WorkshopPdfDeps = {
    fetch: async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return respond();
    },
    authHeaders: async (extra) => ({ ...(extra as Record<string, string>), Authorization: "Bearer test-token" }),
    createObjectUrl: (blob) => {
      created.push(blob);
      return `blob:test/${created.length}`;
    },
  };
  return { deps, calls, created };
}

function pdfResponse(body: BodyInit = PDF_BYTES, type = "application/pdf") {
  return () => new Response(body, { status: 200, headers: { "Content-Type": type } });
}

test("the request POSTs the ids as JSON with the bearer header to the PDF route", async () => {
  const { deps, calls } = makeDeps(pdfResponse());
  await fetchWorkshopPdf(deps, SESSION, "p1", "main.tex");
  assert.equal(calls.length, 1);
  const call = calls[0];
  assert.ok(call);
  assert.equal(call.url, "/api/overleaf/workshop/pdf");
  assert.equal(call.init.method, "POST");
  const headers = call.init.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer test-token", "the bearer header must be sent");
  assert.equal(headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(String(call.init.body)), { sessionId: SESSION, projectId: "p1", rootResourcePath: "main.tex" });
});

test("a 200 application/pdf response becomes an object URL", async () => {
  const { deps, created } = makeDeps(pdfResponse());
  const result = await fetchWorkshopPdf(deps, SESSION, "p1", "main.tex");
  assert.deepEqual(result, { ok: true, url: "blob:test/1" });
  assert.equal(created.length, 1);
  const [blob] = created;
  assert.ok(blob);
  assert.equal(blob.type, "application/pdf");
  assert.equal(blob.size, PDF_BYTES.length);
});

test("a 401 asks the user to sign in again and creates no blob", async () => {
  const { deps, created } = makeDeps(() => new Response(JSON.stringify({ error: "nope" }), { status: 401, headers: { "Content-Type": "application/json" } }));
  const result = await fetchWorkshopPdf(deps, SESSION, "p1", "main.tex");
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.message, /sign in again/i);
  assert.equal(created.length, 0);
});

test("a 502 JSON error returns the server's message and creates no blob", async () => {
  const { deps, created } = makeDeps(() => new Response(JSON.stringify({ error: "Overleaf compile failed." }), { status: 502, headers: { "Content-Type": "application/json" } }));
  const result = await fetchWorkshopPdf(deps, SESSION, "p1", "main.tex");
  assert.deepEqual(result, { ok: false, message: "Overleaf compile failed." });
  assert.equal(created.length, 0);
});

test("a 502 with a non-JSON body still gives a message, not a crash", async () => {
  const { deps, created } = makeDeps(() => new Response("<html>bad gateway</html>", { status: 502, headers: { "Content-Type": "text/html" } }));
  const result = await fetchWorkshopPdf(deps, SESSION, "p1", "main.tex");
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.message, /502/);
  assert.equal(created.length, 0);
});

test("a 200 response that is not a PDF is rejected", async () => {
  const { deps, created } = makeDeps(pdfResponse("<html></html>", "text/html"));
  const result = await fetchWorkshopPdf(deps, SESSION, "p1", "main.tex");
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.message, /did not return a PDF/i);
  assert.equal(created.length, 0);
});

test("an empty PDF body is rejected", async () => {
  const { deps, created } = makeDeps(pdfResponse(new Uint8Array(0)));
  const result = await fetchWorkshopPdf(deps, SESSION, "p1", "main.tex");
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.message, /empty/i);
  assert.equal(created.length, 0);
});

test("a network failure gives a message and creates no blob", async () => {
  const { deps, created } = makeDeps(() => {
    throw new TypeError("fetch failed");
  });
  const result = await fetchWorkshopPdf(deps, SESSION, "p1", "main.tex");
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.message, /fetch failed/);
  assert.equal(created.length, 0);
});

test("no sign-in token gives a message and sends no request", async () => {
  const { deps, calls, created } = makeDeps(pdfResponse());
  deps.authHeaders = async () => {
    throw new Error("Not signed in.");
  };
  const result = await fetchWorkshopPdf(deps, SESSION, "p1", "main.tex");
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.message, /Not signed in/);
  assert.equal(calls.length, 0);
  assert.equal(created.length, 0);
});

test("a superseded request does not read the PDF body at all", async () => {
  let bodyRead = false;
  const { deps } = makeDeps(() => {
    const res = new Response(PDF_BYTES, { status: 200, headers: { "Content-Type": "application/pdf" } });
    const blob = res.blob.bind(res);
    Object.defineProperty(res, "blob", { value: () => { bodyRead = true; return blob(); } });
    return res;
  });
  const result = await fetchWorkshopPdf(deps, SESSION, "p1", "main.tex", () => false);
  assert.equal(result.ok, false);
  assert.equal(bodyRead, false, "a superseded response must not be downloaded");
});

test("a response that is stale when it arrives is not turned into a URL", async () => {
  const { deps, created } = makeDeps(pdfResponse());
  const result = await fetchWorkshopPdf(deps, SESSION, "p1", "main.tex", () => false);
  assert.equal(result.ok, false);
  assert.equal(created.length, 0, "a superseded response must not create an object URL");
});

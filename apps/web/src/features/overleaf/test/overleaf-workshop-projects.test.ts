import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { BaseAPI } from "../vendor/overleaf-workshop/base-api";
import { listOverleafProjectsWithCookies } from "../infrastructure/overleaf-workshop-projects";

type Route = (url: string, init: RequestInit) => Response;

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function fakeOverleaf(routes: Record<string, Route>, calls: { url: string; init: RequestInit }[] = []) {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init: init ?? {} });
    const key = Object.keys(routes).find((k) => url.endsWith(k));
    if (!key) return new Response("not found", { status: 404 });
    return routes[key]!(url, init ?? {});
  }) as typeof fetch;
  return calls;
}

const profilePage = `<html><meta name="ol-user_id" content="u1"><meta name="ol-usersEmail" content="a@b.c"><meta name="ol-csrfToken" content="csrf-1"></html>`;
const sessionCookie = { "set-cookie": "socket=s1; Path=/" };

test("cookiesLogin reads the user id and CSRF token and appends the cookie", async () => {
  fakeOverleaf({
    "project": () => new Response(profilePage, { status: 200 }),
    "socket.io/socket.io.js": () => new Response("", { status: 200, headers: sessionCookie }),
  });
  const result = await new BaseAPI("https://ol.test/").cookiesLogin("overleaf_session2=abc");
  assert.equal(result.type, "success");
  assert.deepEqual(result.userInfo, { userId: "u1", userEmail: "a@b.c" });
  assert.equal(result.identity?.csrfToken, "csrf-1");
  assert.equal(result.identity?.cookies, "overleaf_session2=abc; socket=s1");
});

test("cookiesLogin fails when the page has no user meta tags (expired cookie)", async () => {
  fakeOverleaf({ "project": () => new Response("<html>login</html>", { status: 200 }) });
  const result = await new BaseAPI("https://ol.test/").cookiesLogin("expired=1");
  assert.deepEqual(result, { type: "error", message: "Failed to get User ID." });
});

test("listOverleafProjectsWithCookies maps _id to id and keeps names", async () => {
  fakeOverleaf({
    "project": () => new Response(profilePage, { status: 200 }),
    "socket.io/socket.io.js": () => new Response("", { status: 200, headers: sessionCookie }),
    "user/projects": () => new Response(JSON.stringify({ projects: [{ _id: "p1", name: "Thesis", extra: 1 }] }), { status: 200 }),
  });
  const result = await listOverleafProjectsWithCookies("overleaf_session2=abc", new BaseAPI("https://ol.test/"));
  assert.deepEqual(result, { ok: true, projects: [{ id: "p1", name: "Thesis" }] });
});

test("listOverleafProjectsWithCookies returns the sign-in error without listing projects", async () => {
  const calls = fakeOverleaf({ "project": () => new Response("<html></html>", { status: 200 }) });
  const result = await listOverleafProjectsWithCookies("bad", new BaseAPI("https://ol.test/"));
  assert.deepEqual(result, { ok: false, message: "Failed to get User ID." });
  assert.equal(calls.some((c) => c.url.endsWith("user/projects")), false);
});

test("a 403 from the project list is reported and not retried", async () => {
  const calls = fakeOverleaf({
    "user/projects": () => new Response("forbidden", { status: 403 }),
  });
  const api = new BaseAPI("https://ol.test/").setIdentity({ csrfToken: "c", cookies: "x=1" });
  const result = await api.userProjectsJson({ csrfToken: "c", cookies: "x=1" });
  assert.deepEqual(result, { type: "error", message: "403: forbidden" });
  assert.equal(calls.length, 1);
});

test("a 503 is retried once and then succeeds", async () => {
  let hits = 0;
  fakeOverleaf({
    "user/projects": () => (++hits === 1
      ? new Response("busy", { status: 503 })
      : new Response(JSON.stringify({ projects: [] }), { status: 200 })),
  });
  const result = await new BaseAPI("https://ol.test/").userProjectsJson({ csrfToken: "c", cookies: "x=1" });
  assert.deepEqual(result, { type: "success", projects: [] });
  assert.equal(hits, 2);
});

test("a thrown network error is retried (2 retries) and then reported", async () => {
  let hits = 0;
  globalThis.fetch = (async () => { hits++; throw new Error("boom"); }) as typeof fetch;
  const result = await new BaseAPI("https://ol.test/").userProjectsJson({ csrfToken: "c", cookies: "x=1" });
  assert.deepEqual(result, { type: "error", message: "boom" });
  assert.equal(hits, 3);
});

test("compile posts JSON with the CSRF token and parses the response", async () => {
  const calls = fakeOverleaf({
    "project/p1/compile?auto_compile=true": () => new Response(JSON.stringify({ status: "success", compileGroup: "g", outputFiles: [] }), { status: 200 }),
  });
  const result = await new BaseAPI("https://ol.test/").compile({ csrfToken: "c", cookies: "x=1" }, "p1", "main.tex");
  assert.equal(result.type, "success");
  assert.equal(result.compile?.status, "success");
  const sent = JSON.parse(String(calls[0]!.init.body));
  assert.equal(sent._csrf, "c");
  assert.equal(sent.rootResourcePath, "main.tex");
  assert.equal((calls[0]!.init.headers as Record<string, string>)["X-Csrf-Token"], "c");
});

test("getFileFromClsi uses the CDN with query params and without the session cookie", async () => {
  const calls = fakeOverleaf({
    "https://cdn.test/output.pdf?compileGroup=g&clsiserverid=s%2F1&enable_pdf_caching=true": () => new Response(new Uint8Array([37, 80, 68, 70]), { status: 200 }),
  });
  const result = await new BaseAPI("https://ol.test/").getFileFromClsi({ csrfToken: "c", cookies: "x=1" }, "/output.pdf", "g", "s/1", "https://cdn.test/");
  assert.deepEqual(Array.from(result.content ?? []), [37, 80, 68, 70]);
  assert.equal((calls[0]!.init.headers as Record<string, string>)["Cookie"], undefined);
});

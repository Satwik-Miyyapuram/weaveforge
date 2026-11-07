import assert from "node:assert/strict";
import test from "node:test";
import { installFetchBridge, isOverleafUrl, type ForwardRequest } from "../fetch-bridge";

const ORIGIN = "https://app.localhost";

function fakeWindow() {
  const own: string[] = [];
  const win: { location: { origin: string }; fetch: typeof fetch } = {
    location: { origin: ORIGIN },
    fetch: async (input: RequestInfo | URL) => {
      own.push(String(input instanceof Request ? input.url : input));
      return new Response("own");
    },
  };
  return { win, own };
}

test("Overleaf's server paths on our origin and its PDF host are Overleaf's", () => {
  for (const url of [
    `${ORIGIN}/project/abc/compile?auto_compile=true`,
    `${ORIGIN}/user/settings`,
    `${ORIGIN}/spelling/learn`,
    `${ORIGIN}/system/messages`,
    `${ORIGIN}/notifications/preferences/project/abc`,
    `${ORIGIN}/editingSession/abc`,
    `${ORIGIN}/tutorial/x/complete`,
    `${ORIGIN}/error/client`,
    "https://compiles.overleafusercontent.com/project/abc/output.pdf",
  ]) {
    assert.equal(isOverleafUrl(new URL(url), ORIGIN), true, url);
  }
});

test("the app's own files and other hosts are not Overleaf's", () => {
  for (const url of [
    `${ORIGIN}/_next/static/chunk.js`,
    `${ORIGIN}/api/overleaf/workshop/live`,
    `${ORIGIN}/js/pdfjs-dist/wasm/qcms_bg.wasm`,
    `${ORIGIN}/projects`,
    "https://example.com/project/abc",
  ]) {
    assert.equal(isOverleafUrl(new URL(url), ORIGIN), false, url);
  }
});

test("an Overleaf request is forwarded with its method, path, headers and body", async () => {
  const { win, own } = fakeWindow();
  const seen: ForwardRequest[] = [];
  installFetchBridge(win, async (req) => {
    seen.push(req);
    return { status: 200, headers: { "content-type": "application/json" }, body: new TextEncoder().encode('{"ok":1}') };
  });
  const res = await win.fetch("/project/abc/compile?x=1", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: '{"draft":false}',
  });
  assert.deepEqual(own, []);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].method, "POST");
  assert.equal(seen[0].url, "/project/abc/compile?x=1");
  assert.equal(seen[0].headers["content-type"], "application/json");
  assert.equal(new TextDecoder().decode(seen[0].body!), '{"draft":false}');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/json");
  assert.deepEqual(await res.json(), { ok: 1 });
});

test("a PDF on Overleaf's host is forwarded by its full address, with no body", async () => {
  const { win } = fakeWindow();
  const seen: ForwardRequest[] = [];
  installFetchBridge(win, async (req) => {
    seen.push(req);
    return { status: 200, headers: {}, body: new Uint8Array([37, 80]) };
  });
  const url = "https://compiles.overleafusercontent.com/project/abc/output.pdf";
  const res = await win.fetch(new Request(url, { headers: { Range: "bytes=0-1" } }));
  assert.equal(seen[0].method, "GET");
  assert.equal(seen[0].url, url);
  assert.equal(seen[0].headers.range, "bytes=0-1");
  assert.equal(seen[0].body, null);
  assert.deepEqual(new Uint8Array(await res.arrayBuffer()), new Uint8Array([37, 80]));
});

test("everything else goes to the window's own fetch", async () => {
  const { win, own } = fakeWindow();
  installFetchBridge(win, async () => assert.fail("forwarded"));
  const res = await win.fetch("/_next/static/a.js");
  assert.equal(await res.text(), "own");
  assert.deepEqual(own, ["/_next/static/a.js"]);
});

test("a body-less status such as 204 still makes a response", async () => {
  const { win } = fakeWindow();
  installFetchBridge(win, async () => ({ status: 204, headers: {}, body: new Uint8Array() }));
  const res = await win.fetch("/project/abc/flush", { method: "POST" });
  assert.equal(res.status, 204);
});

test("uninstalling restores the window's own fetch", async () => {
  const { win } = fakeWindow();
  const original = win.fetch;
  const uninstall = installFetchBridge(win, async () => assert.fail("forwarded"));
  assert.notEqual(win.fetch, original);
  uninstall();
  assert.equal(win.fetch, original);
});
